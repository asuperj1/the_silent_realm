/**
 * BaseItem.js — 物品基类：定义校验 / 模板→实例 / 品质体系
 * 数据模型对齐《通用物品框架系统设计 V1.0》3.1 节
 * 四大类：plot(剧情) / consumable(消耗) / material(材料) / equipment(装备)
 * 品质：white/green/blue/purple/gold/orange/red/black
 */

const QUALITY = {
  white:  { label: '白',  rank: 0, color: '#c8c8c8', bonus: 2,  words: 0 },
  green:  { label: '绿',  rank: 1, color: '#4cc9f0', bonus: 4,  words: 1 },
  blue:   { label: '蓝',  rank: 2, color: '#4d7cff', bonus: 7,  words: 2 },
  purple: { label: '紫',  rank: 3, color: '#9b5cff', bonus: 10, words: 2 },
  gold:   { label: '金',  rank: 4, color: '#ffd700', bonus: 14, words: 3 },
  orange: { label: '橙',  rank: 5, color: '#ff8c42', bonus: 18, words: 3 },
  red:    { label: '红',  rank: 6, color: '#ff4d4d', bonus: 24, words: 4 },
  black:  { label: '黑',  rank: 7, color: '#9aa0a6', bonus: 10, words: 1 } // 成长型
};

const TYPES = ['plot', 'consumable', 'material', 'equipment', 'tool'];
// 六槽 + 武器（EQUIP_SLOTS）
const EQUIP_SLOTS = ['weapon', 'head', 'body', 'hand', 'foot', 'accessory'];

// 装备槽位中文名
const SLOT_LABELS = {
  weapon: '武器', head: '头部', body: '身体', hand: '手部', foot: '足部', accessory: '配饰'
};

// 武器类型 → 适配职业倾向 / 弹药需求 / 结算属性
const WEAPON_KINDS = {
  melee:   { label: '近战',   attr: 'str', ammo: null,   careers: ['角斗士', '百夫长', '武士', '警官'] },
  ranged:  { label: '远程',   attr: 'dex', ammo: 'bullet', careers: ['枪手', '海盗'] },
  spell:   { label: '法术',   attr: 'int', ammo: null,   careers: ['环法师', '方士', '观星者'] },
  tool:    { label: '工具',   attr: null, ammo: null,    careers: null }
};

/**
 * 校验一份物品模板（BaseItem）
 */
function validateTemplate(tpl) {
  if (!tpl) return '物品模板为空';
  if (!tpl.itemId || typeof tpl.itemId !== 'string') return '缺少 itemId';
  if (!tpl.itemName) return `[${tpl.itemId}] 缺少 itemName`;
  if (!TYPES.includes(tpl.type)) return `[${tpl.itemId}] 非法 type: ${tpl.type}`;
  if (!QUALITY[tpl.quality]) return `[${tpl.itemId}] 非法 quality: ${tpl.quality}`;
  if (tpl.effects && !Array.isArray(tpl.effects)) return `[${tpl.itemId}] effects 需为数组`;
  return null;
}

/** 物品格子尺寸：★ 所有物品一律 1×1（一格大小，用户要求） */
function defaultSize(/* tpl */) {
  return { w: 1, h: 1 };
}

/**
 * 模板 → 运行时实例（供放入背包/仓库）
 * @param {Object} tpl 物品模板
 * @param {Object} opts { uid, stack, dungeonId, grid }
 */
function createInstance(tpl, opts = {}) {
  const err = validateTemplate(tpl);
  if (err) throw new Error(err);
  const effs = (tpl.effects || []).map(e => ({ ...e }));
  const size = defaultSize(tpl);
  // ★ 黑色成长装备（P0，文档模块3）：bind=true 模板 → 实例标记绑定 + 成长阶段 + 成长条件
  const isBlack = tpl.quality === 'black';
  const inst = {
    uid: opts.uid || ('it_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
    itemId: tpl.itemId,
    itemName: tpl.itemName,
    type: tpl.type,
    quality: tpl.quality || 'white',
    desc: tpl.desc || '',
    icon: tpl.icon || '📦',
    stack: Math.min(opts.stack || 1, tpl.maxStack || 1),
    maxStack: tpl.maxStack || 1,
    stackable: !!tpl.stackable,
    usable: !!tpl.usable,
    cooldown: tpl.cooldown || 0,
    belongDungeon: tpl.belongDungeon || 'all',
    unlockMark: (tpl.unlockMark || []).slice(),
    tags: (tpl.tags || []).slice(),
    slot: tpl.slot || (tpl.type === 'equipment' ? (tpl.weaponKind ? 'weapon' : tpl.slot || 'accessory') : null),
    weaponKind: tpl.weaponKind || null,
    size: size,            // ★ 格子尺寸 { w, h }
    grid: opts.grid || null,  // ★ 格位置 { x, y }（未放置为 null）
    effects: effs,
    // ★ P0 工坊字段：强化等级 / 耐久（文档模块3）
    enhanceLevel: opts.enhanceLevel ?? tpl.enhanceLevel ?? 0,
    maxDurability: tpl.maxDurability ?? 100,
    durability: opts.durability ?? tpl.maxDurability ?? 100
  };
  if (isBlack || tpl.bind) {
    inst.bind = true;                       // 绑定标记（黑装）
    inst.boundTo = opts.boundTo || tpl.boundTo || null;  // 绑定角色 uid（掉落时写入）
    inst.growthTier = opts.growthTier ?? tpl.growthTier ?? 0;           // 成长阶段
    inst.growthConditions = (tpl.growthConditions || []).map(c => ({ ...c, done: opts.growthTierDone ? !!c.done : false }));
  }
  return inst;
}

module.exports = { QUALITY, TYPES, EQUIP_SLOTS, SLOT_LABELS, WEAPON_KINDS, defaultSize, validateTemplate, createInstance };
