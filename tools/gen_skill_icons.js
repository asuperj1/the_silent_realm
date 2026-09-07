// 批量生成技能图标 512x512（通用 T2I，无字）-> assets/icons/skills/{职业id}/{序号}.png
// 用法: node tools/gen_skill_icons.js [职业id|all] [起始序号]
// 逐张串行 + 间隔，避免 429 限流；日志写入 logs/skill_icons_{pid}.log
// 已嵌套防护：防抖 + 熔断重试(guard) + 频率/每日限流 + 遍历安全计数器（见 image_request_guard.js / api_rate_limit.js）
const fs = require('fs');
const path = require('path');
const JimengClient = require('C:/Users/asuperj/AppData/Roaming/npm/node_modules/jimeng-ai-mcp/dist/src/index.js').JimengClient;
const guard = require('./image_request_guard');
const rate = require('./api_rate_limit');

const env = {};
try {
  const lines = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2];
  }
} catch (e) {}

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'skill_manifest.json'), 'utf8'));
const NEGATIVE = 'text, watermark, words, letters, numbers, symbols, chinese characters, label, ui element, description box, frame, border, lowres, blurry, deformed, flat vector, flat icon, logo, signature';
const BASE_STYLE = 'League of Legends ability icon, MOBA QWER skill icon, single heroic object or weapon or creature filling the frame, dramatic side rim lighting, painterly thick brush fantasy art, deep dark smoky background, subtle glowing edge highlight, ultra detailed epic, absolutely no text';
const BASE_STYLE_EN = 'absolutely no text, no letters, no numbers, no characters';
const promptOf = (name, theme) => `League of Legends skill ability icon for '${name}', ${theme}, ${BASE_STYLE}`;

// 职业主题（供 prompt 使用）
const THEME = {
  haidao: 'pirate rum fire alcohol theme, flame and ocean',
  jiaodoushi: 'roman gladiator blood and iron theme, arena chains',
  fangshi: 'taoist cultivator qi energy theme, yin yang talisman',
  qiangshou: 'western gunslinger bullet firearm theme, smokey revolver',
  qishi: 'holy knight shield and sword theme, divine gold light',
  guanxingzhe: 'celestial astrologer star constellation theme, sun moon cosmos',
  huanfashi: 'arcane ring mage magic circle theme, blue mana runes',
  lianjinshushi: 'alchemist flask bomb theme, green acid and fire',
  zhentan: 'detective clue magnifying glass theme, victorian mystery',
  baifuzhang: 'roman centurion gladius tower shield theme, legion iron',
  wushi: 'japanese samurai katana zen theme, spirit sakura',
  guishuxiaochou: 'trickster clown juggling knife theme, carnival cards',
  jingguan: 'old police revolver badge theme, law and steel'
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (pid, msg) => {
  const l = `${new Date().toISOString()} ${msg}\n`;
  console.log(l.trim());
  fs.appendFileSync(path.join(__dirname, '..', 'logs', `skill_icons_${pid}.log`), l);
};

(async () => {
  const target = process.argv[2] || 'all';
  const startIdx = parseInt(process.argv[3] || '1', 10);
  const client = new JimengClient({ accessKey: env.JIMENG_ACCESS_KEY, secretKey: env.JIMENG_SECRET_KEY, region: 'cn-north-1' });
  fs.mkdirSync(path.join(__dirname, '..', 'logs'), { recursive: true });

  // 密钥异常检测：AK/SK 为空 → 禁用绘图模块
  const cred = guard.checkCredentials(env.JIMENG_ACCESS_KEY, env.JIMENG_SECRET_KEY);
  if (!cred.ok) {
    console.error('❌ AK/SK 为空或失效，绘图模块已禁用（不发送请求）');
    rate.logNote('密钥检测失败，禁用绘图模块（gen_skill_icons）');
    process.exit(3);
  }

  const pids = target === 'all' ? Object.keys(manifest) : [target];
  let ok = 0, fail = 0, blocked = 0;
  // 遍历安全计数器：上限 = 职业数 * 每职业最大技能数（防死循环遍历图片数组无限调用）
  const iter = guard.createIterationGuard(pids.length * 40);
  for (const pid of pids) {
    const prof = manifest[pid];
    if (!prof) { console.log('unknown pid', pid); continue; }
    const theme = THEME[pid] || 'fantasy';
    const dir = path.join(__dirname, '..', 'assets', 'icons', 'skills', pid);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = startIdx - 1; i < prof.skills.length; i++) {
      if (!iter.step()) { console.error('遍历超限，强制终止，防止死循环'); break; }
      const name = prof.skills[i];
      const fname = path.join(dir, String(i + 1).padStart(3, '0') + '.png');
      if (fs.existsSync(fname)) { console.log('skip existing', pid, name); ok++; continue; }
      const prompt = promptOf(name, theme);
      // 防护包装调用（防抖 + 限流 + 熔断重试 + 日志 + 有效扣费统计）
      const result = await guard.generateImage(client, { prompt, negative_prompt: NEGATIVE, width: 512, height: 512, return_url: true }, {
        accountKey: env.JIMENG_ACCESS_KEY || 'default',
        playerKey: 'skill-icons-' + pid,
        maxRetries: 2,
        accessKey: env.JIMENG_ACCESS_KEY,
        secretKey: env.JIMENG_SECRET_KEY
      });
      if (result.blocked) {
        log(pid, `BLOCK ${String(i + 1).padStart(3, '0')} ${name} :: ${result.error}`);
        blocked++;
        // 每日额度耗尽等全局性拦截 → 直接终止整个批次
        if (result.blocked === 'daily_limit' || result.blocked === 'rate_limit' || result.blocked === 'missing_credentials') {
          log('_summary', '命中全局拦截 ' + result.blocked + '，终止批次');
          process.exit(4);
        }
        continue;
      }
      if (!result.success) {
        log(pid, `FAIL ${String(i + 1).padStart(3, '0')} ${name} :: ${result.error} (attempts ${result.attempts})`);
        fail++;
        continue;
      }
      try {
        const res = await fetch(result.image_urls[0]);
        if (!res.ok) throw new Error('download ' + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(fname, buf);
        log(pid, `OK  ${String(i + 1).padStart(3, '0')} ${name} ${buf.length}B (attempts ${result.attempts})`);
        ok++;
      } catch (e) {
        log(pid, `FAIL ${String(i + 1).padStart(3, '0')} ${name} download :: ${e.message}`);
        fail++;
      }
      await sleep(2500);
    }
  }
  log('_summary', `done ok=${ok} fail=${fail} blocked=${blocked}`);
  console.log('当前状态:', JSON.stringify(rate.getStatus(env.JIMENG_ACCESS_KEY || 'default')));
})();

