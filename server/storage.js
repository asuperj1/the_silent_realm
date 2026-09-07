/**
 * 持久化数据存储模块
 * 负责用户账号、角色存档的读写操作
 * 采用文件存储方案（JSON），预留接口可迁移至数据库
 *
 * P1 并发修复: 添加内存缓存层 + 异步批量持久化
 * - 启动时全量加载到内存
 * - 写操作先更新内存缓存，标记脏页
 * - 每 30s 异步刷盘，避免并发写丢失
 */

const fs = require('fs');
const path = require('path');

// ==================== 配置常量 ====================
const DATA_DIR = './data';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHARACTERS_DIR = path.join(DATA_DIR, 'characters');
const FLUSH_INTERVAL = 30000; // 30s 刷盘间隔

// ==================== 内存缓存层 ====================
let _usersCache = null;              // { uid: user } — 全量用户缓存
let _charactersCache = new Map();    // characterUid -> character — 角色缓存
let _dirtyUsers = false;            // 用户数据脏标记
const _dirtyCharacters = new Set(); // 脏角色 UID 集合
let _flushTimer = null;

// ==================== 初始化 ====================
function initStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(CHARACTERS_DIR)) {
    fs.mkdirSync(CHARACTERS_DIR, { recursive: true });
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({}), 'utf8');
  }

  // 启动时预加载用户数据到内存
  try {
    _usersCache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    _usersCache = {};
  }

  // 启动定时刷盘
  _flushTimer = setInterval(flushToDisk, FLUSH_INTERVAL);
  _flushTimer.unref(); // 不阻止进程退出
}

// 进程退出前最后刷盘
process.on('beforeExit', () => flushToDisk());
process.on('SIGINT', () => { flushToDisk(); process.exit(0); });
process.on('SIGTERM', () => { flushToDisk(); process.exit(0); });

function flushToDisk() {
  // 刷盘用户数据
  if (_dirtyUsers && _usersCache) {
    try {
      const tmp = USERS_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(_usersCache, null, 2), 'utf8');
      fs.renameSync(tmp, USERS_FILE);
      _dirtyUsers = false;
    } catch (e) {
      console.error('[storage] 用户数据刷盘失败:', e.message);
    }
  }

  // 刷盘角色数据
  for (const charUid of _dirtyCharacters) {
    const char = _charactersCache.get(charUid);
    if (!char) continue;
    try {
      const file = getCharacterFilePath(charUid);
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(char, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error(`[storage] 角色 ${charUid} 刷盘失败:`, e.message);
    }
  }
  _dirtyCharacters.clear();
}

// 进程退出时确保刷盘
function ensureFlushAndExit() {
  flushToDisk();
  if (_flushTimer) clearInterval(_flushTimer);
}

// ==================== 用户账号操作 ====================

/**
 * 加载所有用户数据（优先内存缓存）
 * @returns {Object} 用户字典 { uid: { uid, username, passwordHash, characters: [] } }
 */
function loadAllUsers() {
  if (_usersCache) return _usersCache;
  try {
    _usersCache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    _usersCache = {};
  }
  return _usersCache;
}

/**
 * 保存所有用户数据（标记脏页，异步刷盘）
 * @param {Object} users - 用户字典
 */
function saveAllUsers(users) {
  _usersCache = users;
  _dirtyUsers = true;
}

/**
 * 根据用户名查找用户
 * @param {string} username
 * @returns {Object|null}
 */
function findUserByUsername(username) {
  const users = loadAllUsers();
  for (const uid in users) {
    if (users[uid].username === username) {
      return users[uid];
    }
  }
  return null;
}

/**
 * 根据UID查找用户
 * @param {string} uid
 * @returns {Object|null}
 */
function findUserByUid(uid) {
  const users = loadAllUsers();
  return users[uid] || null;
}

/**
 * 创建新用户
 * @param {string} username
 * @param {string} passwordHash - 建议使用 bcrypt 哈希
 * @returns {Object} 新用户对象
 */
function createUser(username, passwordHash) {
  const users = loadAllUsers();
  const uid = 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const newUser = {
    uid,
    username,
    passwordHash,
    characters: [],
    createdAt: new Date().toISOString()
  };
  users[uid] = newUser;
  saveAllUsers(users);
  return newUser;
}

/**
 * 添加角色绑定到用户
 * @param {string} uid - 用户ID
 * @param {string} characterUid - 角色ID
 */
