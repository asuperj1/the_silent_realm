/**
 * gen_battle_assets.js — 战斗场景素材批量生成（底层 T2I，无字）
 * 1) 9 张战斗背景图（8 车厢 + 1 车外共用）→ assets/battle/bg_*.png
 * 2) 13 职业 Q 版像素立绘（明日方舟像素风，小）→ assets/battle/player_{id}.png
 * 3) 怪物 Q 版像素图 → assets/battle/monster_*.png
 * 用法: node tools/gen_battle_assets.js [all|bg|player|monster|bg_car1|player_fangshi|monster_formless]
 * 逐张串行 + 2.5s 间隔 + 防护（见 image_request_guard / api_rate_limit），幂等跳过已存在
 */
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

const NEGATIVE = 'text, watermark, words, letters, numbers, symbols, chinese characters, label, ui element, description box, frame, border, lowres, blurry, deformed, flat vector, logo, signature, hands';

// ★ 战斗背景（克苏鲁暗黑空旷战斗场地，适合摆放 Q 版立绘）
const BATTLE_BG = {
  bg_car1:   'G314 train cab interior battle arena, empty driver cabin with cracked console, dim flickering lights, deep shadows, dark cosmic fog, flat open floor for combat',
  bg_car2:   'G314 train second-class coach battle arena, rows of empty seats pushed aside, dim lantern light, dark smoke, open corridor floor for combat',
  bg_car3:   'G314 train luggage car battle arena, stacks of crates and trunks, narrow open aisle, faint blue glow from windows, dark eerie atmosphere',
  bg_car4:   'G314 train dining car battle arena, overturned tables and scattered cutlery, dim kitchen glow, open central floor for combat',
  bg_car5:   'G314 train sleeper car battle arena, bunk beds lining walls, dim red emergency light, narrow open aisle for combat',
  bg_car6:   'G314 train mail cargo car battle arena, piles of mail bags and parcels, dim hanging lamp, open floor for combat',
  bg_car7:   'G314 train service equipment car battle arena, tool racks and lockers, dim industrial light, open corridor for combat',
  bg_car8:   'G314 train private cabin battle arena, small compartment with beds and table cleared, dim lamp, cramped open floor for combat',
  bg_outside:'outside of G314 train on tunnel wall battle arena, black cosmic void tunnel, glowing blue rift light, narrow rock ledge platform for combat'
};
const BG_STYLE = ', tiny cute chibi pixel art battle background, 8-bit 32-bit game environment pixel art, Arknights style pixel scene, wide open empty foreground for combat, dark cosmic horror atmosphere, deep dark smoky mood, dramatic dim lighting, pixelated detailed, absolutely no text';

// ★ 13 职业 Q 版像素立绘（明日方舟像素风 chibi）
const CLASS_PIXEL = {
  haidao:       'pirate with cutlass and tricorn hat, eye patch',
  jiaodoushi:   'gladiator with gladius sword and round shield, roman armor',
  fangshi:      'taoist mystic with yellow talisman robe and daoist hat, holding talisman scroll',
  qiangshou:    'gunslinger with twin revolvers, long duster coat and wide-brim hat',
  qishi:        'knight in full plate armor with lance and kite shield',
  guanxingzhe:  'astrologer with starry robe, holding celestial orb, crescent moon motif',
  huanfashi:    'ring mage with glowing magic rings around arms, arcane robe',
  lianjinshushi:'alchemist with goggles, holding potion flask, chemistry belt with vials',
  zhentan:      'detective with magnifying glass, trench coat and deerstalker hat',
  baifuzhang:   'centurion with gladius and plumed crest helmet, segmented lorica armor',
  wushi:        'samurai with katana, dark lacquered armor and horned kabuto helmet',
  guishuxiaochou:'trickster jester with playing cards, motley harlequin costume and mask',
  jingguan:     'police officer with badge, holding revolver, peaked cap and dark uniform'
};
const PIXEL_STYLE = ', tiny cute chibi pixel art, Arknights style pixel sprite, small game character sprite, pixelated 32-bit, full body, dark fantasy moody lighting, clean readable silhouette, transparent-feel dark background, absolutely no text';

