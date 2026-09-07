/**
 * ItemRegistry.js — 物品注册表（按前缀命名空间分区）
 * 全局区 G-* 常驻；副本区 QFS-* / YC-* / RTD-* 动态注册/注销
 * 生命周期：副本开启注册 → 副本结束注销，物理隔离
 */
const { validateTemplate } = require('./BaseItem');

class ItemRegistry {
  constructor() {
    this._templates = new Map();   // itemId -> template
    this._prefixes = new Map();    // prefix -> Set<itemId>（用于整区注销）
    this._global = new Set();      // 常驻 itemId（不可注销）
  }

  /**
   * 注册一个/一批物品模板
   * @param {Object|Object[]} templates
   * @param {Object} opts { global: boolean, prefix: string }
   */
  register(templates, opts = {}) {
    const list = Array.isArray(templates) ? templates : [templates];
    const added = [];
    for (const tpl of list) {
      const err = validateTemplate(tpl);
      if (err) { console.warn('[ItemRegistry] 跳过注册：' + err); continue; }
      this._templates.set(tpl.itemId, tpl);
      const prefix = opts.prefix || inferPrefix(tpl.itemId);
      if (prefix) {
        if (!this._prefixes.has(prefix)) this._prefixes.set(prefix, new Set());
        this._prefixes.get(prefix).add(tpl.itemId);
      }
      if (opts.global) this._global.add(tpl.itemId);
      added.push(tpl.itemId);
    }
    return added;
  }

  /** 按前缀注销整区（副本结束） */
  unregisterPrefix(prefix) {
    const ids = this._prefixes.get(prefix);
    if (!ids) return 0;
    let n = 0;
    for (const id of ids) {
      if (this._global.has(id)) continue; // 全局不可注销
      this._templates.delete(id);
      n++;
    }
    this._prefixes.delete(prefix);
    return n;
  }

  /** 注销单个（非全局） */
  unregister(itemId) {
    if (this._global.has(itemId)) return false;
    return this._templates.delete(itemId);
  }

  get(itemId) {
    return this._templates.get(itemId) || null;
  }

  has(itemId) {
    return this._templates.has(itemId);
  }

  /** 是否全局常驻 */
  isGlobal(itemId) {
    return this._global.has(itemId);
  }

  /** 已注册前缀列表 */
  prefixes() {
    return Array.from(this._prefixes.keys());
  }

  /** 全部模板（物品目录） */
  all() {
    return Array.from(this._templates.values());
  }

  /** 按类型筛选 */
  byType(type) {
    return this.all().filter(t => t.type === type);
  }
}

/** 从 itemId 推断前缀（G- / QFS- / YC- / RTD-） */
function inferPrefix(itemId) {
  if (!itemId || typeof itemId !== 'string') return null;
  const m = itemId.match(/^([A-Za-z]+)-/);
  return m ? m[1].toUpperCase() : null;
}

module.exports = ItemRegistry;
