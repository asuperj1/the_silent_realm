/**
 * battleCore.js — 战斗/KP 纯辅助函数 + 战斗驱动（2026-08-16 从 battleHandler.js 拆分）
 * 含：掉落/行动分类/快照/换装/回合值/怪物展开/战斗启停。
 */
/**
 * battleHandler.js — 战斗 / KP 交互域（T-5 拆分产物）
 * 5 事件：playerAction / chooseStatOption / privateAction / useSkill / groupAction
 * 域内私有 helper：isDirectedAtKP（仅 playerAction 使用）。
 */

const storage = require('./storage');
const logger = require('./logger');
const gameLogic = require('./gamelogic');
const statResolver = require('./statResolver');
const actionClassifier = require('./actionClassifier');
const dungeonOutlines = require('./dungeonOutlines');
const qingfengTrain = require('./qingfengTrain');
const actionSystem = require('./actionSystem');
const battleEngine = require('./battleEngine');
const DF = require('./dungeonFramework'); // ★ 通用副本框架（空间/怪物通用化）
const battleStats = require('./battleStats');
const BATTLE_ROLES = require('../config/battle_roles.json');
const SKILL_BATTLE = require('../config/skill_battle.json');
// ★ 克苏鲁未知恐惧：线索→怪物真名解锁（模块级函数 startBattleForRoom/expandMonsters 直接使用）
const { getUnlockedMonsters, MONSTER_OBSCURE } = require('./state');
const PROFESSIONS = require('../config/professions.json');
const SKILL_TREE = require('../config/skill_tree.json'); // ★ 职业必备技能（innate）
const { applyCopyScoring, matchSceneImage } = require('./room');
// ★ 事件驱动系统（改进①）：怪物/战利品/物品事件发布
const eventBus = require('./eventBus');
const EVENTS = require('./eventTypes');

/** 查职业能量骰（"3D6"/"4D6"/"2D6"），未知默认 3D6 */
function careerEnergyDice(career) {
  const p = PROFESSIONS.find(x => x.name === career || x.id === career);
  return (p && p.energyDice) || '3D6';
}
// ★ 物品框架：KP 对话中获得道具 → 真实掉落入格子化背包
const { getItemEngine } = require('./itemEngine/ItemEngine');
const itemEngine = getItemEngine();

