/**
 * gen_qingfeng_scenes.js — 青峰山虚空列车 场景图批量生成（基于地图 17 个标注点）
 * 每个标注点生成 2 张：正常（不遇怪）/ 遇怪（怪物现身），命名前缀「废都青峰山」
 * 输出：assets/qingfeng_scenes/废都青峰山{标注点}{正常|遇怪}.png
 * 用法: node tools/gen_qingfeng_scenes.js [all|清单序号|label关键字]
 * 例:   node tools/gen_qingfeng_scenes.js all            # 全量 34 张
 *       node tools/gen_qingfeng_scenes.js 1号车驾驶室     # 该点 2 张
 * 幂等：已存在图片自动跳过；串行 + 2.5s 间隔 + 防护（见 image_request_guard）
 */
const fs = require('fs');
const path = require('path');
const JimengClient = require('C:/Users/asuperj/AppData/Roaming/npm/node_modules/jimeng-ai-mcp/dist/src/index.js').JimengClient;
const guard = require('./image_request_guard');
const rate = require('./api_rate_limit');

// ==================== 读取 .env ====================
const env = {};
try {
  const lines = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2];
  }
} catch (e) {}

const NEGATIVE = 'text, watermark, words, letters, numbers, symbols, chinese characters, label, ui element, frame, border, lowres, blurry, deformed, flat vector, logo, signature, hands';
const BASE_STYLE = '克苏鲁恐怖场景插画，深色烟雾弥漫，昏暗灯光，戏剧性侧光，厚涂油画风格，电影感构图，超写实细节，前景主体清晰，无文字';

/**
 * 场景清单（与地图标注点一一对应）
 * env    = 车厢/隧道环境描述（正常）
 * monster= 该处可能遭遇的怪物现身描述（遇怪）
 */
