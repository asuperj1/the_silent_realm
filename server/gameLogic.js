// ==================== 静态游戏配置 ====================

// 职业数据投影（单一事实源：config/professions.json）
// CAREERS 以职业中文名(name)为键，从 professions.json 投影精简结构，
// 契约：CAREERS[career].bonus / .passive(字符串) / .skills(字符串数组) / .hidden
// 禁止再手写职业数据，新增/修改职业一律改 professions.json
const PROFESSIONS = require('../config/professions.json');
const CAREERS = Object.fromEntries(PROFESSIONS.map(p => [
  p.name, { bonus: { ...p.bonus }, passive: p.passive.name, skills: p.skills.map(s => s.name), hidden: p.hidden }
]));

// 新手副本列表（白刻痕可见，无解锁要求）
const BEGINNER_DUNGEONS = [
  "废都纪元800｜青峰山虚空列车",
  "渔村纪元900｜雾潮潮间渔村", 
  "日之塔纪元1000｜荒野商队护送"
];

const COPIES = {
  "废都纪元800｜青峰山虚空列车": {
    difficulty: "简单",
    exp: 25,
    unlockReq: [],
    tier: "beginner",
    desc: "废都纪元800年·新手前置副本",
    worldTag: "废都轮回消亡世界",
    era: 800,
    maxPlayers: 5,
    npc: "陈慧",
    boss: "修格斯幼体",
    monsters: ["无形之子", "米·戈"],
    specialRule: "全部玩法基于属性数值阈值判定，无掷骰机制",
    sceneSwitchEnable: true
  },
  "渔村纪元900｜雾潮潮间渔村": { difficulty: "普通", exp: 45, unlockReq: [], tier: "beginner" },
  "日之塔纪元1000｜荒野商队护送": { difficulty: "普通", exp: 45, unlockReq: [], tier: "beginner" },
  "深海潮汐·拉莱耶深渊": { difficulty: "困难", exp: 75, unlockReq: ["渔村纪元900｜雾潮潮间渔村"], tier: "advanced" },
  "璃岛祭典·圣女殉道": { difficulty: "困难", exp: 75, unlockReq: ["日之塔纪元1000｜荒野商队护送"], tier: "advanced" },
  "血肉病院·畸变禁区": { difficulty: "困难", exp: 75, unlockReq: ["废都纪元800｜青峰山虚空列车"], tier: "advanced" },
  "星穹裂隙·虚空门扉": { difficulty: "噩梦", exp: 110, unlockReq: ["深海潮汐·拉莱耶深渊", "血肉病院·畸变禁区"], tier: "final" }
};