// ★ 青峰山：空间 → 掉落表 scene 简写（子空间归所属主车厢）
const SCENE_KEY_MAP = {
  car_1_cab: 'car1', car_2_economy: 'car2', car_2_power: 'car2',
  car_3_luggage: 'car3', car_4_dining: 'car4', car_5_sleeper: 'car5',
  car_5_diningroom: 'car5', car_6_mail: 'car6', car_7_service: 'car7',
  car_7_power: 'car7', car_8_cabin: 'car8'
};
// 背包分区格尺寸（与 playerHandler INV_PARTITIONS 一致）
const LOOT_PART = {
  consumable: { c: 5, r: 5 }, plot: { c: 15, r: 4 }, material: { c: 10, r: 4 },
  equipment: { c: 12, r: 1 }, equip: { c: 12, r: 1 }, tool: { c: 6, r: 4 }
};
function lootPartKey(type) {
  return { equipment: 'equipment', equip: 'equipment', tool: 'tool', material: 'material', plot: 'plot', consumable: 'consumable' }[type] || 'consumable';
}
/** 行动文本 → 掉落表 action 键 */
function lootActionFor(content) {
  const c = content || '';
  if (/工具箱|工具/.test(c)) return 'toolbox';
  if (/大箱|货箱|板条箱/.test(c)) return 'bigbox';
  if (/床|卧铺|被褥/.test(c)) return 'bed';
  if (/药|医疗|急救|药柜|医药/.test(c)) return 'medicCabinet';
  if (/吧台|广播/.test(c)) return 'bar';
  if (/引擎|操控台|驾驶台/.test(c)) return 'engine';
  if (/应急|应急柜|紧急柜/.test(c)) return 'emergencyCabinet';
  if (/保险柜|安全柜/.test(c)) return 'securityCabinet';
  if (/休息室|货架|休息/.test(c)) return 'restRoom';
  if (/配电|设备间/.test(c)) return 'roomSearch';
  if (/车顶|顶棚|清顶/.test(c)) return 'clearRoof';
  return 'search';
}
/** 是否探索/搜索类行动（才触发掉落） */
function isLootAction(content) {
  return /搜索|翻找|搜寻|检查|查看|调查|搜查|搜刮|寻找|探索|捡|拾取|拿取|撬/.test(content || '');
}
/** 掉落物品分配格子位（同分区找空位） */
function placeIntoInventory(inv, item) {
  item.size = item.size || { w: 1, h: 1 };
  const p = LOOT_PART[lootPartKey(item.type)] || LOOT_PART.consumable;
  const same = inv.filter(i => i.grid && lootPartKey(i.type) === lootPartKey(item.type));
  for (let y = 0; y <= p.r - item.size.h; y++) for (let x = 0; x <= p.c - item.size.w; x++) {
    if (!same.some(o => o.grid.x === x && o.grid.y === y)) { item.grid = { x, y }; inv.push(item); return; }
  }
  item.grid = null; inv.push(item); // 分区满兜底（后续 ensureGrid 自动入仓库）
}
/** ★ KP 对话中探索获得道具 → 掉落入格子化背包 + 广播 */
function rollLootToBag(socket, carId, content) {
  if (!socket.character || !itemEngine.isDungeonActive('qingfengshan')) return;
  const scene = SCENE_KEY_MAP[carId];
  if (!scene) return;
  if (!isLootAction(content)) return;
  let drops = [];
  try { drops = itemEngine.roll('qingfengshan', scene, lootActionFor(content), { character: socket.character }); } catch (e) { drops = []; }
  if (!drops.length) return;
  const inv = socket.character.inventory || (socket.character.inventory = []);
  const gained = [];
  for (const d of drops) {
    if (!itemEngine.factory.tryStack(inv, d)) placeIntoInventory(inv, d);
    gained.push(d);
  }
  storage.saveCharacter(socket.character);
  const gainText = gained.map(g => `${g.itemName}${g.stack > 1 ? '×' + g.stack : ''}`).join('、');
  socket.emit('itemLoot', { msg: `获得道具：${gainText}`, items: inv, warehouse: socket.character.warehouse || [] });
  socket.emit('inventoryData', { items: inv, warehouse: socket.character.warehouse || [] });
  // ★ 改进①：物品获得事件（供背包统计/记录系统订阅）
  eventBus.emit(EVENTS.ITEM_GAINED, { actor: socket.character.uid, data: { items: gained.map(g => ({ itemId: g.itemId, itemName: g.itemName, stack: g.stack })), dungeonId: 'qingfengshan', scene } });
  logger.user.info('KP探索掉落', { uid: socket.character.uid, scene, gain: gainText });
}

// ★ 战利品池（战斗胜利三选一）：武器/消耗/材料随机
const BATTLE_LOOT_POOL = ['G-023', 'G-024', 'QFSE001', 'QFSE002', 'QFSE003', 'G-033', 'G-034', 'G-021', 'G-022', 'G-007', 'G-008', 'G-040', 'G-041'];
function rollBattleLootOptions(count = 3) {
  const options = [];
  const pool = BATTLE_LOOT_POOL.slice();
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const itemId = pool.splice(idx, 1)[0];
    try { options.push(itemEngine.factory.create(itemId)); } catch (e) { /* ignore */ }
  }
  return options;
}

// 检测玩家是否在向 KP 个人提问（而非通用行动描述）
function isDirectedAtKP(content) {
  if (!content || typeof content !== 'string') return false;
  const trimmed = content.trim();
  // 以 KP/kp 开头（后跟标点或空格）
  if (/^[Kk][Pp][\s,，:：]/.test(trimmed)) return true;
  // 包含问号且提到 KP
  if (/[?？]/.test(trimmed) && /[Kk][Pp]/.test(trimmed)) return true;
  // 明确的求助/提问关键词（隐含对 KP 的呼叫）
  if (/^(我该|帮我|告诉我|怎么办|怎么走|怎么去|如何|什么是|什么意思)/.test(trimmed)) return true;
  return false;
}