const SCENES = [
  { label: '1号车驾驶室', env: '列车驾驶室，操控台被黑色粘液覆盖，一具列车长尸体倒伏在操控台前，仪表盘灯光微弱频闪，车窗映出幽蓝的虚空裂隙', monster: '操控台下方阴影中涌出两团漆黑的原生质体无形之子，表面浮沉无数半成形的眼球与拟足，正缓缓逼近' },
  { label: '1号车', env: 'G314列车1号车厢，座椅凌乱，壁灯昏暗闪烁，地板有拖拽血迹，尽头的驾驶室门半开漏出冷光', monster: '一团粘稠的黑色原生质体无形之子从座椅阴影中渗出，拟足蠕动，散发出泥浆沸腾般的湿润声响' },
  { label: '1号车外隧道', env: '青峰山隧道外壁，列车车顶被幽蓝的虚空裂隙包裹，壁面渗着诡异粘液，远处隧洞一片漆黑', monster: '一只粉红色的米·戈正沿车顶外壁向车头攀爬，蟹状节肢与触须晃动，头颅状的脑罐悬在身前' },
  { label: '2号车', env: 'G314列车2号二等座车厢，过道地板上倒卧着一名乘务员尸体，座椅散落行李，车窗被虚空粘液完全覆盖', monster: '车顶滴落粘稠液体聚成无形之子，从天花板上垂下，表面翻涌半成形的眼球与拟足' },
  { label: '2号车外隧道', env: '青峰山隧道2号车厢段外壁，壁面布满虚空裂隙的幽蓝光芒，空气中弥漫着潮湿的金属锈味', monster: '一只米·戈在车窗外爬行，粉红色节肢拍打玻璃，头颅状的脑罐贴近车窗向内窥探' },
  { label: '3号车', env: 'G314列车3号行李车厢，堆满行李箱与货箱，通风管道传出异常气流声，角落立着一根撬棍', monster: '两只无形之子从通风管道口挤入，黑色原生质体流淌到货箱上，拟足不断试探着四周' },
  { label: '3号车外隧道', env: '青峰山隧道3号车厢段，车窗外壁爬满发光的虚空纹路，隧道深处传来细碎的攀爬声', monster: '米·戈正沿车顶向1号车方向移动，粉红色节肢在隧道壁投下扭曲的阴影' },
  { label: '4号车', env: 'G314列车4号餐车，餐桌翻倒、餐具散落，厨房仍有蒸汽冒出，吧台后方的广播面板屏幕闪烁', monster: '厨房阴影中潜伏的米·戈探出触须，试图模仿人类呼救声引诱玩家靠近' },
  { label: '4号车外隧道', env: '青峰山隧道4号餐车段外壁，壁面渗着粘液，幽蓝裂隙光在黑暗中明灭', monster: '一只米·戈伏在车窗外，触须贴着玻璃蠕动，脑罐发出低沉的嗡鸣' },
  { label: '5号车', env: 'G314列车5号卧铺车厢，上下铺被褥散乱，墙壁有乘客挣扎的指甲划痕，走廊尽头一片昏暗', monster: '三只无形之子在走廊尽头成团蠕动，粘稠的原生质体相互挤压，无数眼球在黑暗中睁开' },
  { label: '2号车配电间', env: 'G314列车2号车配电间，裸露的电线与配电柜纵横交错，指示灯忽明忽暗，地上散落工具', monster: '无形之子从配电柜缝隙中挤出，黑色原生质体缠绕着电缆，火花在粘液中噼啪作响' },
  { label: '5号车外隧道', env: '青峰山隧道5号卧铺段外壁，壁面布满幽蓝裂隙，隧道顶部渗出粘稠水滴', monster: '米·戈在车窗外壁攀爬，粉红节肢抓挠金属，脑罐在黑暗中泛着冷光' },
  { label: '6号车', env: 'G314列车6号货物邮件车厢，堆满货箱与邮件袋，部分被粘液覆盖，通风口渗液', monster: '一只无形之子潜伏在货堆缝隙中，黑色拟足从邮件袋间探出，半成形眼球缓缓转动' },
  { label: '6号车外隧道', env: '青峰山隧道6号货物段外壁，壁面渗着黑色粘液，幽蓝虚空裂隙在黑暗中蜿蜒', monster: '米·戈的节肢影子掠过车窗，粉红色触须在玻璃上留下黏湿的痕迹' },
  { label: '5号车餐车餐室', env: 'G314列车餐车餐室，木质桌椅翻倒，餐具散落一地，墙上挂钟停在23:47，餐车台面蒙着薄尘', monster: '无形之子从餐车台面下渗出，黑色原生质体漫过地板，拟足伸向熄灭的壁灯' },
  { label: '7号车', env: 'G314列车7号乘务设备车厢，乘务员休息区与设备间，末尾设备间的门被塌落的货架与粘液卡死', monster: '两只无形之子在设备间门外徘徊，粘稠原生质体堵住救援路线，门缝里传来急促的敲击声' },
  { label: '7号车外隧道', env: '青峰山隧道7号乘务段外壁，壁面裂开幽蓝的虚空缝隙，隧道深处一片死寂', monster: '米·戈伏在车窗外壁上，触须缓缓伸向被卡死的设备间车窗' }
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (msg) => {
  const l = `${new Date().toISOString()} ${msg}\n`;
  console.log(l.trim());
  fs.appendFileSync(path.join(__dirname, '..', 'logs', 'qingfeng_scenes.log'), l);
};

function promptOf(scene, variant) {
  if (variant === 'monster') {
    return `${scene.env}。${scene.monster}。${BASE_STYLE}，恐怖氛围浓烈，怪物清晰可见`;
  }
  if (variant === 'carview') {
    // 车外隧道透过车窗观察车内（可触发场景）
    return `青峰山隧道外的观察视角，透过列车车窗向内窥探：${scene.env}。${BASE_STYLE}，车窗玻璃有反光，隧道幽蓝裂隙光透过玻璃映照车内，车内景象在玻璃后隐约可见`;
  }
  return `${scene.env}。${BASE_STYLE}，此刻尚未出现怪物，场景安静而压抑，只有环境细节`;
}

(async () => {
  const target = process.argv[2] || 'all';
  const client = new JimengClient({ accessKey: env.JIMENG_ACCESS_KEY, secretKey: env.JIMENG_SECRET_KEY, region: 'cn-north-1' });
  const outDir = path.join(__dirname, '..', 'assets', 'qingfeng_scenes');
  fs.mkdirSync(path.join(__dirname, '..', 'logs'), { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const cred = guard.checkCredentials(env.JIMENG_ACCESS_KEY, env.JIMENG_SECRET_KEY);
  if (!cred.ok) {
    console.error('❌ AK/SK 为空或失效，绘图模块已禁用');
    rate.logNote('密钥检测失败，禁用绘图模块（gen_qingfeng_scenes）');
    process.exit(3);
  }

  let list = SCENES;
  if (target !== 'all') {
    list = SCENES.filter(s => s.label.includes(target) || String(SCENES.indexOf(s)) === target);
  }
  if (!list.length) { console.log('无匹配场景', target); process.exit(0); }

  // 展开为 (label, variant) 对：车厢点 2 变体，外隧道点 +1「车窗观察车内」= 3 变体
  const jobs = [];
  for (const s of list) {
    const isTunnel = s.label.includes('外隧道');
    jobs.push({ scene: s, variant: 'normal', file: `废都青峰山${s.label}正常.png` });
    jobs.push({ scene: s, variant: 'monster', file: `废都青峰山${s.label}遇怪.png` });
    if (isTunnel) jobs.push({ scene: s, variant: 'carview', file: `废都青峰山${s.label}车内观察.png` });
  }

  console.log(`待生成 ${jobs.length} 张（${list.length} 个标注点，含外隧道点车内观察变体）`);
  const iter = guard.createIterationGuard(jobs.length + 5);
  let ok = 0, fail = 0, blocked = 0, skip = 0;
  for (const job of jobs) {
    if (!iter.step()) { console.error('遍历超限，强制终止'); break; }
    const fname = path.join(outDir, job.file);
    if (fs.existsSync(fname)) { log(`SKIP ${job.file} (已存在)`); skip++; continue; }
    const prompt = promptOf(job.scene, job.variant);
    let result;
    for (let retry = 1; retry <= 8; retry++) {
      result = await guard.generateImage(client, { prompt, negative_prompt: NEGATIVE, width: 1280, height: 720, return_url: true }, {
        accountKey: env.JIMENG_ACCESS_KEY || 'default',
        playerKey: 'qfs-scene-' + job.file,
        maxRetries: 2,
        accessKey: env.JIMENG_ACCESS_KEY,
        secretKey: env.JIMENG_SECRET_KEY
      });
      if (result.blocked === 'rate_limit') { log(`WAIT ${job.file} 频率超限，等待 65s (${retry}/8)`); await sleep(65000); continue; }
      break;
    }
    if (result.blocked) {
      log(`BLOCK ${job.file} :: ${result.error}`);
      blocked++;
      if (result.blocked === 'daily_limit' || result.blocked === 'missing_credentials') { log('_summary', '命中全局拦截，终止'); process.exit(4); }
      continue;
    }
    if (!result.success) { log(`FAIL ${job.file} :: ${result.error}`); fail++; continue; }
    try {
      const res = await fetch(result.image_urls[0]);
      if (!res.ok) throw new Error('download ' + res.status);
      fs.writeFileSync(fname, Buffer.from(await res.arrayBuffer()));
      log(`OK  ${job.file}`);
      ok++;
    } catch (e) { log(`FAIL ${job.file} download :: ${e.message}`); fail++; }
    await sleep(2500);
  }
  log(`_summary done ok=${ok} fail=${fail} blocked=${blocked} skip=${skip}`);
  console.log('当前状态:', JSON.stringify(rate.getStatus(env.JIMENG_ACCESS_KEY || 'default')));
})();