const SHOP_ITEMS = {
  // ★ 白色品质工具（新框架模板 → 购买生成实例，落入格子化背包）
  "攀岩绳": { itemId: "G-007", type: "tool", cost: 10, quality: "white", icon: "🪢", desc: "高强度纤维绳，可用于攀爬、捆扎与救援" },
  "撬棍": { itemId: "G-008", type: "tool", cost: 15, quality: "white", icon: "🛠️", desc: "撬开被卡住的门缝、板条箱与锈蚀角阀" },
  "手电筒": { itemId: "G-009", type: "tool", cost: 20, quality: "white", icon: "🔦", desc: "照亮黑暗区域，探查阴影中的细节与隐藏痕迹" },
  "多功能小刀": { itemId: "G-010", type: "tool", cost: 12, quality: "white", icon: "🔪", desc: "切割绳索、处理简易障碍与应急修补" },
  "登山镐": { itemId: "G-011", type: "tool", cost: 18, quality: "white", icon: "⛏️", desc: "撬开硬质障碍、凿开冰面与岩壁裂缝" },
  "急救毯": { itemId: "G-012", type: "tool", cost: 14, quality: "white", icon: "🟨", desc: "保温防潮，裹身可抵御寒冷与湿气" },
  "荧光棒": { itemId: "G-013", type: "tool", cost: 8, quality: "white", icon: "🥢", desc: "掰亮后可提供一段时间的柔和冷光" },
  "绳索钩爪": { itemId: "G-014", type: "tool", cost: 22, quality: "white", icon: "🪝", desc: "抛掷钩爪攀越高处与跨越裂隙" },
  "火柴盒": { itemId: "G-015", type: "tool", cost: 6, quality: "white", icon: "🔥", desc: "划燃点火，可用于引燃或照明" },
  "油灯": { itemId: "G-016", type: "tool", cost: 16, quality: "white", icon: "🏮", desc: "稳定光源，照亮一片区域并驱散阴影" },
  "铁锹": { itemId: "G-017", type: "tool", cost: 20, quality: "white", icon: "🪏", desc: "挖掘松软土层与掩埋痕迹" },
  "望远镜": { itemId: "G-018", type: "tool", cost: 30, quality: "white", icon: "🔭", desc: "远距离观察，洞察黑暗中的细节" },
  // 通用材料
  "螺纹胶带": { itemId: "G-019", type: "material", cost: 8, quality: "white", icon: "🧻", desc: "应急修补、捆扎与加固" },
  "备用电池": { itemId: "G-020", type: "material", cost: 12, quality: "white", icon: "🔋", desc: "为手电等电子设备补充电力" },
  // 通用消耗品
  "压缩干粮": { itemId: "G-021", type: "consumable", cost: 10, quality: "white", icon: "🥮", desc: "便携口粮，恢复 8 点生命并缓解饥饿" },
  "旅行水壶": { itemId: "G-022", type: "consumable", cost: 8, quality: "white", icon: "🚰", desc: "清洁饮水，恢复 5 点生命" },
  // 消耗品
  "急救包": { itemId: "G-040", type: "consumable", cost: 25, quality: "white", icon: "🩹", desc: "恢复20点HP" },
  "SAN恢复药": { itemId: "G-041", type: "consumable", cost: 30, quality: "white", icon: "🍵", desc: "恢复30点SAN" },
  // ★ 现实向装备（新框架模板 → 购买生成实例，落入格子背包装备分区，装备到六槽）
  "左轮手枪": { itemId: "G-023", type: "equipment", cost: 120, quality: "blue", icon: "🔫", desc: "老式六发左轮，射击精准，力量+2" },
  "猎刀": { itemId: "G-024", type: "equipment", cost: 60, quality: "green", icon: "🔪", desc: "厚脊猎刀，力量+1 敏捷+1" },
  "猎鹿帽": { itemId: "G-025", type: "equipment", cost: 70, quality: "blue", icon: "🎩", desc: "翻毛边猎鹿帽，智力+2" },
  "防毒面具": { itemId: "G-026", type: "equipment", cost: 90, quality: "blue", icon: "😷", desc: "老式防毒面具，体质+1 智力+1" },
  "调查员风衣": { itemId: "G-027", type: "equipment", cost: 110, quality: "blue", icon: "🧥", desc: "双排扣驼色风衣，体质+2" },
  "皮夹克": { itemId: "G-028", type: "equipment", cost: 80, quality: "green", icon: "🥼", desc: "硬朗旧皮夹克，力量+1 体质+1" },
  "战术手套": { itemId: "G-029", type: "equipment", cost: 65, quality: "blue", icon: "🧤", desc: "指节加固战术手套，敏捷+2" },
  "登山靴": { itemId: "G-030", type: "equipment", cost: 75, quality: "blue", icon: "🥾", desc: "高帮厚底登山靴，体质+1 敏捷+1" },
  "黄铜手链": { itemId: "G-031", type: "equipment", cost: 85, quality: "blue", icon: "📿", desc: "雕纹黄铜手链，意志力+2" },
  "银质吊坠": { itemId: "G-032", type: "equipment", cost: 55, quality: "green", icon: "🧿", desc: "老银吊坠，智力+1 意志力+1" },
  // ★ 强化改为对应效果的药水（消耗品 → 购买得药水，使用后永久生效）
  "力量药水": { itemId: "G-033", type: "consumable", cost: 40, quality: "green", icon: "🧪", desc: "猩红药剂，永久力量+5" },
  "敏捷药水": { itemId: "G-034", type: "consumable", cost: 40, quality: "green", icon: "⚗️", desc: "翠绿药剂，永久敏捷+5" },
  "体质药水": { itemId: "G-035", type: "consumable", cost: 40, quality: "green", icon: "🧴", desc: "赭石药剂，永久体质+5" },
  "智力药水": { itemId: "G-036", type: "consumable", cost: 40, quality: "green", icon: "🍾", desc: "湛蓝药剂，永久智力+5" },
  "意志药水": { itemId: "G-037", type: "consumable", cost: 40, quality: "green", icon: "🫙", desc: "紫晶药剂，永久意志力+5" },
  "浓血药剂": { itemId: "G-038", type: "consumable", cost: 30, quality: "green", icon: "🩸", desc: "恢复35点生命" },
  "安神药剂": { itemId: "G-039", type: "consumable", cost: 35, quality: "green", icon: "🍵", desc: "恢复35点理智" }
};

