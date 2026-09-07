/**
 * image_request_guard.js — 即梦图像生成请求防护包装（防抖 + 熔断 + 密钥检测）
 *
 * 在「原有即梦调用函数」外层嵌套防护：
 *   const guard = require('./image_request_guard');
 *   const result = await guard.generateImage(client, { prompt, negative_prompt, width, height, return_url:true }, {
 *     accountKey: 'default',   // 账号维度（用于限流/日志）
 *     playerKey:  'batch-001', // 玩家/批次维度（用于防抖）
 *     maxRetries: 2            // 失败最多重试 2 次，第 3 次彻底终止（可调）
 *   });
 *   if (result.blocked) { console.log('被防护拦截，未发网络请求', result.error); }
 *   if (!result.success) { console.log('熔断终止或失败', result.error); }
 *
 * 防护层次（按顺序）：
 *   1. 密钥检测       —— AK/SK 为空 → 直接禁用绘图模块（不请求）
 *   2. 请求防抖       —— 同 accountKey+prompt 3 秒内只允许 1 次
 *   3. 频率限流       —— 每分钟 N 次（N 见 api_rate_limit.CONFIG）
 *   4. 每日额度       —— 每日有效扣费 M 次（M 见 api_rate_limit.CONFIG）
 *   5. 熔断重试       —— 失败最多重试 2 次，间隔 2s，第 3 次彻底终止
 *   6. 有效扣费统计   —— 仅成功返回图片才 markSuccess
 */
'use strict';
const rate = require('./api_rate_limit');

/* ══════════ 可调配置 ══════════ */
const CONFIG = {
  DEBOUNCE_MS: 3000,      // 防抖窗口：同一请求 3 秒内只放行 1 次
  MAX_RETRIES: 2,         // 失败最多重试 2 次（第 3 次调用后终止）
  RETRY_DELAY_MS: 2000,   // 重试间隔 2 秒（禁止毫秒级疯狂循环）
  MAX_BATCH_ITERATIONS: 500  // 批量遍历安全计数器上限（防止死循环遍历图片数组）
};

/* 防抖表：key -> 上次放行时间戳 */
const _debounceMap = new Map();

