/**
 * 用户认证模块
 * 处理注册、登录、自动登录逻辑
 * 新增简易内存会话管理，使 autoLogin 可正常工作
 */

const crypto = require('crypto');
const storage = require('./storage');
const logger = require('./logger');

// ==================== 简易会话存储（生产环境应使用 Redis 等） ====================
const sessions = new Map(); // token -> { uid, username, createdAt }

// 会话有效期（毫秒）
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24小时

// 定期清理过期会话
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of sessions) {
    if (now - data.createdAt > SESSION_DURATION) {
      sessions.delete(token);
    }
  }
}, 60 * 60 * 1000); // 每小时清理一次

// ==================== 工具函数 ====================
// ★ 密码哈希：scrypt（慢哈希 + per-user 随机盐）；旧 sha256 格式自动兼容
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const hash = parts[2];
    const calc = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    if (expected.length !== calc.length) return false;
    return crypto.timingSafeEqual(expected, calc);
  }
  // 旧格式（sha256 + 固定盐）兼容
  return crypto.createHash('sha256').update(password + 'cthulhu_salt').digest('hex') === stored;
}

// ★ 密码学安全 token：crypto.randomBytes 替代 Math.random
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ==================== 认证逻辑 ====================

/**
 * 处理注册
 */
function handleRegister(socket, data) {
  const { username, password } = data;

  if (!username || !password) {
    socket.emit('authError', { msg: '用户名和密码不能为空' });
    logger.user.warn('注册失败-参数为空', { username });
    return;
  }
  if (username.length < 2 || username.length > 20) {
    socket.emit('authError', { msg: '用户名长度需在2-20个字符之间' });
    return;
  }
  if (password.length < 6) {
    socket.emit('authError', { msg: '密码长度至少6位' });
    return;
  }

  const existing = storage.findUserByUsername(username);
  if (existing) {
    socket.emit('authError', { msg: '用户名已被注册' });
    logger.user.warn('注册失败-用户名已存在', { username });
    return;
  }

  const passwordHash = hashPassword(password);
  const user = storage.createUser(username, passwordHash);
  const token = generateToken();
  sessions.set(token, { uid: user.uid, username, createdAt: Date.now() });
  socket.uid = user.uid; // ★ 身份绑定到 socket

  logger.user.info('用户注册成功', { uid: user.uid, username });
  socket.emit('authSuccess', { username: user.username, uid: user.uid, token });
}

/**
 * 处理登录
 */
function handleLogin(socket, data) {
  const { username, password } = data;

  if (!username || !password) {
    socket.emit('authError', { msg: '用户名和密码不能为空' });
    logger.user.warn('登录失败-参数为空', { username });
    return;
  }

  const user = storage.findUserByUsername(username);
  if (!user) {
    socket.emit('authError', { msg: '用户名或密码错误' });
    logger.user.warn('登录失败-用户不存在', { username });
    return;
  }

  if (!verifyPassword(password, user.passwordHash)) {
    socket.emit('authError', { msg: '用户名或密码错误' });
    logger.user.warn('登录失败-密码错误', { uid: user.uid });
    return;
  }

  const token = generateToken();
  sessions.set(token, { uid: user.uid, username, createdAt: Date.now() });
  socket.uid = user.uid; // ★ 身份绑定到 socket

  logger.user.info('用户登录成功', { uid: user.uid, username });
  socket.emit('authSuccess', { username: user.username, uid: user.uid, token });
}

/**
 * 处理自动登录（通过令牌）
 */
function handleAutoLogin(socket, data) {
  const { token } = data;

  if (!token) {
    socket.emit('authError', { msg: '令牌缺失，请重新登录' });
    return;
  }

  const session = sessions.get(token);
  if (!session) {
    socket.emit('authError', { msg: '令牌无效或已过期，请重新登录' });
    return;
  }

  // 验证用户是否依然存在
  const user = storage.findUserByUid(session.uid);
  if (!user) {
    socket.emit('authError', { msg: '用户不存在' });
    sessions.delete(token);
    return;
  }

  // 令牌有效，续期
  session.createdAt = Date.now();
  socket.uid = user.uid; // ★ 身份绑定到 socket
  logger.user.info('自动登录成功', { uid: user.uid, username: user.username });
  socket.emit('authSuccess', { username: user.username, uid: user.uid, token });
}

module.exports = {
  handleRegister,
  handleLogin,
  handleAutoLogin,
  // 解析会话 token → 用户名（供 HTTP 接口鉴权，如地图编辑器保存）
  getSessionUsername(token) {
    if (!token) return null;
    const s = sessions.get(token);
    return s ? s.username : null;
  }
};