// 生成 LOL 英雄封面风格、无文字的通用文生图（走包内 JimengClient.generateImage，非文字海报）
// 用法: node gen_lol_portrait.js "<prompt>" <输出.png> [宽] [高]
// 已嵌套防护：防抖 + 熔断重试 + 频率/每日限流 + 日志（见 image_request_guard.js / api_rate_limit.js）
const fs = require('fs');
const path = require('path');
const JimengClient = require('C:/Users/asuperj/AppData/Roaming/npm/node_modules/jimeng-ai-mcp/dist/src/index.js').JimengClient;
const guard = require('./image_request_guard');
const rate = require('./api_rate_limit');

// 读 .env
const env = {};
try {
  const lines = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2];
  }
} catch (e) { /* ignore */ }

const accessKey = env.JIMENG_ACCESS_KEY || process.env.JIMENG_ACCESS_KEY;
const secretKey = env.JIMENG_SECRET_KEY || process.env.JIMENG_SECRET_KEY;

const prompt = process.argv[2];
const outFile = process.argv[3] || path.join(__dirname, '..', 'assets', 'characters', 'sample.png');
const width = parseInt(process.argv[4] || '768', 10);
const height = parseInt(process.argv[5] || '1024', 10);
const negative = process.argv[6] || 'text, watermark, words, letters, logo, signature, lowres, blurry';

const client = new JimengClient({ accessKey, secretKey, region: 'cn-north-1' });

(async () => {
  // 密钥异常检测：AK/SK 为空 → 直接禁用绘图模块
  const cred = guard.checkCredentials(accessKey, secretKey);
  if (!cred.ok) {
    console.error('❌ AK/SK 为空或失效，绘图模块已禁用（不发送请求）。请检查 .env 的 JIMENG_ACCESS_KEY / JIMENG_SECRET_KEY');
    rate.logNote('密钥检测失败，禁用绘图模块（gen_lol_portrait）');
    process.exit(3);
  }
  // 防护包装调用（防抖 + 限流 + 熔断重试 + 日志 + 有效扣费统计）
  const result = await guard.generateImage(client, {
    prompt,
    negative_prompt: negative,
    width,
    height,
    return_url: true
  }, {
    accountKey: accessKey || 'default',
    playerKey: 'lol-portrait',
    maxRetries: 2,
    accessKey,
    secretKey
  });
  if (result.blocked) {
    console.error('⛔ 请求被拦截：', result.error);
    process.exit(2);
  }
  if (!result.success) {
    console.error('❌ 生成失败（熔断终止）：', result.error);
    process.exit(1);
  }
  const url = result.image_urls[0];
  const res = await fetch(url);
  if (!res.ok) throw new Error('download HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  console.log('OK', buf.length, 'bytes ->', outFile, '(有效扣费 +1，本次尝试', result.attempts, '次)');
  console.log('当前状态:', JSON.stringify(rate.getStatus(accessKey || 'default')));
})();