function _debounceKey(accountKey, prompt) {
  return accountKey + '::' + (prompt || '').slice(0, 120);
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 密钥异常检测：AK/SK 为空 → 绘图模块禁用。
 * @returns {{ok:boolean, reason?:string}}
 */
function checkCredentials(accessKey, secretKey) {
  if (!accessKey || !secretKey) {
    return { ok: false, reason: 'missing_credentials' };
  }
  return { ok: true };
}

/**
 * 防抖检查：同一请求 3 秒内只放行一次。
 * @returns {{ok:boolean, waitMs?:number}}
 */
function checkDebounce(accountKey, prompt) {
  const key = _debounceKey(accountKey, prompt);
  const now = Date.now();
  const last = _debounceMap.get(key) || 0;
  const elapsed = now - last;
  if (elapsed < CONFIG.DEBOUNCE_MS) {
    return { ok: false, waitMs: CONFIG.DEBOUNCE_MS - elapsed };
  }
  _debounceMap.set(key, now);
  // 定期清理防抖表，避免内存无限增长
  if (_debounceMap.size > 2000) {
    for (const [k, t] of _debounceMap) {
      if (now - t > 60000) _debounceMap.delete(k);
    }
  }
  return { ok: true };
}

/**
 * 批量遍历安全计数器：防止 while 死循环 / 数组无限遍历。
 * 用法：
 *   const iter = guard.createIterationGuard(500);
 *   while (condition) { if (!iter.step()) break; ... }
 */
function createIterationGuard(maxIterations) {
  let n = 0;
  const limit = (maxIterations && maxIterations > 0) ? maxIterations : CONFIG.MAX_BATCH_ITERATIONS;
  return {
    limit,
    step() {
      n++;
      if (n > limit) {
        rate.logNote('批量遍历超过安全上限 ' + limit + ' 次，已强制终止，防止死循环');
        return false;
      }
      return true;
    },
    count() { return n; }
  };
}

/**
 * 防护包装：在即梦 generateImage 外层加 防抖→限流→熔断重试→日志→有效扣费统计。
 * @param {object} client        JimengClient 实例
 * @param {object} params        { prompt, negative_prompt, width, height, return_url }
 * @param {object} opts          { accountKey, playerKey, maxRetries, accessKey, secretKey }
 * @returns {Promise<{success:boolean, image_urls?:string[], blocked?:string, error?:string, charged:boolean, attempts:number}>}
 */
async function generateImage(client, params, opts) {
  opts = opts || {};
  const accountKey = opts.accountKey || 'default';
  const playerKey = opts.playerKey || '-';
  const prompt = (params && params.prompt) || '';
  const maxRetries = (typeof opts.maxRetries === 'number') ? opts.maxRetries : CONFIG.MAX_RETRIES;
  const start = Date.now();
  const attempts = 0;

  /* 1. 密钥异常检测：AK/SK 为空 → 禁用绘图模块，不发送请求 */
  if (opts.accessKey !== undefined || opts.secretKey !== undefined) {
    const cred = checkCredentials(opts.accessKey, opts.secretKey);
    if (!cred.ok) {
      rate.logResult({ accountKey, playerKey, prompt, status: 'blocked', blocked: 'missing_credentials', charged: false, attempts, error: 'AK/SK 为空，绘图模块已禁用', ms: Date.now() - start });
      return { success: false, blocked: 'missing_credentials', error: 'AK/SK 为空，绘图模块已禁用', charged: false, attempts };
    }
  }

  /* 2. 请求防抖：3 秒内同一请求只放行 1 次 */
  const debounce = checkDebounce(accountKey, prompt);
  if (!debounce.ok) {
    rate.logResult({ accountKey, playerKey, prompt, status: 'blocked', blocked: 'debounce', charged: false, attempts, error: '重复请求防抖拦截', ms: Date.now() - start });
    return { success: false, blocked: 'debounce', error: '请求过于频繁，已拦截重复调用', charged: false, attempts };
  }

  /* 3. 频率限流：每分钟 N 次 */
  const freq = rate.checkFrequency(accountKey);
  if (!freq.ok) {
    rate.logResult({ accountKey, playerKey, prompt, status: 'blocked', blocked: 'rate_limit', charged: false, attempts, error: '每分钟调用超限', ms: Date.now() - start });
    return { success: false, blocked: 'rate_limit', error: '每分钟调用已达上限（' + rate.CONFIG.RATE_PER_MINUTE + ' 次），请稍后再试', charged: false, attempts };
  }

  /* 4. 每日有效额度 */
  const daily = rate.checkDaily(accountKey);
  if (!daily.ok) {
    rate.logResult({ accountKey, playerKey, prompt, status: 'blocked', blocked: 'daily_limit', charged: false, attempts, error: '每日额度耗尽', ms: Date.now() - start });
    return { success: false, blocked: 'daily_limit', error: '今日绘图额度已耗尽（' + rate.CONFIG.DAILY_LIMIT + ' 次），请联系管理员', charged: false, attempts };
  }

  /* 5. 熔断重试：最多 maxRetries 次重试，全部失败则彻底终止 */
  let lastError = '';
  let attempt = 0;
  for (; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // 重试前等待 2 秒（禁止毫秒级疯狂循环请求）
      await _sleep(CONFIG.RETRY_DELAY_MS);
      // 重试也受频率限流约束：超限则提前熔断终止，不再发请求
      const retryFreq = rate.checkFrequency(accountKey);
      if (!retryFreq.ok) {
        rate.logResult({ accountKey, playerKey, prompt, status: 'fail', blocked: 'rate_limit', charged: false, attempts: attempt + 1, error: '重试期间每分钟调用超限，熔断终止', ms: Date.now() - start });
        return { success: false, charged: false, attempts: attempt + 1, exhausted: true, error: '重试期间每分钟调用超限，已停止重试' };
      }
    }
    rate.markRequest(accountKey);   // 每次尝试（含重试）都计入频率窗口
    try {
      const result = await client.generateImage(params || {});
      // 判定成功：接口成功返回图片（url 或二进制流）
      if (result && result.success && result.image_urls && result.image_urls.length) {
        // 6. 有效扣费统计：仅成功返回图片才计入每日额度
        const used = rate.markSuccess(accountKey);
        rate.logResult({
          accountKey, playerKey, prompt,
          status: 'success', charged: true, attempts: attempt + 1,
          error: '', ms: Date.now() - start
        });
        return Object.assign({}, result, {
          success: true, charged: true, attempts: attempt + 1, dailyUsed: used
        });
      }
      lastError = JSON.stringify(result && (result.error || result.raw_response) || result);
      // 无图片返回视为失败，继续重试
    } catch (e) {
      lastError = (e && e.message) || String(e);
    }
    rate.logResult({
      accountKey, playerKey, prompt,
      status: 'fail', charged: false, attempts: attempt + 1,
      error: lastError, ms: Date.now() - start
    });
  }

  // 熔断终止：重试次数已用尽
  rate.logNote('图像生成失败，已停止重试。accountKey=' + accountKey + ' prompt=' + prompt.slice(0, 60));
  return {
    success: false,
    charged: false,
    attempts: maxRetries + 1,
    exhausted: true,
    error: '图像生成失败，已停止重试（共尝试 ' + (maxRetries + 1) + ' 次）'
  };
}

module.exports = {
  CONFIG,
  checkCredentials,
  checkDebounce,
  createIterationGuard,
  generateImage
};