/** 行动文本是否含移动意图，并解析目标空间 carId（青峰山） */
function parseMoveTarget(content) {
  const c = content || '';
  // 必须含移动意图动词，避免误伤“检查餐车/查看卧铺”等探索动作
  if (!/(前往|走去|走到|移动到|去往|去|返回|回)[^。，！？]{0,4}/.test(c)) return null;
  // ★ 中文数字 → 阿拉伯数字归一（支持简化命令：前往5号 / 前往五号车厢 / 去3号 等）
  const norm = c
    .replace(/一号/g, '1号').replace(/二号/g, '2号').replace(/三号/g, '3号')
    .replace(/四号/g, '4号').replace(/五号/g, '5号').replace(/六号/g, '6号')
    .replace(/七号/g, '7号').replace(/八号/g, '8号');
  // ★ 先匹配更具体的子空间（7号配电间优先，再配电间默认2号），再匹配普通车厢
  const map = [
    { re: /7号配电间/, id: 'car_7_power' },
    { re: /2号配电间|配电间/, id: 'car_2_power' },
    { re: /5号餐室|餐车餐室|餐室/, id: 'car_5_diningroom' },
    { re: /1号|驾驶室/, id: 'car_1_cab' },
    { re: /2号/, id: 'car_2_economy' },
    { re: /3号|行李/, id: 'car_3_luggage' },
    { re: /4号|餐车/, id: 'car_4_dining' },
    { re: /5号|卧铺/, id: 'car_5_sleeper' },
    { re: /6号|货物|邮件/, id: 'car_6_mail' },
    { re: /7号|乘务/, id: 'car_7_service' },
    { re: /8号|尾厢|包厢/, id: 'car_8_cabin' }
  ];
  for (const m of map) { if (m.re.test(norm)) return m.id; }
  return null;
}

/** 行动文本 → 探索回合值消耗类型（战斗行为系统1.0） */
function classifyExploreAction(content) {
  const c = content || '';
  if (/(前往|走去|走到|移动到|去往|去|返回|回)[^。，！？]{0,6}/.test(c)) return 'move';
  if (/精细|仔细|细致|深入|彻底|全面搜索/.test(c)) return 'fine_search';
  if (/深度|侦查|解析|分析|钻研|审视/.test(c)) return 'deep_scan';
  if (/简单|扫一眼|随意|快速看/.test(c)) return 'simple_search';
  if (/搜索|翻找|搜寻|检查|查看|调查|搜查|搜刮|寻找|探索|捡|拾取|拿取|撬|搜/.test(c)) return 'simple_search';
  if (/观察|环顾|打量|张望/.test(c)) return 'observe';
  if (/喝|吃|服用|使用|涂抹|注射|饮用/.test(c)) return 'item';
  if (/修甲|维修|修补|加固|修复/.test(c)) return 'repair';
  if (/包扎|止血|治疗|敷药|急救/.test(c)) return 'bandage';
  return 'other';
}

