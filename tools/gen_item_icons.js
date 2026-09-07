/**
 * gen_item_icons.js — 物品图标批量生成（512×512 通用 T2I，无字）→ assets/items/{itemId}.png
 * 风格：暗黑克苏鲁跑团「物品格」图标（单物件特写，深色烟雾底，戏剧性打光），与技能图标统一 UI
 * 用法: node tools/gen_item_icons.js [all|G|QFS|G-002|...]
 * 逐张串行 + 2.5s 间隔，避免 429；嵌套防护：防抖 + 熔断重试 + 频率/每日限流（见 image_request_guard.js / api_rate_limit.js）
 * 幂等：已存在的图片自动跳过（可断点续跑）
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

const NEGATIVE = 'text, watermark, words, letters, numbers, symbols, chinese characters, label, ui element, description box, frame, border, lowres, blurry, deformed, flat vector, flat icon, logo, signature, hands';
// ★ 物品格图标统一风格（单物件特写，暗黑道具感）
const BASE_STYLE = 'game item icon, single object prop filling the frame, dramatic side rim lighting, painterly thick brush fantasy art, deep dark smoky background, subtle glowing edge highlight, ultra detailed, absolutely no text';

// 类型基底主题
const TYPE_STYLE = {
  consumable: 'survival consumable prop, liquid or packaged goods',
  material: 'crafting material prop, metal and industrial parts',
  plot: 'paper document prop, vintage ink and aged paper',
  equipment: 'worn equipment prop, metal and fabric'
};

// 品质氛围增强
const QUALITY_GLOW = {
  white: '', green: ', soft green glow', blue: ', cool blue magical glow',
  purple: ', dark purple epic glow', gold: ', radiant golden glow',
  orange: ', burning orange glow', red: ', blood red ominous glow', black: ', pitch black void energy, ominous cosmic horror'
};

// ★ 逐物品主题（英文，供 prompt 使用）
const ITEM_THEME = {
  // 全局 G-*
  'G-001': 'mysterious void coin currency with cracked surface',
  'G-002': 'rolled white bandage',
  'G-003': 'calming herbal tea cup with steam',
  'G-004': 'glowing soul crystal shard',
  'G-005': 'tool repair kit box with wrenches',
  'G-006': 'antique first aid medical kit',
  // 全局工具 G-007~018
  'G-007': 'coiled climbing rope',
  'G-008': 'steel crowbar with rust marks',
  'G-009': 'metal flashlight',
  'G-010': 'folding multi-tool pocket knife',
  'G-011': 'ice axe climbing pick',
  'G-012': 'silver emergency thermal blanket',
  'G-013': 'glowing chemical light stick',
  'G-014': 'grappling hook with rope',
  'G-015': 'matchbox with matches',
  'G-016': 'old kerosene oil lantern',
  'G-017': 'iron shovel spade',
  'G-018': 'brass spyglass telescope',
  // 全局材料/消耗 G-019~022
  'G-019': 'grey duct tape roll',
  'G-020': 'spare dry battery cells',
  'G-021': 'compressed army ration biscuit',
  'G-022': 'aluminum military canteen',
  // 全局装备 G-023~032
  'G-023': 'old six-shot revolver pistol',
  'G-024': 'hunting knife with leather grip',
  'G-025': 'brimmed deerstalker detective hat',
  'G-026': 'old rubber gas mask',
  'G-027': 'double-breasted trench coat',
  'G-028': 'worn leather jacket',
  'G-029': 'tactical leather gloves',
  'G-030': 'high-top hiking boots',
  'G-031': 'engraved brass bracelet',
  'G-032': 'old silver pendant',
  // 全局药水 G-033~039
  'G-033': 'crimson magic potion bottle with bubbles',
  'G-034': 'emerald green magic potion bottle',
  'G-035': 'ochre thick magic potion bottle',
  'G-036': 'azure clear magic potion bottle',
  'G-037': 'amethyst glowing magic potion bottle',
  'G-038': 'dark red viscous healing potion bottle',
  'G-039': 'pale blue calming potion bottle',
  // 全局消耗 G-040~041
  'G-040': 'first aid kit box with bandages',
  'G-041': 'calming mental stabilizer potion vial',
  // 剧情 QFSD*
  'QFSD001': 'yellowed G314 train ticket with torn edge',
  'QFSD002': 'tattered void observation notebook',
  'QFSD003': 'brass train brake key',
  'QFSD004': 'worn conductor duty roster sheet',
  'QFSD005': 'crumpled rescue plea note',
  'QFSD006': 'forged safety broadcast script page',
  'QFSD007': 'eldritch shoggoth sighting record book',
  'QFSD008': 'escape route map on aged paper',
  // 消耗 QFSC*
  'QFSC001': 'sealed mineral water bottle',
  'QFSC006': 'train compressed biscuit pack',
  'QFSC010': '9mm pistol magazine with bullets',
  'QFSC002': 'soothing herbal bundle with dried leaves',
  'QFSC005': 'armor lubricant grease can',
  'QFSC007': 'canned train coffee tin',
  'QFSC008': 'disinfectant alcohol cotton pad pack',
  'QFSC011': '12-gauge shotgun shell',
  'QFSC009': 'distilled stimulant vial with liquid',
  'QFSC004': 'rusted adrenaline syringe',
  'QFSC012': 'mental stabilizer injection ampoule',
  // 材料 QFSM*
  'QFSM001': 'rusty train bolt',
  'QFSM004': 'broken train glass shard',
  'QFSM002': 'insulated copper cable segment',
  'QFSM005': 'engine transmission gear part',
  'QFSM003': 'old conductor badge with emblem',
  'QFSM006': 'old rusty pocket watch',
  // 装备 QFSE*
  'QFSE001': 'steel crowbar with rust marks',
  'QFSE002': 'rusty disassembly knife',
  'QFSE003': 'simple black pistol',
  'QFSE004': 'double barrel shotgun',
  'QFSE009': 'conductor hard hat helmet',
  'QFSE010': 'old worn work boots',
  'QFSE006': 'insulated rubber gloves',
  'QFSE005': 'conductor work overalls jacket',
  'QFSE007': 'faded conductor scarf',
  'QFSE008': 'train radio walkie-talkie',
  'QFSE011': 'leather patrol belt with buckle',
  'QFSE012': 'police stab resistant vest',
  'QFSE013': 'shoggoth core fragment, pulsating void crystal with tentacles'
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (msg) => {
  const l = `${new Date().toISOString()} ${msg}\n`;
  console.log(l.trim());
  fs.appendFileSync(path.join(__dirname, '..', 'logs', 'item_icons.log'), l);
};

/** 读取全部物品（全局池 + 各副本清单 + bossDrop） */
function loadAllItems() {
  const out = [];
  const itemsDir = path.join(__dirname, '..', 'config', 'items');
  // 全局
  try { out.push(...JSON.parse(fs.readFileSync(path.join(itemsDir, 'global_items.json'), 'utf8')).items || []); } catch (e) {}
  // 副本清单
  const dgDir = path.join(itemsDir, 'dungeons');
  if (fs.existsSync(dgDir)) {
    for (const f of fs.readdirSync(dgDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dgDir, f), 'utf8'));
        out.push(...(m.items || []), ...(m.bossDrop || []));
      } catch (e) {}
    }
  }
  return out;
}