function addCharacterToUser(uid, characterUid) {
  const users = loadAllUsers();
  if (users[uid]) {
    if (!users[uid].characters.includes(characterUid)) {
      users[uid].characters.push(characterUid);
      saveAllUsers(users);
    }
  }
}

/**
 * 从用户移除角色绑定
 * @param {string} uid - 用户ID
 * @param {string} characterUid - 角色ID
 */
function removeCharacterFromUser(uid, characterUid) {
  const users = loadAllUsers();
  if (users[uid]) {
    users[uid].characters = users[uid].characters.filter(c => c !== characterUid);
    saveAllUsers(users);
  }
}

// ==================== 角色存档操作（带内存缓存） ====================

/**
 * 获取角色存档文件路径
 * @param {string} characterUid
 * @returns {string}
 */
function getCharacterFilePath(characterUid) {
  return path.join(CHARACTERS_DIR, `${characterUid}.json`);
}

/**
 * 加载单个角色存档（优先内存缓存）
 * @param {string} characterUid
 * @returns {Object|null}
 */
function loadCharacter(characterUid) {
  // 优先从内存缓存读取
  if (_charactersCache.has(characterUid)) {
    return _charactersCache.get(characterUid);
  }
  // 回退到磁盘读取并缓存
  const file = getCharacterFilePath(characterUid);
  try {
    if (fs.existsSync(file)) {
      const char = JSON.parse(fs.readFileSync(file, 'utf8'));
      _charactersCache.set(characterUid, char);
      return char;
    }
  } catch (e) {
    console.error(`角色存档读取失败: ${characterUid}`, e);
  }
  return null;
}

/**
 * 保存角色存档（写入缓存 + 标记脏页）
 * @param {Object} character - 角色对象
 */
function saveCharacter(character) {
  if (!character || !character.uid) return;
  character.updatedAt = new Date().toISOString();
  _charactersCache.set(character.uid, character);
  _dirtyCharacters.add(character.uid);
}

/**
 * 删除角色存档
 * @param {string} characterUid
 */
function deleteCharacter(characterUid) {
  const file = getCharacterFilePath(characterUid);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

/**
 * 加载用户的所有角色
 * @param {string} uid - 用户ID
 * @returns {Array} 角色对象数组
 */
function loadUserCharacters(uid) {
  const user = findUserByUid(uid);
  if (!user) return [];
  return user.characters
    .map(cuid => loadCharacter(cuid))
    .filter(c => c !== null);
}

/**
 * ★ 孤儿角色恢复：扫描 data/characters/ 目录，
 * 将 ownerUid 匹配但未被用户记录引用的角色文件恢复到用户档案中。
 * 解决服务器重启/缓存丢失后角色不显示的 Bug。
 * @param {string} uid - 用户ID
 * @returns {Array} 恢复后的角色数组（含原本已关联的角色）
 */
function recoverOrphanCharacters(uid) {
  const user = findUserByUid(uid);
  if (!user) return [];

  const knownIds = new Set(user.characters || []);
  let recovered = false;

  // 扫描角色目录
  try {
    const files = fs.readdirSync(CHARACTERS_DIR);
    for (const filename of files) {
      if (!filename.endsWith('.json')) continue;
      const charUid = filename.replace('.json', '');
      if (knownIds.has(charUid)) continue; // 已关联，跳过

      const char = loadCharacter(charUid);
      if (char && char.ownerUid === uid) {
        // 孤儿角色：文件存在但用户记录未引用 → 恢复
        user.characters.push(charUid);
        knownIds.add(charUid);
        recovered = true;
        console.log(`[storage] 恢复孤儿角色: ${char.name} (${charUid}) → 用户 ${uid}`);
      }
    }
  } catch (e) {
    console.error('[storage] 扫描角色目录失败:', e.message);
  }

  if (recovered) {
    saveAllUsers(loadAllUsers()); // 标记脏页
  }

  // 返回完整的角色列表（含恢复的）
  return user.characters
    .map(cuid => loadCharacter(cuid))
    .filter(c => c !== null);
}

// ==================== 初始化调用 ====================
initStorage();

// ==================== 导出 ====================
module.exports = {
  loadAllUsers,
  saveAllUsers,
  findUserByUsername,
  findUserByUid,
  createUser,
  addCharacterToUser,
  removeCharacterFromUser,
  loadCharacter,
  saveCharacter,
  deleteCharacter,
  loadUserCharacters,
  recoverOrphanCharacters,
  flushToDisk,
  ensureFlushAndExit
};