/** 构建单个玩家战斗快照（v2.1 §11.3）——战斗开始/战斗内换装共用 */
function buildPlayerSnapshot(char, p, sid) {
  const attr = char ? char.attr : (p.attr || {});
  const career = char ? char.career : (p.career || '');
  const careerId = (PROFESSIONS.find(x => x.name === career || x.id === career) || {}).id || career;
  const stats = battleStats.getCombatStats(attr, career);
  const weapon = char ? battleStats.getEquippedWeapon(char, itemEngine) : null;
  const roleCfg = BATTLE_ROLES[careerId] || BATTLE_ROLES[battleStats.careerRole(career)] || {};
  // 出战技能 → 战斗配置（skill_battle.json，key 为职业 id）
  const sb = SKILL_BATTLE[careerId] || {};
  let skillNames = (char && Array.isArray(char.equippedSkills) && char.equippedSkills.length)
    ? char.equippedSkills : ((char && char.skills) || []);
  if (!skillNames.length) {
    const pro = PROFESSIONS.find(x => x.name === career || x.id === career);
    skillNames = (pro && pro.skills) ? pro.skills.map(s => s.name) : [];
  }
  const skills = {};
  (skillNames || []).forEach(n => { const s = (sb.skills || {})[n]; if (s) skills[n] = s; });
  // ★ 职业必备技能（innate，如武士基础居合格挡/援护铁壁）：像被动一样开局自带、常驻出战
  const profForTree = PROFESSIONS.find(x => x.name === career || x.id === career) || {};
  const tree = SKILL_TREE[careerId] || SKILL_TREE[profForTree.skillTreeId] || {};
  const innateNames = ((tree && tree.innate) || []).map(sk => sk.name);
  (innateNames || []).forEach(n => { const s = (sb.skills || {})[n]; if (s && !skills[n]) skills[n] = s; });
  // ★ 战斗被动 = 职业被动 + 装备被动词条（onBattleStart/onTurnStart/onAttack/onHurt/onKill/onBattleEnd）
  const passives = [];
  if (sb.passive && sb.passive.trigger) passives.push({ trigger: sb.passive.trigger, effect: sb.passive.effect });
  const eqPassives = char ? battleStats.getEquippedPassives(char, itemEngine) : [];
  eqPassives.forEach(ep => passives.push({ trigger: ep.trigger, effect: ep.effect }));
  const resource = roleCfg.resource
    ? { id: roleCfg.resource, type: roleCfg.resourceType || 'active', value: 0, max: (roleCfg.resourceRule && roleCfg.resourceRule.max) || 10 }
    : null;
  return {
    sid,
    name: char ? char.name : (p.name || '玩家'),
    career,
    role: stats.role,
    hp: char ? (attr.hp ?? attr.maxHp) : (p.hp ?? attr.hp ?? 80),
    maxHp: attr.maxHp || 80,
    san: attr.san ?? 80, sanMax: attr.maxSan || 80,
    physAtk: stats.physAtk, magAtk: stats.magAtk, physDef: stats.physDef, magDef: stats.magDef,
    pierce: stats.pierce, blockBonus: stats.block, shieldBase: stats.shield,
    dex: attr.dex || 20,
    energyDice: careerEnergyDice(career),
    weapon, skills, passives, resource, resourceRule: roleCfg.resourceRule || {},
    resourceSkill: roleCfg.specialSkill || null,
    mechanic: roleCfg.passive || null   // ★ 职业机制（battle_roles.passive：武士架势条 / 百夫长五段战姿等）
  };
}

/** 收集同空间玩家单位（战斗用）→ 构建杀戮尖塔2式战斗快照 */
function collectBattlePlayers(room, io, carId) {
  const units = [];
  room.players.forEach((p, sid) => {
    if (p.offline) return;
    if (carId && p.carId && p.carId !== carId) return; // 仅同场景玩家参战
    const sock = io.sockets.sockets.get(sid);
    const char = (sock && sock.character) || null;
    units.push(buildPlayerSnapshot(char, p, sid));
  });
  return units;
}

