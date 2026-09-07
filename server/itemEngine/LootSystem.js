/**
 * LootSystem.js — 掉落引擎（剧本表驱动，KP 不可凭空生成）
 * lootTables: [{ scene, action, label, required, entries: [{itemId, chance(0-1), min, max, once}] }]
 * roll(sceneKey, actionKey, ctx) → 按剧本表 + 随机掉落物品实例
 */
class LootSystem {
  /**
   * @param {ItemFactory} factory
   */
  constructor(factory) {
    this._factory = factory;
    this._tables = new Map();   // dungeonId -> LootTable[]
  }

  /** 注册副本掉落表 */
  setLootTables(dungeonId, tables) {
    this._tables.set(dungeonId, tables || []);
  }

  /** 注销副本掉落表 */
  clearLootTables(dungeonId) {
    this._tables.delete(dungeonId);
  }

  /**
   * 按场景+动作执行掉落
   * @param {string} dungeonId
   * @param {string} scene 场景标识（如 'car3'）
   * @param {string} action 动作标识（如 'search'）
   * @param {Object} ctx { character, room, force } force=true 忽略概率（剧情必掉）
   * @returns {Object[]} 掉落的物品实例
   */
  roll(dungeonId, scene, action, ctx = {}) {
    const tables = this._tables.get(dungeonId) || [];
    const matches = tables.filter(t =>
      (!t.scene || t.scene === scene || t.scene === '*') &&
      (!t.action || t.action === action || t.action === '*')
    );
    const drops = [];
    for (const table of matches) {
      if (table.required && ctx.character && !this._satisfyRequired(table.required, ctx.character)) continue;
      if (table.once && ctx.claimed) continue;
      for (const entry of table.entries || []) {
        const r = Math.random();
        if (ctx.force || r <= (entry.chance ?? 1)) {
          try {
            const stack = (entry.min || 1) + Math.floor(Math.random() * ((entry.max || entry.min || 1) - (entry.min || 1) + 1));
            const inst = this._factory.create(entry.itemId, { stack, dungeonId });
            // ★ 黑色可成长装备掉落即绑定当前角色（P0，文档模块3）
            if ((inst.quality === 'black' || inst.bind) && ctx.character && ctx.character.uid) {
              inst.bind = true;
              inst.boundTo = ctx.character.uid;
            }
            drops.push(inst);
          } catch (e) { console.warn('[LootSystem] 掉落失败', entry.itemId, e.message); }
        }
      }
    }
    return drops;
  }

  _satisfyRequired(req, character) {
    if (typeof req === 'string') {
      const attr = character.attr || {};
      const m = req.match(/^([a-z]+)\s*>=\s*(\d+)$/i);
      if (m) return (attr[m[1].toLowerCase()] || 0) >= +m[2];
      return true;
    }
    if (req && req.attr) {
      const v = (character.attr || {})[req.attr.toLowerCase()];
      return (v || 0) >= (req.min ?? 0);
    }
    return true;
  }
}

module.exports = LootSystem;