// ==================== 加载场景数据 ====================
let SCENES = [];
try {
  SCENES = require('../config/scenes.json');
} catch (e) {
  console.log('scenes.json 未加载，场景匹配将降级为素材库');
}

// ==================== ECS系统 ====================
class Entity {
  constructor(id) { this.id = id; this.components = new Map(); }
  addComponent(name, data) { this.components.set(name, data); }
  getComponent(name) { return this.components.get(name); }
}
class EntityManager {
  constructor() { this.entities = new Map(); this.nextId = 1; }
  createEntity() { const id = `ent_${this.nextId++}`; const e = new Entity(id); this.entities.set(id, e); return e; }
  removeEntity(id) { this.entities.delete(id); }
  getEntity(id) { return this.entities.get(id); }
}

class EventBus {
  constructor() { this.listeners = {}; }
  on(e, cb) { (this.listeners[e] = this.listeners[e] || []).push(cb); }
  emit(e, data) { (this.listeners[e] || []).forEach(cb => cb(data)); }
}

class ResourceManager {
  constructor() {
    this.cache = new Map();
    this.resourceIndex = [];
    try { this.resourceIndex = JSON.parse(require('fs').readFileSync('./resource.json','utf8')); }
    catch(e) { console.log('resource.json 未加载'); }
  }
  matchResource(tags) {
    if (!tags || tags.length === 0 || this.resourceIndex.length === 0) return null;
    let best = null, maxScore = 0;
    for (const res of this.resourceIndex) {
      const score = res.tags.filter(t => tags.includes(t)).length;
      if (score > maxScore) { maxScore = score; best = res; }
    }
    return best ? best.url : null;
  }
}

// 全局单例，避免每次 AI 回复时重复读取 resource.json
const resourceManager = new ResourceManager();

// ==================== 场景匹配函数 ====================
function matchSceneByTags(tags) {
  if (!tags || tags.length === 0 || SCENES.length === 0) return null;
  let best = null, maxScore = 0;
  for (const scene of SCENES) {
    const score = scene.sceneTags.filter(tag => tags.includes(tag)).length;
    if (score > maxScore) { maxScore = score; best = scene; }
  }
  return best;
}

