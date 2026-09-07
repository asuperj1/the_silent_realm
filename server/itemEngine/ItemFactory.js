/**
 * ItemFactory.js — 工厂：模板 → 实例，绑定归属副本
 * 支持：堆叠合并 / 按名实例化 / 批量掉落实例化
 */
const { createInstance } = require('./BaseItem');

class ItemFactory {
  /**
   * @param {ItemRegistry} registry
   */
  constructor(registry) {
    this._registry = registry;
  }

  /**
   * 由模板 ID 生成实例
   * @param {string} itemId
   * @param {Object} opts { stack, dungeonId }
   */
  create(itemId, opts = {}) {
    const tpl = this._registry.get(itemId);
    if (!tpl) throw new Error('未注册的物品: ' + itemId);
    const { dungeonId, ...rest } = opts;
    const inst = createInstance(tpl, rest);
    if (dungeonId) inst.dungeonId = dungeonId;
    return inst;
  }

  /**
   * 尝试堆叠入列表（同 itemId 且可堆叠且未满则合并）
   * @returns {boolean} 是否成功堆叠（未新增实例）
   */
  tryStack(list, inst) {
    if (!inst.stackable) return false;
    const exist = list.find(i => i.itemId === inst.itemId && i.stack < i.maxStack);
    if (!exist) return false;
    const room = exist.maxStack - exist.stack;
    const take = Math.min(room, inst.stack);
    exist.stack += take;
    inst.stack -= take;
    return inst.stack <= 0;
  }

  /** 生成一批实例（掉落/发放）并返回新实例数组（未堆叠的） */
  createBatch(itemIds, opts = {}) {
    return itemIds.map(id => this.create(id, opts)).filter(Boolean);
  }
}

module.exports = ItemFactory;
