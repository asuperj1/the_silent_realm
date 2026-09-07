/**
 * api_rate_limit.js — 火山引擎即梦图像生成 API 限流 + 每日额度 + 调用日志
 *
 * ════════════════════════════════════════════════════════════════════
 *  ★ 修改限流数值（只需改下面 CONFIG 常量，无需改其他代码）：
 *    - CONFIG.RATE_PER_MINUTE : 单账号每分钟最多发起请求次数（当前 5）
 *    - CONFIG.DAILY_LIMIT      : 单账号单日最多有效扣费次数（当前 30）
 *    - CONFIG.RETRY_DELAY_MS   : 失败重试间隔毫秒（当前 2000，见 image_request_guard）
 *  ★ 判定口径：只有「接口成功返回图片二进制流」才记为有效扣费；
 *    失败 / 超时 / 被限流拦截的请求均不计入每日额度统计。
 * ════════════════════════════════════════════════════════════════════
 *
 * 用法：
 *   const rate = require('./api_rate_limit');
 *   const freq = rate.checkFrequency(accountKey);   // 每分钟限流检查
 *   const daily = rate.checkDaily(accountKey);      // 每日有效额度检查
 *   // ... 实际调用 ...
 *   rate.markRequest(accountKey);                   // 记录一次请求（频率窗口）
 *   rate.markSuccess(accountKey);                   // 成功返回图片 → 有效扣费 +1
 *   rate.logResult({ ... });                        // 落日志
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ══════════ 可调配置（修改此处即改限额） ══════════ */
const CONFIG = {
  RATE_PER_MINUTE: 10,                // 频率限流：单账号每分钟最多 10 次请求（全量批次临时放宽，原 5）
  DAILY_LIMIT: 300,                   // 单日总量上限：单账号每日最多 300 次有效扣费（G-020~041 补齐批次临时放宽，原 100）
  FREQ_WINDOW_MS: 60 * 1000,          // 频率窗口：60 秒
  LOG_DIR: path.join(__dirname, '..', 'logs'),
  STATE_FILE: path.join(__dirname, '..', 'logs', 'jimeng_rate_state.json')  // 每日计数持久化
};

/* ══════════ 内存状态 ══════════ */
const _reqTimes = new Map();          // accountKey -> number[] 近 60s 请求时间戳
let _daily = {};                      // { date: 'YYYY-MM-DD', counts: { accountKey: n } }
let _dailyLoaded = false;

function _today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function _ensureDir() {
  try { fs.mkdirSync(CONFIG.LOG_DIR, { recursive: true }); } catch (e) {}
}

/** 从磁盘加载当日计数（进程重启不丢每日额度） */
function _loadDaily() {
  if (_dailyLoaded) return;
  _dailyLoaded = true;
  try {
    const raw = fs.readFileSync(CONFIG.STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data.date === _today()) {
      _daily = data;
    } else {
      _daily = { date: _today(), counts: {} };
    }
  } catch (e) {
    _daily = { date: _today(), counts: {} };
  }
}

function _persistDaily() {
  _ensureDir();
  try { fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify(_daily, null, 2), 'utf8'); } catch (e) {}
}

function _dayCount(accountKey) {
  _loadDaily();
  return _daily.counts[accountKey] || 0;
}

/**
 * 频率限流检查：近 60s 内请求次数是否已达上限。
 * @returns {{ok:boolean, reason?:string, remaining?:number, windowMs?:number}}
 */
function checkFrequency(accountKey) {
  const key = accountKey || 'default';
  const now = Date.now();
  const times = (_reqTimes.get(key) || []).filter(t => now - t < CONFIG.FREQ_WINDOW_MS);
  _reqTimes.set(key, times);
  if (times.length >= CONFIG.RATE_PER_MINUTE) {
    const oldest = times[0] || now;
    const waitMs = Math.max(0, oldest + CONFIG.FREQ_WINDOW_MS - now);
    return { ok: false, reason: 'rate_limit', remaining: 0, waitMs, windowMs: CONFIG.FREQ_WINDOW_MS };
  }
  return { ok: true, remaining: CONFIG.RATE_PER_MINUTE - times.length };
}

/** 记录一次请求（用于频率窗口） */
function markRequest(accountKey) {
  const key = accountKey || 'default';
  const now = Date.now();
  const times = (_reqTimes.get(key) || []).filter(t => now - t < CONFIG.FREQ_WINDOW_MS);
  times.push(now);
  _reqTimes.set(key, times);
}

/**
 * 每日有效扣费额度检查。
 * @returns {{ok:boolean, reason?:string, used:number, limit:number}}
 */
function checkDaily(accountKey) {
  const key = accountKey || 'default';
  _loadDaily();
  const used = _dayCount(key);
  if (used >= CONFIG.DAILY_LIMIT) {
    return { ok: false, reason: 'daily_limit', used, limit: CONFIG.DAILY_LIMIT };
  }
  return { ok: true, used, limit: CONFIG.DAILY_LIMIT };
}

/** 成功返回图片 → 有效扣费 +1 并持久化（失败不计入） */
function markSuccess(accountKey) {
  const key = accountKey || 'default';
  _loadDaily();
  if (_daily.date !== _today()) _daily = { date: _today(), counts: {} };
  _daily.counts[key] = (_daily.counts[key] || 0) + 1;
  _persistDaily();
  return _daily.counts[key];
}

/** 获取当前状态（供排查/展示） */
function getStatus(accountKey) {
  const key = accountKey || 'default';
  return {
    date: _today(),
    minuteUsed: (_reqTimes.get(key) || []).length,
    minuteLimit: CONFIG.RATE_PER_MINUTE,
    dailyUsed: _dayCount(key),
    dailyLimit: CONFIG.DAILY_LIMIT
  };
}

/**
 * 调用日志落地（无论成功失败都记录）。
 * entry: { accountKey, playerKey, prompt, status, charged, attempts, error, ms, at }
 */
function logResult(entry) {
  _ensureDir();
  const file = path.join(CONFIG.LOG_DIR, 'jimeng_api.log');
  const line = JSON.stringify(Object.assign({
    at: new Date().toISOString(),
    accountKey: entry.accountKey || 'default',
    playerKey: entry.playerKey || '-',
    prompt: (entry.prompt || '').slice(0, 200),
    status: entry.status || 'unknown',       // success | fail | blocked
    charged: !!entry.charged,                // 是否有效扣费（成功返回图片）
    attempts: entry.attempts || 0,
    error: entry.error || '',
    ms: entry.ms || 0
  })) + '\n';
  try { fs.appendFileSync(file, line, 'utf8'); } catch (e) {}
}

/** 写入一条明文说明日志（熔断提示等） */
function logNote(msg) {
  _ensureDir();
  const file = path.join(CONFIG.LOG_DIR, 'jimeng_api.log');
  try { fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), note: msg }) + '\n', 'utf8'); } catch (e) {}
}

module.exports = {
  CONFIG,
  checkFrequency,
  markRequest,
  checkDaily,
  markSuccess,
  getStatus,
  logResult,
  logNote
};