// ==================== 玩家辅助 ====================
function createNewPlayer(data) {
  const career = CAREERS[data.career];
  if (!career) return null;
  // ★ P0 6维属性（力量/敏捷/体力/智力/魅力/幸运）+ 隐藏（意志力/灵魂强度）+ SAN 0-80（2026-08-23）
  const base = { str:40, dex:40, con:40, int:40, cha:40, lck:40, hp:0, maxHp:0, san:0, maxSan:80 };
  const hidden = { will: 40, soul: 40 };
  Object.keys(career.bonus || {}).forEach(k => {
    const key = (k === 'per') ? 'int' : ((k === 'wil') ? 'will' : k);
    if (base[key] !== undefined) base[key] += career.bonus[k];
    else if (key === 'will') hidden.will += career.bonus[k];
  });
  base.hp = base.con * 2;
  base.maxHp = base.con * 2;
  base.san = Math.min(base.maxSan, hidden.will);   // SAN 初始 = 隐藏意志力（0-80）
  base.per = base.int;          // ★ 兼容镜像：旧 PER 判定逻辑仍可读（感知→智力）
  base.wil = hidden.will;       // ★ 兼容镜像：旧 WIL 判定逻辑仍可读
  // ★ 技能树初始化（新职业）：精点 2 + 解锁被动/2 主动
  let unlockedSkills = [], equippedSkills = [];
  const skillTree = require('./skillTree');
  const treeId = skillTree.getTreeId(data.career);
  if (treeId) {
    const init = skillTree.getInitialSkills(treeId);
    unlockedSkills = init.slice();
    equippedSkills = init.slice();
  } else {
    unlockedSkills = (career.skills || []).slice();
    equippedSkills = (career.skills || []).slice();
  }
  return {
    uid: data.uid,
    name: data.name || "调查员",
    career: data.career,
    level: 1, exp: 0, mysteryPoint: 100,
    skillPoints: treeId ? 2 : 0,
    attrPoints: 0,
    unlockedSkills,
    equippedSkills,
    attr: base,
    hidden: hidden,             // ★ 隐藏属性：意志力(精神抵抗) / 灵魂强度(高危装备门槛)
    traits: [],
    skills: (career.skills || []).slice(),
    skillCooldowns: {},
    equip: { weapon: null, accessory: null },
    inventory: [],
    warehouse: [],
    unlockCopy: [],
    sealedSkill: [],
    createTime: new Date().toISOString().split('T')[0]
  };
}

function checkAttrImbalance(attr) {
  const nums = [attr.str, attr.dex, attr.con, attr.per, attr.wil];
  const extHigh = nums.filter(v => v >= 95).length;
  const extLow = nums.filter(v => v <= 30).length;
  if (extHigh >= 1 && extLow >= 2) return 'extreme';
  const high = nums.filter(v => v >= 85).length;
  const low = nums.filter(v => v <= 35).length;
  if (high >= 1 && low >= 2) return 'imbalance';
  return null;
}

function checkLevelUp(player) {
  while (player.level < 20) {
    const expNeeded = player.level * 100;
    if (player.exp < expNeeded) break;
    player.level++;
    player.exp -= expNeeded;
    ['str','dex','con','int','cha','lck'].forEach(k => player.attr[k] = Math.min(100, player.attr[k] + 2));
    player.attr.per = player.attr.int;   // ★ 兼容镜像
    if (!player.hidden) player.hidden = { will: 40, soul: 40 };
    player.attr.wil = player.hidden.will;  // ★ 兼容镜像
    // ★ 升级额外获得 5 点可分配属性点（供「技能加点」面板手动分配）
    player.attrPoints = (player.attrPoints || 0) + 5;
    if (player.level % 3 === 0) player.attr.maxSan = Math.min(80, (player.attr.maxSan || 80) + 5);
    player.attr.maxHp = player.attr.con * 2;
    player.attr.hp = Math.min(player.attr.hp, player.attr.maxHp);
    player.attr.san = Math.min(player.attr.san, player.attr.maxSan);
  }
}

