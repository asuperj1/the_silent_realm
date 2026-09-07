// 批量生成 12 个职业的 LOL 封面风格无字立绘（方士样张已通过，跳过），覆盖 assets/characters/{id}.png
// 逐张串行 + 间隔，避免 429 限流
// 已嵌套防护：防抖 + 熔断重试 + 频率/每日限流 + 遍历安全计数器（见 image_request_guard.js / api_rate_limit.js）
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

const WIDTH = 768, HEIGHT = 1024;
const NEGATIVE = 'text, watermark, words, letters, logo, signature, lowres, blurry, deformed';

const STYLE = 'League of Legends splash art, epic fantasy hero portrait, full body composition, dramatic cinematic lighting, highly detailed digital painting, rich vibrant colors, dark moody background';

const jobs = [
  ['haidao', `pirate captain with an eyepatch, holding a flintlock pistol and a rum bottle, weathered leather coat, iron hook hand, stormy sea with a ship in background, ${STYLE}`],
  ['jiaodoushi', `roman gladiator wielding a massive greatsword, chains and scars on muscular body, bloodstained sand arena in background, ${STYLE}`],
  ['qiangshou', `western gunslinger cowboy with dual revolvers, long trench coat, bullet belt across chest, gunsmoke, night saloon town background, ${STYLE}`],
  ['qishi', `holy knight in full plate armor with a tower shield and a greatsword, divine golden holy light, castle hall background, ${STYLE}`],
  ['guanxingzhe', `celestial astrologer mage in flowing robes, floating star charts, sun and moon orbs, cosmic black hole background, ${STYLE}`],
  ['huanfashi', `arcane ring mage surrounded by floating magic rings and runic spell circles, blue mana energy, wizard robes, ${STYLE}`],
  ['lianjinshushi', `alchemist holding flasks and throwing a bomb, clay golem beside him, glowing philosopher's stone, amber alchemy lab background, ${STYLE}`],
  ['zhentan', `detective in a trench coat with a magnifying glass and a pipe, rainy victorian city night, moody fog and streetlamps, ${STYLE}`],
  ['baifuzhang', `roman centurion with a gladius short sword and a scutum tower shield, crested helmet, legion army battle background, ${STYLE}`],
  ['wushi', `japanese samurai with a katana, shadowy doppelganger behind him, zen spirit energy, dark mountain background, ${STYLE}`],
  ['guishuxiaochou', `trickster clown jester throwing knives, colorful makeup, playing cards floating, carnival chaos background, ${STYLE}`],
  ['jingguan', `old-fashioned police detective with a service revolver, handcuffs, a badge, trench coat, dark city night background, ${STYLE}`]
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const client = new JimengClient({ accessKey: env.JIMENG_ACCESS_KEY, secretKey: env.JIMENG_SECRET_KEY, region: 'cn-north-1' });
  // 密钥异常检测
  const cred = guard.checkCredentials(env.JIMENG_ACCESS_KEY, env.JIMENG_SECRET_KEY);
  if (!cred.ok) {
    console.error('❌ AK/SK 为空或失效，绘图模块已禁用（不发送请求）');
    rate.logNote('密钥检测失败，禁用绘图模块（gen_all_lol_portraits）');
    process.exit(3);
  }
  const dir = path.join(__dirname, '..', 'assets', 'characters');
  fs.mkdirSync(dir, { recursive: true });
  let ok = 0, fail = 0;
  const iter = guard.createIterationGuard(jobs.length);  // 遍历安全计数器：防止死循环遍历数组
  for (const [id, subject] of jobs) {
    if (!iter.step()) { console.error('遍历超限，强制终止'); break; }
    try {
      const prompt = subject;
      // 防护包装调用（防抖 + 限流 + 熔断重试 + 日志 + 有效扣费统计）
      const result = await guard.generateImage(client, { prompt, negative_prompt: NEGATIVE, width: WIDTH, height: HEIGHT, return_url: true }, {
        accountKey: env.JIMENG_ACCESS_KEY || 'default',
        playerKey: 'portrait-batch-' + id,
        maxRetries: 2,
        accessKey: env.JIMENG_ACCESS_KEY,
        secretKey: env.JIMENG_SECRET_KEY
      });
      if (result.blocked) { console.log('BLOCK', id, result.error); fail++; continue; }
      if (!result.success) { console.log('FAIL', id, result.error); fail++; continue; }
      const res = await fetch(result.image_urls[0]);
      if (!res.ok) throw new Error('download ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(dir, id + '.png'), buf);
      console.log('OK', id, buf.length + 'B', '(attempts', result.attempts + ')');
      ok++;
    } catch (e) {
      console.log('FAIL', id, e.message);
      fail++;
    }
    await sleep(2500); // 防 429 限流
  }
  console.log('done  ok=' + ok + ' fail=' + fail + ' -> ' + dir);
  console.log('当前状态:', JSON.stringify(rate.getStatus(env.JIMENG_ACCESS_KEY || 'default')));
})();

