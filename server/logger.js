/**
 * 日志系统模块
 * 支持分级日志：INFO / WARN / ERROR / DEBUG
 * 日志按日期划分文件，包含时间戳、用户ID、角色ID、事件详情
 */

const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================
const LOG_DIR = './logs';
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};
const CURRENT_LOG_LEVEL = LOG_LEVELS.DEBUG; // 最低记录级别

// ==================== 初始化 ====================
function initLogger() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * 获取当天日志文件路径
 * @param {string} category - 日志类别（user/battle/interaction/error）
 * @returns {string}
 */
function getLogFilePath(category) {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOG_DIR, `${date}_${category}.log`);
}

/**
 * 格式化时间戳
 * @returns {string}
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * 写入日志
 * @param {string} level - 日志级别（INFO/WARN/ERROR/DEBUG）
 * @param {string} category - 日志类别
 * @param {string} event - 事件名称
 * @param {Object} details - 事件详情
 */
function writeLog(level, category, event, details = {}) {
  if (LOG_LEVELS[level] < CURRENT_LOG_LEVEL) return;

  const logEntry = {
    timestamp: getTimestamp(),
    level,
    category,
    event,
    details
  };

  const logLine = JSON.stringify(logEntry) + '\n';
  const filePath = getLogFilePath(category);

  try {
    fs.appendFileSync(filePath, logLine, 'utf8');
  } catch (e) {
    console.error('日志写入失败:', e);
  }

  // 同时输出到控制台
  const consoleMsg = `[${logEntry.timestamp}] [${level}] [${category}] ${event}`;
  switch (level) {
    case 'ERROR': console.error(consoleMsg, details); break;
    case 'WARN': console.warn(consoleMsg, details); break;
    default: console.log(consoleMsg, details);
  }
}

// ==================== 分类日志函数 ====================

/**
 * 用户日志：注册、登录、退出、角色操作
 */
const userLogger = {
  info: (event, details) => writeLog('INFO', 'user', event, details),
  warn: (event, details) => writeLog('WARN', 'user', event, details),
  error: (event, details) => writeLog('ERROR', 'user', event, details)
};

/**
 * 战斗日志：攻击、伤害、血量变化、阵亡
 */
const battleLogger = {
  info: (event, details) => writeLog('INFO', 'battle', event, details),
  warn: (event, details) => writeLog('WARN', 'battle', event, details),
  error: (event, details) => writeLog('ERROR', 'battle', event, details)
};

/**
 * 交互日志：KP指令、玩家行动、副本触发
 */
const interactionLogger = {
  info: (event, details) => writeLog('INFO', 'interaction', event, details),
  warn: (event, details) => writeLog('WARN', 'interaction', event, details),
  error: (event, details) => writeLog('ERROR', 'interaction', event, details)
};

/**
 * 异常日志：接口报错、参数非法、交互异常
 */
const errorLogger = {
  info: (event, details) => writeLog('INFO', 'error', event, details),
  warn: (event, details) => writeLog('WARN', 'error', event, details),
  error: (event, details) => writeLog('ERROR', 'error', event, details)
};

// ==================== 初始化调用 ====================
initLogger();

// ==================== 导出 ====================
module.exports = {
  user: userLogger,
  battle: battleLogger,
  interaction: interactionLogger,
  error: errorLogger
};