function calculateScore(copyState) {
  const s = copyState.scores;
  const total = (s.clue||0) + (s.survival||0) + (s.sanity||0) + (s.contribution||0);
  let grade = 'D';
  if (total >= 90) grade = 'S';
  else if (total >= 75) grade = 'A';
  else if (total >= 60) grade = 'B';
  else if (total >= 45) grade = 'C';
  const reward = { mysteryPoint:0, exp:0 };
  if (grade === 'S') { reward.mysteryPoint=60; reward.exp=30; }
  else if (grade === 'A') { reward.mysteryPoint=35; reward.exp=18; }
  else if (grade === 'B') { reward.mysteryPoint=15; reward.exp=8; }
  // ★ 技能精点：评级 → 精点（D1/C2/B4/A7/S12）
  const skillPoints = { S:12, A:7, B:4, C:2, D:1 }[grade] || 0;
  return { grade, total, reward, skillPoints };
}

// ==================== 回合制技能 CD ====================
// 技能冷却由「秒」改为「回合」：cooldown(秒) / 5 → 回合数（10s→2回合、15s→3、20s→4、25s→5）
function cooldownToTurns(sec) {
  const n = parseInt(sec, 10);
  if (isNaN(n) || n <= 0) return 1;
  return Math.max(1, Math.round(n / 5));
}

// 获取技能 CD 回合数：查职业技能表 cooldown(秒) 转回合；找不到默认 3 回合
function getSkillCooldownTurns(careerName, skillName) {
  if (careerName && skillName) {
    const prof = PROFESSIONS.find(p => p.name === careerName);
    if (prof && Array.isArray(prof.skills)) {
      const sk = prof.skills.find(s => s.name === skillName);
      if (sk && sk.cooldown) return cooldownToTurns(sk.cooldown);
    }
  }
  return 3;
}

// ==================== 永久 SAN 上限损耗（P0）====================
// 规则（文档模块5）：临时 SAN 损耗副本结束自动恢复；永久 SAN 上限降低来自窥见旧日真相/高危剧情/异化淘汰，
// 不可自然恢复，全局角色永久生效（记录于角色档案）。
/**
 * 应用永久 SAN 上限损耗
 * @param {Object} character - 角色（含 attr）
 * @param {number} amount - 损耗数值（正整数）
 * @param {string} [source] - 损耗来源（如 '异化淘汰' / '窥见旧日真相' / 物品名）
 * @returns {number} 实际损耗量（0 表示无损耗）
 */
function applyPermanentSanLoss(character, amount, source) {
  const attr = character && character.attr;
  if (!attr) return 0;
  const loss = Math.max(0, parseInt(amount, 10) || 0);
  if (loss <= 0) return 0;
  const oldMax = attr.maxSan || 80;
  const newMax = Math.max(0, oldMax - loss);
  attr.maxSan = newMax;
  if (attr.san != null) attr.san = Math.min(attr.san, newMax);
  character.permanentSanLoss = (character.permanentSanLoss || 0) + loss;
  if (!character.sanLossHistory) character.sanLossHistory = [];
  character.sanLossHistory.push({
    type: 'permanent',
    amount: loss,
    maxSanBefore: oldMax,
    maxSanAfter: newMax,
    source: source || '系统',
    time: new Date().toISOString()
  });
  return loss;
}

/** 恢复临时 SAN 损耗（副本结束调用）：san 刷新至当前 maxSan */
function restoreTemporarySan(character) {
  const attr = character && character.attr;
  if (!attr) return;
  if (attr.maxSan != null) attr.san = attr.maxSan;
}

// ==================== 素材档案库（P1，文档模块1 面板附属记录） ====================
// archive 四分类：npcQuotes(NPC证词) / books(古籍文本) / monsters(怪物图鉴) / anomalies(异象见闻)
// 跨副本永久保存；自动收录去重（id 唯一）。
function ensureArchive(character) {
  if (!character) return null;
  if (!character.archive || typeof character.archive !== 'object') {
    character.archive = { npcQuotes: [], books: [], monsters: [], anomalies: [] };
  }
  ['npcQuotes', 'books', 'monsters', 'anomalies'].forEach(k => {
    if (!Array.isArray(character.archive[k])) character.archive[k] = [];
  });
  return character.archive;
}

