// 防护工具验证脚本（不实际调用火山 API，用 fake client）
// 用法: node test_guard.js
'use strict';
const guard = require('./image_request_guard');
const rate = require('./api_rate_limit');

const ACC = 'test-account-' + Date.now();  // 独立测试账号，不污染真实额度

async function main() {
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✅', name, extra || ''); }
    else { fail++; console.log('  ❌', name, extra || ''); }
  };

  console.log('═══ 1. 密钥异常检测 ═══');
  check('空 AK → 禁用', !guard.checkCredentials('', 'secret').ok);
  check('空 SK → 禁用', !guard.checkCredentials('ak', '').ok);
  check('完整密钥 → 放行', guard.checkCredentials('ak', 'sk').ok);

  console.log('═══ 2. 请求防抖（3s 内同请求只 1 次）═══');
  const db1 = guard.checkDebounce(ACC, 'prompt-x');
  const db2 = guard.checkDebounce(ACC, 'prompt-x');   // 立即重复 → 拦截
  check('首次放行', db1.ok);
  check('3s 内重复拦截', !db2.ok);

  console.log(`═══ 3. 频率限流（每分钟 ${rate.CONFIG.RATE_PER_MINUTE} 次）═══`);
  const RATE = rate.CONFIG.RATE_PER_MINUTE;
  let freqAllOk = true;
  for (let i = 0; i < RATE; i++) {
    const f = rate.checkFrequency(ACC);
    if (!f.ok) freqAllOk = false;
    rate.markRequest(ACC);
  }
  const fNext = rate.checkFrequency(ACC);
  check(`前 ${RATE} 次放行`, freqAllOk);
  check(`第 ${RATE + 1} 次拦截`, !fNext.ok);

  console.log(`═══ 4. 每日有效额度（${rate.CONFIG.DAILY_LIMIT} 次）═══`);
  const ACC_DAILY = ACC + '-daily';
  const DAILY = rate.CONFIG.DAILY_LIMIT;
  let dailyOk = true;
  for (let i = 0; i < DAILY; i++) {
    const d = rate.checkDaily(ACC_DAILY);
    if (!d.ok) dailyOk = false;
    rate.markSuccess(ACC_DAILY);
  }
  const dNext = rate.checkDaily(ACC_DAILY);
  check(`前 ${DAILY} 次放行`, dailyOk);
  check(`第 ${DAILY + 1} 次拦截（used=${DAILY}）`, !dNext.ok && dNext.used === DAILY);
  check('每日计数持久化', rate.getStatus(ACC_DAILY).dailyUsed === DAILY);

  console.log('═══ 5. 熔断重试（失败最多重试 2 次，第 3 次终止）═══');
  const ACC2 = ACC + '-rt';
  let calls = 0;
  const failClient = { generateImage: async () => { calls++; throw new Error('HTTP 500'); } };
  const r1 = await guard.generateImage(failClient, { prompt: 'p-fail' }, { accountKey: ACC2, playerKey: 't1', maxRetries: 2 });
  check('失败后熔断终止', !r1.success && r1.exhausted);
  check('共尝试 3 次（1+2 重试）', calls === 3, '(calls=' + calls + ')');

  console.log('═══ 6. 成功才计费 + 防抖包装 ═══');
  const okClient = { generateImage: async (p) => ({ success: true, image_urls: ['http://x/' + p.prompt] }) };
  const r2 = await guard.generateImage(okClient, { prompt: 'p-ok' }, { accountKey: ACC2, playerKey: 't2', maxRetries: 2 });
  check('成功返回图片', r2.success && r2.charged);
  check('成功计入每日额度', rate.getStatus(ACC2).dailyUsed === 1);
  // 同 prompt 3s 内再调 → 防抖拦截（不发网络请求）
  const r3 = await guard.generateImage(okClient, { prompt: 'p-ok' }, { accountKey: ACC2, playerKey: 't2', maxRetries: 2 });
  check('同请求防抖拦截（未发请求）', r3.blocked === 'debounce');

  console.log('═══ 7. 遍历安全计数器 ═══');
  const iter = guard.createIterationGuard(3);
  iter.step(); iter.step(); iter.step();
  check('超上限 step 返回 false', !iter.step());

  console.log('═══ 8. 日志落地 ═══');
  check('日志文件已生成', require('fs').existsSync(require('path').join(__dirname, '..', 'logs', 'jimeng_api.log')));

  console.log('\n结果：通过 ' + pass + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('测试异常', e); process.exit(1); });
