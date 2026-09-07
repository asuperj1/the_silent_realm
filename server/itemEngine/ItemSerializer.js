/**
 * ItemSerializer.js — 序列化 / 存档 / 隔离
 * 物品实例本身为纯 JSON 对象（可直接入存档）。
 * 职责：深度克隆、前端脱敏、副本背包清理、物品目录快照。
 */
class ItemSerializer {
  constructor() {}

  /** 深度克隆实例（防止引用污染） */
  clone(inst) {
    return JSON.parse(JSON.stringify(inst));
  }

  /** 从存档反序列化物品数组（校验基本字段） */
  deserialize(list) {
    return (list || []).filter(i => i && i.itemId).map(i => ({ ...i }));
  }

  /**
   * 前端脱敏：只暴露展示所需字段
   * @param {Object} inst
   * @returns {Object}
   */
  toView(inst) {
    if (!inst) return null;
    return {
      uid: inst.uid,
      itemId: inst.itemId,
      itemName: inst.itemName,
      type: inst.type,
      quality: inst.quality,
      desc: inst.desc,
      icon: inst.icon,
      stack: inst.stack,
      maxStack: inst.maxStack,
      stackable: inst.stackable,
      usable: inst.usable,
      cooldown: inst.cooldown,
      slot: inst.slot,
      weaponKind: inst.weaponKind,
      tags: (inst.tags || []).slice(),
      effects: (inst.effects || []).map(e => ({ ...e })),
      dungeonId: inst.dungeonId || null,
      belongDungeon: inst.belongDungeon || 'all',
      // ★ 黑色可成长装备字段（P0）
      bind: inst.bind || false,
      boundTo: inst.boundTo || null,
      growthTier: inst.growthTier ?? 0,
      growthConditions: (inst.growthConditions || []).map(c => ({ ...c })),
      growthProgress: (inst.growthProgress || []).slice(),
      growthLog: (inst.growthLog || []).slice(),
      // ★ 工坊字段（强化/耐久）
      enhanceLevel: inst.enhanceLevel ?? 0,
      durability: inst.durability ?? inst.maxDurability ?? 100,
      maxDurability: inst.maxDurability ?? 100
    };
  }

  toViewList(list) {
    return (list || []).map(i => this.toView(i));
  }

  /** 副本结束：从数组移除所有属于该副本的物品（隔离） */
  filterOutDungeon(list, dungeonId) {
    return (list || []).filter(i => {
      if (i.belongDungeon && i.belongDungeon !== 'all') return i.belongDungeon !== dungeonId;
      if (i.dungeonId) return i.dungeonId !== dungeonId;
      return true;
    });
  }
}

module.exports = ItemSerializer;