/**
 * 收录一条素材档案（自动去重）
 * @param {Object} character
 * @param {'npcQuotes'|'books'|'monsters'|'anomalies'} category
 * @param {Object} entry { id, title, content, source }
 * @returns {boolean} 是否新增收录
 */
function addArchiveEntry(character, category, entry) {
  const arc = ensureArchive(character);
  if (!arc || !arc[category] || !entry || !entry.id) return false;
  if (arc[category].some(x => x.id === entry.id)) return false;
  arc[category].push({
    id: entry.id,
    title: entry.title || '',
    content: entry.content || '',
    source: entry.source || '',
    time: new Date().toISOString().slice(0, 16)
  });
  return true;
}

/** 查询素材档案库（不存在返回空四分类结构） */
function getArchive(character) {
  const arc = ensureArchive(character);
  return arc || { npcQuotes: [], books: [], monsters: [], anomalies: [] };
}

// ==================== 轮回记录（P1，文档模块1 面板附属记录） ====================
/** 记录一次副本轮回（结算时调用，追加到 copiesHistory） */
function recordCopyHistory(character, data) {
  if (!character) return;
  if (!Array.isArray(character.copiesHistory)) character.copiesHistory = [];
  character.copiesHistory.push({
    copyName: data.copyName || '',
    grade: data.grade || 'D',
    totalScore: data.totalScore || 0,
    expGained: data.expGained || 0,
    mysteryPointGained: data.mysteryPointGained || 0,
    skillPointsGained: data.skillPointsGained || 0,
    permanentSanLoss: data.permanentSanLoss || 0,
    cleared: !!data.cleared,
    time: new Date().toISOString().slice(0, 16)
  });
  if (character.copiesHistory.length > 50) character.copiesHistory = character.copiesHistory.slice(-50);
}

// ==================== 阶位权限体系（P1，文档模块1 阶位权限） ====================
// 阶位不增加任何属性，仅解锁权限：带入装备上限 / 商城高阶商品。副本外提升。
const TIER_NAMES = ['见习', '初阶', '中阶', '高阶', '资深', '大师'];
const TIER_THRESHOLDS = [0, 1, 3, 6, 10, 15];   // 各阶位所需累计通关副本数

/** 依据累计通关次数计算阶位（0-5） */
function tierForCopies(count) {
  let tier = 0;
  for (let i = 0; i < TIER_THRESHOLDS.length; i++) {
    if ((count || 0) >= TIER_THRESHOLDS[i]) tier = i;
  }
  return tier;
}

/** 角色当前阶位（派生自 clearedCopies 长度） */
function getTier(character) {
  const count = (character && Array.isArray(character.clearedCopies)) ? character.clearedCopies.length : 0;
  return tierForCopies(count);
}

/** 阶位名称 */
function tierName(tier) {
  return TIER_NAMES[Math.max(0, Math.min(TIER_NAMES.length - 1, tier || 0))] || '见习';
}

/** 商城商品所需阶位名（无门槛返回 null） */
function tierRequirementLabel(required) {
  if (!required) return null;
  return TIER_NAMES[required] ? `${TIER_NAMES[required]}阶` : null;
}

module.exports = {
  CAREERS, COPIES, BEGINNER_DUNGEONS, SHOP_ITEMS, SCENES,
  EntityManager, EventBus, ResourceManager,
  resourceManager,
  createNewPlayer, checkAttrImbalance, checkLevelUp, calculateScore,
  matchSceneByTags,
  cooldownToTurns, getSkillCooldownTurns,
  applyPermanentSanLoss, restoreTemporarySan,
  ensureArchive, addArchiveEntry, getArchive, recordCopyHistory,
  tierForCopies, getTier, tierName, tierRequirementLabel
};