// ★ 怪物 Q 版像素图
const MONSTER_PIXEL = {
  monster_formless: 'formless spawn, amorphous black protoplasmic mass with half-formed eyes and pseudopods',
  monster_shoggoth: 'shoggoth, giant bubbling black amoeboid horror with many eyes and tendrils',
  monster_migo:     'mi-go, pink crustacean-fungus creature with crab-like limbs, folded wings and brain cylinder'
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (msg) => {
  const l = `${new Date().toISOString()} ${msg}\n`;
  console.log(l.trim());
  fs.appendFileSync(path.join(__dirname, '..', 'logs', 'battle_assets.log'), l);
};

function promptOf(key) {
  if (BATTLE_BG[key]) return BATTLE_BG[key] + BG_STYLE;
  if (CLASS_PIXEL[key]) return `game battle chibi for '${key}', ${CLASS_PIXEL[key]}${PIXEL_STYLE}`;
  if (MONSTER_PIXEL[key]) return `game battle monster chibi, ${MONSTER_PIXEL[key]}${PIXEL_STYLE}`;
  return null;
}

(async () => {
  const targets = (process.argv.slice(2).length ? process.argv.slice(2) : ['all']);
  const client = new JimengClient({ accessKey: env.JIMENG_ACCESS_KEY, secretKey: env.JIMENG_SECRET_KEY, region: 'cn-north-1' });
  fs.mkdirSync(path.join(__dirname, '..', 'logs'), { recursive: true });
  fs.mkdirSync(path.join(__dirname, '..', 'assets', 'battle'), { recursive: true });

  const cred = guard.checkCredentials(env.JIMENG_ACCESS_KEY, env.JIMENG_SECRET_KEY);
  if (!cred.ok) { console.error('❌ AK/SK 为空或失效'); process.exit(3); }

  const all = [...Object.keys(BATTLE_BG), ...Object.keys(CLASS_PIXEL), ...Object.keys(MONSTER_PIXEL)];
  const list = [];
  for (const t of targets) {
    let matched;
    if (t === 'all') matched = all;
    else if (t === 'bg') matched = Object.keys(BATTLE_BG);
    else if (t === 'player') matched = Object.keys(CLASS_PIXEL);
    else if (t === 'monster') matched = Object.keys(MONSTER_PIXEL);
    else if (all.includes(t)) matched = [t];
    else { console.log('未知目标', t); continue; }
    for (const m of matched) if (!list.includes(m)) list.push(m);
  }
  if (!list.length) { console.log('无匹配目标', targets.join(',')); process.exit(0); }

  console.log(`待生成 ${list.length} 张（目标 ${targets.join(', ')}）`);
  const iter = guard.createIterationGuard(list.length + 5);
  let ok = 0, fail = 0, blocked = 0;
  for (const key of list) {
    if (!iter.step()) { console.error('遍历超限，强制终止'); break; }
    const fname = path.join(__dirname, '..', 'assets', 'battle', key + '.png');
    if (fs.existsSync(fname)) { log(`SKIP ${key} (已存在)`); ok++; continue; }
    const prompt = promptOf(key);
    let result;
    for (let retry = 1; retry <= 8; retry++) {
      result = await guard.generateImage(client, { prompt, negative_prompt: NEGATIVE, width: 512, height: 512, return_url: true }, {
        accountKey: env.JIMENG_ACCESS_KEY || 'default',
        playerKey: 'battle-' + key,
        maxRetries: 2,
        accessKey: env.JIMENG_ACCESS_KEY,
        secretKey: env.JIMENG_SECRET_KEY
      });
      if (result.blocked === 'rate_limit') { log(`WAIT ${key} 频率超限，等待 65s 后重试 (${retry}/8)`); await sleep(65000); continue; }
      break;
    }
    if (result.blocked) {
      log(`BLOCK ${key} :: ${result.error}`);
      blocked++;
      if (result.blocked === 'daily_limit' || result.blocked === 'missing_credentials') { log('_summary', '命中全局拦截 ' + result.blocked + '，终止批次'); process.exit(4); }
      continue;
    }
    if (!result.success) { log(`FAIL ${key} :: ${result.error} (attempts ${result.attempts})`); fail++; continue; }
    try {
      const res = await fetch(result.image_urls[0]);
      if (!res.ok) throw new Error('download ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(fname, buf);
      log(`OK  ${key} ${buf.length}B`);
      ok++;
    } catch (e) { log(`FAIL ${key} download :: ${e.message}`); fail++; }
    await sleep(2500);
  }
  log(`_summary done ok=${ok} fail=${fail} blocked=${blocked}`);
  console.log('当前状态:', JSON.stringify(rate.getStatus(env.JIMENG_ACCESS_KEY || 'default')));
})();