function promptOf(item) {
  const theme = ITEM_THEME[item.itemId] || `${item.itemName} prop`;
  const tStyle = TYPE_STYLE[item.type] || 'prop';
  const glow = QUALITY_GLOW[item.quality] || '';
  return `game item icon for '${item.itemName}', ${theme}, ${tStyle}${glow}, ${BASE_STYLE}`;
}

(async () => {
  const targets = (process.argv.slice(2).length ? process.argv.slice(2) : ['all']);
  const client = new JimengClient({ accessKey: env.JIMENG_ACCESS_KEY, secretKey: env.JIMENG_SECRET_KEY, region: 'cn-north-1' });
  fs.mkdirSync(path.join(__dirname, '..', 'logs'), { recursive: true });
  fs.mkdirSync(path.join(__dirname, '..', 'assets', 'items'), { recursive: true });

  const cred = guard.checkCredentials(env.JIMENG_ACCESS_KEY, env.JIMENG_SECRET_KEY);
  if (!cred.ok) {
    console.error('❌ AK/SK 为空或失效，绘图模块已禁用（不发送请求）');
    rate.logNote('密钥检测失败，禁用绘图模块（gen_item_icons）');
    process.exit(3);
  }

  const all = loadAllItems();
  // 支持多个目标：all / G / QFS / 单ID，取并集去重
  const list = [];
  for (const t of targets) {
    let matched;
    if (t === 'all') matched = all;
    else if (t === 'G') matched = all.filter(i => i.itemId.startsWith('G-'));
    else if (t === 'QFS') matched = all.filter(i => i.itemId.startsWith('QFS'));
    else matched = all.filter(i => i.itemId === t);
    for (const m of matched) if (!list.includes(m)) list.push(m);
  }
  if (!list.length) { console.log('无匹配物品', targets.join(',')); process.exit(0); }

  console.log(`待生成 ${list.length} 张（目标 ${targets.join(', ')}）`);
  const iter = guard.createIterationGuard(list.length + 5);
  let ok = 0, fail = 0, blocked = 0;
  for (const item of list) {
    if (!iter.step()) { console.error('遍历超限，强制终止'); break; }
    const fname = path.join(__dirname, '..', 'assets', 'items', item.itemId + '.png');
    if (fs.existsSync(fname)) { log(`SKIP ${item.itemId} ${item.itemName} (已存在)`); ok++; continue; }
    const prompt = promptOf(item);
    let result;
    for (let retry = 1; retry <= 8; retry++) {
      result = await guard.generateImage(client, { prompt, negative_prompt: NEGATIVE, width: 512, height: 512, return_url: true }, {
        accountKey: env.JIMENG_ACCESS_KEY || 'default',
        playerKey: 'item-icons-' + item.itemId,
        maxRetries: 2,
        accessKey: env.JIMENG_ACCESS_KEY,
        secretKey: env.JIMENG_SECRET_KEY
      });
      if (result.blocked === 'rate_limit') {
        log(`WAIT ${item.itemId} 频率超限，等待 65s 后重试 (${retry}/8)`);
        await sleep(65000);
        continue;
      }
      break;
    }
    if (result.blocked) {
      log(`BLOCK ${item.itemId} ${item.itemName} :: ${result.error}`);
      blocked++;
      if (result.blocked === 'daily_limit' || result.blocked === 'missing_credentials') {
        log('_summary', '命中全局拦截 ' + result.blocked + '，终止批次');
        process.exit(4);
      }
      continue;
    }
    if (!result.success) {
      log(`FAIL ${item.itemId} ${item.itemName} :: ${result.error} (attempts ${result.attempts})`);
      fail++;
      continue;
    }
    try {
      const res = await fetch(result.image_urls[0]);
      if (!res.ok) throw new Error('download ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(fname, buf);
      log(`OK  ${item.itemId} ${item.itemName} ${buf.length}B`);
      ok++;
    } catch (e) {
      log(`FAIL ${item.itemId} ${item.itemName} download :: ${e.message}`);
      fail++;
    }
    await sleep(2500);
  }
  log(`_summary done ok=${ok} fail=${fail} blocked=${blocked}`);
  console.log('当前状态:', JSON.stringify(rate.getStatus(env.JIMENG_ACCESS_KEY || 'default')));
})();