/** 战斗内换装：执行装备 + 旧装放回背包 + 存档 */
function equipInBattle(socket, itemId, slot) {
  const char = socket.character;
  if (!char) return { ok: false, msg: '无角色' };
  const inv = char.inventory || [];
  const item = inv.find(i => (i.id === itemId) || (i.uid === itemId));
  if (!item) return { ok: false, msg: '物品不在背包' };
  const tpl = itemEngine.resolveTemplate(item.itemId || item.name);
  const targetSlot = slot || (tpl && tpl.slot) || 'weapon';
  const r = itemEngine.equipment.equip(char, item, targetSlot);
  if (!r.ok) return { ok: false, msg: r.msg || '无法装备' };
  inv.splice(inv.indexOf(item), 1);
  if (r.old) {
    try {
      const otpl = itemEngine.resolveTemplate(r.old);
      if (otpl) inv.push(itemEngine.factory.create(otpl.itemId));
      else inv.push({ id: 'legacy_' + Date.now(), name: r.old, itemName: r.old, type: 'equipment', quality: 'white', effects: [], slot: targetSlot, grid: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
    } catch (e) { /* ignore */ }
  }
  try { storage.saveCharacter(char); } catch (e) { console.warn('[persist] 战斗内换装存档失败', e && e.message); }
  // ★ 改进①：战斗内换装事件
  eventBus.emit(EVENTS.ITEM_EQUIPPED, { actor: char.uid, data: { item: { itemId: item.itemId, itemName: item.itemName || item.name }, slot: targetSlot } });
  return { ok: true, msg: r.msg, slot: targetSlot };
}

/** 战斗中使用消耗品：计算回复/护盾效果并移除物品（不动角色 attr，战斗结束统一回写） */
function useItemInBattle(socket, itemUid) {
  const char = socket.character;
  if (!char) return { ok: false, msg: '无角色' };
  const inv = char.inventory || [];
  const item = inv.find(i => (i.id === itemUid) || (i.uid === itemUid));
  if (!item) return { ok: false, msg: '物品不存在' };
  let tpl = null;
  try { tpl = itemEngine.resolveTemplate(item.itemId || item.name); } catch (e) { /* ignore */ }
  const effs = (item.effects && item.effects.length ? item.effects : (tpl ? tpl.effects : [])) || [];
  const useEffs = effs.filter(e => e.trigger === 'use' || !e.trigger);
  let hpDelta = 0, sanDelta = 0, shield = 0; const effects = [];
  useEffs.forEach(e => {
    if (e.kind === 'hp') hpDelta += e.value || 0;
    else if (e.kind === 'san') sanDelta += e.value || 0;
    else if (e.kind === 'shield') shield += e.value || 0;
    else if (e.kind === 'stat' && e.duration > 0) effects.push({ id: 'stat_' + (e.stat || 'str'), value: e.value || 0, turns: e.duration });
  });
  if (!hpDelta && !sanDelta && !shield && !effects.length) return { ok: false, msg: '该物品无战斗可用效果' };
  inv.splice(inv.indexOf(item), 1);
  try { storage.saveCharacter(char); } catch (e) { console.warn('[persist] 战斗用道具存档失败', e && e.message); }
  // ★ 改进①：战斗中使用消耗品事件
  eventBus.emit(EVENTS.ITEM_USED, { actor: char.uid, data: { item: { itemId: item.itemId, itemName: item.itemName || item.name }, effects: { hpDelta, sanDelta, shield } } });
  return { ok: true, hpDelta, sanDelta, shield, effects, msg: item.itemName || item.name || '消耗品' };
}

/** 解析 KP 回复中的【回合值】X（0.25~2 之间 0.25 的整数倍），解析失败返回 0 */
function parseKpTurnCost(story) {
  if (!story) return 0;
  const m = String(story).match(/【回合值(?:\s*消耗)?】\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const v = parseFloat(m[1]);
    if (isFinite(v) && v > 0 && v <= 2) return Math.round(v * 100) / 100;
  }
  return 0;
}

/** 应用 KP 判定的回合值：累加房间级探索回合值并广播（≥1.5 强制结束本大回合） */
function applyKpTurnCost(room, io, gameRoomId, sid, name, story, consume) {
  let kpCost = parseKpTurnCost(story);
  if (!(kpCost > 0)) kpCost = 0.25; // ★ 兜底：KP 未输出【回合值】时按 0.25（轻量动作）计
  room._kpTurn = room._kpTurn || {};
  if (room._kpTurn[sid] === undefined) room._kpTurn[sid] = 0;
  room._kpTurn[sid] = Math.round((room._kpTurn[sid] + kpCost) * 100) / 100;
  const dice = consume && consume.dice ? consume.dice : (actionSystem.explorePlayerDice(gameRoomId, sid).dice || 1);
  const used = consume && consume.used ? consume.used : 1;
  const round = room._exploreRound || 1;
  if (room._kpTurn[sid] >= 1.5) {
    // ★ 累计回合值满 1.5 → 强制结束本大回合，重新掷骰
    room._kpTurn[sid] = 0;
    room._exploreRound = actionSystem.exploreStart(gameRoomId).round;
    io.to(gameRoomId).emit('exploreRound', { round: room._exploreRound, phase: 'new', reason: 'cost_full' });
    io.to(gameRoomId).emit('exploreUpdate', {
      sid, name, dice, actionCost: kpCost, cost: 0, forcedEnd: true, ended: false,
      skipped: false, reason: '', used, round: room._exploreRound
    });
  } else {
    io.to(gameRoomId).emit('exploreUpdate', {
      sid, name, dice, actionCost: kpCost, cost: room._kpTurn[sid], forcedEnd: false, ended: false,
      skipped: false, reason: '', used, round
    });
  }
}

/** 展开怪物实例（enemies=[{type,count}] → 实例数组）；★ 未解锁真名时用模糊描述（克苏鲁未知恐惧） */
// ★ 怪物 type 键归一：青峰山空间键(formless/shoggoth) → data/character_skill.json 怪物键(formless_spawn/proto_shoggoth)
//   消除"三套键分裂"：战斗数值由 config/battle_monsters.json 提供，真名/描述由 data/character_skill.json 提供
const MONSTER_TYPE_ALIAS = { formless: 'formless_spawn', shoggoth: 'proto_shoggoth', mi_go: 'mi_go' };
function expandMonsters(enemies, unlocked) {
  const out = [];
  const defs = qingfengTrain.MONSTERS || {};
  (enemies || []).forEach(e => {
    const defKey = MONSTER_TYPE_ALIAS[e.type] || e.type;
    const def = defs[defKey] || {};
    // ★ 真名解锁前，战斗 UI 也只显示不可名状的模糊描述
    const known = unlocked && unlocked[e.type];
    const baseName = known ? (def.name || e.type) : (MONSTER_OBSCURE[e.type] || '未知生物');
    const count = Math.min(e.count || 1, 6);
    const hp = Number(def.hpPerUnit || def.hp || 15) || 15;
    for (let i = 0; i < count; i++) {
      out.push({
        type: e.type,
        name: count > 1 ? `${baseName}${i + 1}` : baseName,
        dex: Number(def.dex || 15) || 15,
        hp,
        maxHp: hp,
        attackDamage: Number(def.attackDamage || 6) || 6
      });
    }
  });
  return out;
}

/**
 * ★ 统一移动执行（地图点击 dungeonAction / 输入指令 playerAction 共用）
 * 处理：邻接校验 → 玩家空间/state/turn++ → 8号车毒雾 → 怪物检测+战斗触发。
 * 广播（dungeonActionResult / roomUpdate）由调用方各自完成，避免重复。
 * @param {object} opts { isCrawling } 8号车贴地爬行
 * @returns {{ ok:boolean, error?:string, moved?, turn?, combat?, enemies?, poisonDmg?, carState?, chenHuiWithParty? }}
 */
function executePlayerMove(room, io, gameRoomId, state, socket, player, targetCar, opts) {
  opts = opts || {};
  const myCar = player.carId || state.currentCar || 'car_4_dining';
  // ★ 框架化：邻接优先走副本配置（通用框架），青峰山引擎兜底
  const adj = (room.dungeonConfig ? DF.getAdjacent(room.dungeonConfig, myCar) : qingfengTrain.getAdjacentSpaces(myCar));
  if (!adj.includes(targetCar)) return { ok: false, error: '只能移动到相邻空间' };
  player.carId = targetCar;
  state.currentCar = targetCar;
  if (!state.carStates[targetCar]) state.carStates[targetCar] = { visited: false };
  state.carStates[targetCar].visited = true;
  state.turn++;
  // 8号车厢毒雾（青峰山专属引擎钩子；纯数据副本无毒雾）
  let poisonDmg = 0;
  if (targetCar === 'car_8_cabin' && room.engine && typeof room.engine.calculatePoisonDamage === 'function') {
    const playerAttr = (socket && socket.character && socket.character.attr) || {};
    poisonDmg = room.engine.calculatePoisonDamage(playerAttr, !!opts.isCrawling);
  }
  // 怪物检测 + 战斗触发（进入有未清除怪物空间 → 自动启动；★ 框架化）
  const enemies = (room.engine && typeof room.engine.getSpaceMonsters === 'function')
    ? room.engine.getSpaceMonsters(targetCar, state)
    : (room.dungeonConfig ? DF.getSpaceMonsters(room.dungeonConfig, targetCar, state) : []);
  const inCombat = enemies.length > 0;
  if (inCombat) {
    try {
      startBattleForRoom(room, io, gameRoomId, state, targetCar, enemies);
    } catch (e) {
      logger.error.error('移动触发战斗失败', { roomId: gameRoomId, targetCar, error: e.message });
      state.activeCombat = { space: targetCar, enemies, turnInCombat: 0 };
    }
  } else {
    state.activeCombat = null;
  }
  return {
    ok: true, moved: targetCar, turn: state.turn, combat: inCombat, enemies, poisonDmg,
    carState: state.carStates[targetCar] || null,
    chenHuiWithParty: state.chenHui ? state.chenHui.withParty : false
  };
}

/** 启动战斗（进入有怪空间时）：构建战斗快照 + 驱动循环 */
function startBattleForRoom(room, io, gameRoomId, state, carId, enemies) {
  const roomId = gameRoomId;
  const units = collectBattlePlayers(room, io, carId);
  const unlocked = getUnlockedMonsters(state); // ★ 依据已收集线索决定是否揭示真名
  const mons = expandMonsters(enemies, unlocked);
  if (!units.length || !mons.length) return false;
  battleEngine.battleStart(roomId, { players: units, monsters: mons });
  state.activeCombat = { space: carId, enemies, turnInCombat: 0 };
  io.to(gameRoomId).emit('battleStart', { status: battleEngine.battleStatus(roomId) });
  io.to(gameRoomId).emit('battleIntent', battleEngine.battleIntent(roomId));
  // ★ 改进①：怪物出场事件（供怪物 AI / 记录系统订阅）
  eventBus.emit(EVENTS.MONSTER_SPAWNED, { actor: gameRoomId, value: mons.length, data: { type: (enemies[0] && enemies[0].type) || 'unknown', count: mons.length, carId } });
  driveBattle(room, io, gameRoomId, state);
  return true;
}

/** 驱动战斗循环：获取当前行动者并广播；怪物轮自动结算 */
function driveBattle(room, io, gameRoomId, state) {
  const roomId = gameRoomId;
  // ★ 修复：递归驱动改有界 while 循环（原递归在"离线+阵亡"极端组合下可无限自旋）
  let guard = 0;
  while (guard++ < 500) {
    const cur = battleEngine.battleCurrent(roomId);
    if (cur.over) {
      endBattle(room, io, gameRoomId, state, cur.winner === 'players' ? 'players' : 'monsters', state?.activeCombat?.space);
      return;
    }
    if (cur.type === 'monster') {
      const res = battleEngine.battleMonsterAct(roomId);
      io.to(gameRoomId).emit('battleEvent', { type: 'monster', msg: res.msg, dmg: res.dmg, target: res.target, status: res.status });
      io.to(gameRoomId).emit('battleIntent', battleEngine.battleIntent(roomId));
      if (res.over) {
        endBattle(room, io, gameRoomId, state, 'players', state?.activeCombat?.space);
        return;
      }
      continue; // 继续处理怪物回合（不再递归）
    }
    // 玩家回合：当前行动者确定（BATTLE_TURN 事件已统一广播 battleTurn）
    return;
  }
  // 安全网：驱动超限（正常流程不可达，纯防御）
  logger.error.error('driveBattle 驱动超限，强制终止战斗', { roomId: gameRoomId });
  try { battleEngine.battleReset(roomId); } catch (e) { /* ignore */ }
  if (state) state.activeCombat = null;
}

/** 战斗结束清理（win: 'players' | 'monsters' | 'fled'）；回写存活玩家 HP/SAN */
function endBattle(room, io, gameRoomId, state, win, carId) {
  const roomId = gameRoomId;
  // ★ 回写存活玩家 HP/SAN 到角色存档（引擎为权威）
  const st = battleEngine.battleStatus(roomId);
  if (st && st.units) {
    st.units.forEach(u => {
      const sock = io.sockets.sockets.get(u.sid);
      if (sock && sock.character && sock.character.attr) {
        const c = sock.character;
        const oldHp = c.attr.hp, oldSan = c.attr.san;
        c.attr.hp = Math.min(c.attr.maxHp || u.maxHp, u.hp);
        if (c.attr.san != null && u.san != null) c.attr.san = Math.max(0, Math.min(c.attr.maxSan || 80, u.san));
        storage.saveCharacter(c);
        // ★ 改进①：战斗结束回写 HP/SAN 事件
        if (c.attr.hp !== oldHp) eventBus.emit(EVENTS.PLAYER_HP_CHANGED, { actor: c.uid, value: c.attr.hp - oldHp, data: { hp: c.attr.hp, maxHp: c.attr.maxHp, cause: 'battle_end' } });
        if (c.attr.san !== oldSan) eventBus.emit(EVENTS.PLAYER_SAN_CHANGED, { actor: c.uid, value: c.attr.san - oldSan, data: { san: c.attr.san, cause: 'battle_end' } });
      }
    });
  }
  battleEngine.battleReset(roomId);
  if (state) state.activeCombat = null;
  if (win === 'players' && state && carId) {
    if (!state.carStates[carId]) state.carStates[carId] = {};
    state.carStates[carId].clearedSpawn = true;
    state.shoggothDefeated = true;
  }
  // ★ 改进①：怪物被击败事件（供掉落/进度系统订阅）
  if (win === 'players') {
    eventBus.emit(EVENTS.MONSTER_DEFEATED, { actor: gameRoomId, value: 1, data: { carId } });
  }
  // ★ 战利品三选一（战斗胜利）：生成 3 个选项供玩家选择入背包
  if (win === 'players') {
    const options = rollBattleLootOptions();
    if (options.length) {
      room._pendingLoot = { options };
      io.to(gameRoomId).emit('battleLoot', { options: options.map(o => ({ itemId: o.itemId, itemName: o.itemName || o.name, icon: o.icon, quality: o.quality })) });
      // ★ 改进①：战利品抽取事件（供掉落统计/记录系统订阅）
      eventBus.emit(EVENTS.LOOT_ROLLED, { actor: gameRoomId, value: options.length, data: { dungeonId: room.itemDungeonId || null, carId, options: options.map(o => ({ itemId: o.itemId, itemName: o.itemName || o.name })) } });
    }
  }
  io.to(gameRoomId).emit('battleEnd', { win, msg: win === 'players' ? '战斗胜利！' : (win === 'fled' ? '已撤退' : '全员阵亡……') });
  io.to(gameRoomId).emit('dungeonActionResult', {
    action: 'fight_spawn', payload: {}, target: 'public', actorSocketId: '',
    result: { remainingCount: win === 'players' ? 0 : 1, cleared: win === 'players' }
  });
}


module.exports = { careerEnergyDice, lootPartKey, lootActionFor, isLootAction, placeIntoInventory, rollLootToBag, rollBattleLootOptions, isDirectedAtKP, parseMoveTarget, classifyExploreAction, buildPlayerSnapshot, collectBattlePlayers, equipInBattle, useItemInBattle, parseKpTurnCost, applyKpTurnCost, expandMonsters, executePlayerMove, startBattleForRoom, driveBattle, endBattle };
