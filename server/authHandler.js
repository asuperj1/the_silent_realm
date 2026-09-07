/**
 * authHandler.js — 认证 + 角色域（T-5 拆分产物）
 * 8 事件：register / login / autoLogin / getCharacterList / createCharacter / selectCharacter / deleteCharacter / updateAvatar
 * 不触共享状态（state.js），仅依赖 auth / storage / gameLogic。
 */

const storage = require('./storage');
const logger = require('./logger');
const auth = require('./auth');
const gameLogic = require('./gamelogic');

// 认证 + 角色域（8 事件）
function registerAuth(socket, io, state) {
  socket.on('register', data => auth.handleRegister(socket, data));
  socket.on('login', data => auth.handleLogin(socket, data));
  socket.on('autoLogin', data => auth.handleAutoLogin(socket, data));

  // ========== 角色管理（★ 身份一律取 socket.uid，忽略客户端传入 uid 防越权） ==========
  // ★ 角色名消毒：去尖括号（防存储型 XSS）+ 去控制字符 + 限长 20
  function sanitizeName(raw) {
    const s = String(raw || '').replace(/[<>]/g, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 20);
    return s || '调查员';
  }

  socket.on('getCharacterList', () => {
    const uid = socket.uid;
    if (!uid) return socket.emit('error', { msg: '请先登录' });
    const characters = storage.recoverOrphanCharacters(uid);
    if (characters.length > 0) {
      logger.user.info('角色列表同步', { uid, count: characters.length });
    }
    socket.emit('characterList', { characters });
  });

  socket.on('createCharacter', ({ characterData }) => {
    const uid = socket.uid;
    if (!uid || !characterData) return socket.emit('error', { msg: '参数不完整或未登录' });
    const user = storage.findUserByUid(uid);
    if (!user) return socket.emit('error', { msg: '用户不存在' });
    if (user.characters.length >= 5) return socket.emit('error', { msg: '角色数量已达上限' });

    const careerConfig = gameLogic.CAREERS[characterData.career];
    // ★ 技能树初始化（新职业）：精点 2 + 解锁/出战双流派初始技能
    const skillTreeMod = require('./skillTree');
    const treeId = skillTreeMod.getTreeId(characterData.career);
    let unlockedSkills = [], equippedSkills = [];
    if (treeId) {
      const init = skillTreeMod.getInitialSkills(treeId);
      unlockedSkills = init.slice();
      equippedSkills = init.slice();
    } else {
      unlockedSkills = (careerConfig ? careerConfig.skills : []).slice();
      equippedSkills = unlockedSkills.slice();
    }
    const characterUid = 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const attr = characterData.attr || {};
    const newCharacter = {
      uid: characterUid,
      ownerUid: uid,
      name: sanitizeName(characterData.name),
      career: characterData.career,
      level: 1, exp: 0, mysteryPoint: 100,
      skillPoints: treeId ? 2 : 0,
      attrPoints: 0,
      unlockedSkills,
      equippedSkills,
      hidden: { will: attr.wil || 40, soul: 40 },
      attr: {
        hp: (attr.con || 40) * 2, maxHp: (attr.con || 40) * 2,
        san: (attr.wil || 40), maxSan: 80,
        str: attr.str || 40, dex: attr.dex || 40,
        con: attr.con || 40, int: attr.int || attr.per || 40,
        cha: attr.cha || 40,
        // ★ 幸运初始随机 1~10（每账号每角色随机），上限 10
        lck: Math.min(10, Math.max(1, Number(attr.lck) || Math.floor(Math.random() * 10) + 1)),
        per: attr.int || attr.per || 40, wil: attr.wil || 40
      },
      skills: careerConfig ? careerConfig.skills : [],
      equip: { weapon: null, accessory: null },
      traits: [], skillCooldowns: {}, unlockCopy: [], sealedSkill: [],
      inventory: [],
      warehouse: [],
      clearedCopies: [],
      engravingTier: 'white',
      avatar: 'assets/placeholder.png',
      createTime: new Date().toISOString().split('T')[0]
    };
    storage.saveCharacter(newCharacter);
    storage.addCharacterToUser(uid, characterUid);
    socket.emit('characterCreated', { character: newCharacter });
  });

  // 选择角色（不进入任何房间，不设置房间状态）
  socket.on('selectCharacter', ({ characterUid }) => {
    const character = storage.loadCharacter(characterUid);
    if (!character) return socket.emit('error', { msg: '角色不存在' });
    // ★ 归属校验：有 ownerUid 的角色仅限本人选择（兼容无 ownerUid 的旧角色）
    if (character.ownerUid && character.ownerUid !== socket.uid) {
      return socket.emit('error', { msg: '无权选择该角色' });
    }
    socket.characterUid = characterUid;
    socket.character = character;
    // 计算刻痕等级
    const beginnerSet = new Set(gameLogic.BEGINNER_DUNGEONS);
    const cleared = character.clearedCopies || [];
    const allBeginnersCleared = gameLogic.BEGINNER_DUNGEONS.every(d => cleared.includes(d));
    const engravingTier = character.engravingTier || (allBeginnersCleared ? 'orange' : 'white');
    // 持久化更新刻痕
    if (engravingTier !== character.engravingTier) {
      character.engravingTier = engravingTier;
      storage.saveCharacter(character);
    }
    socket.emit('characterSelected', {
      character,
      players: [],
      clearedCopies: cleared,
      engravingTier
    });
  });

  socket.on('deleteCharacter', ({ characterUid }) => {
    const uid = socket.uid;
    if (!uid || !characterUid) return socket.emit('error', { msg: '参数缺失' });
    const character = storage.loadCharacter(characterUid);
    if (!character) return socket.emit('error', { msg: '角色不存在' });
    // ★ 归属校验：仅本人可删除
    if (character.ownerUid && character.ownerUid !== uid) {
      return socket.emit('error', { msg: '无权删除该角色' });
    }
    storage.deleteCharacter(characterUid);
    storage.removeCharacterFromUser(uid, characterUid);
    socket.emit('characterList', { characters: storage.loadUserCharacters(uid) });
  });

  // ========== 头像更新 ==========
  socket.on('updateAvatar', ({ avatarData }) => {
    const character = socket.character;
    if (!character) return socket.emit('error', { msg: '未加载角色' });
    character.avatar = avatarData;
    storage.saveCharacter(character);
    socket.emit('avatarUpdated', { avatar: avatarData });
    logger.user.info('头像已更新', { uid: character.uid });
  });
}

module.exports = { registerAuth };
