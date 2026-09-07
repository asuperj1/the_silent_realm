/**
 * DungeonRegistry.js — 副本导入清单加载器
 * 副本开启 → loadDungeon() 动态注册全部副本物品 + 掉落表
 * 副本结束 → unloadDungeon() 注销全部副本物品 + 清掉落表 → 回归全局池
 */
class DungeonRegistry {
  /**
   * @param {ItemRegistry} registry
   * @param {LootSystem} lootSystem
   */
  constructor(registry, lootSystem) {
    this._registry = registry;
    this._loot = lootSystem;
    this._manifests = new Map();   // dungeonId -> manifest
    this._active = new Map();      // dungeonId -> { prefix }
  }

  /** 注册一份导入清单（启动时加载所有清单定义） */
  registerManifest(manifest) {
    if (!manifest || !manifest.dungeonId) return null;
    this._manifests.set(manifest.dungeonId, manifest);
    return manifest;
  }

  getManifest(dungeonId) {
    return this._manifests.get(dungeonId) || null;
  }

  allManifests() {
    return Array.from(this._manifests.values());
  }

  /**
   * 副本开启：物品模板已由 ItemEngine.init 常驻注册，此处激活掉落表
   * @param {string} dungeonId
   * @returns {number} 掉落表条目数
   */
  loadDungeon(dungeonId) {
    const m = this._manifests.get(dungeonId);
    if (!m) return 0;
    if (this._active.has(dungeonId)) return 0;
    this._loot.setLootTables(dungeonId, m.lootTables || []);
    this._active.set(dungeonId, { prefix: m.prefix || inferPrefix(dungeonId) });
    return (m.lootTables || []).length;
  }

  /**
   * 副本结束：关闭掉落表（物品模板常驻供解析；副本背包清空由 gameHandler 负责）
   * @returns {number} 注销的掉落表条目数（与 loadDungeon 对称）
   */
  unloadDungeon(dungeonId) {
    const act = this._active.get(dungeonId);
    if (!act) return 0;
    const m = this._manifests.get(dungeonId);
    this._loot.clearLootTables(dungeonId);
    this._active.delete(dungeonId);
    return (m && m.lootTables ? m.lootTables.length : 0);
  }

  /** 副本是否已激活注册 */
  isActive(dungeonId) {
    return this._active.has(dungeonId);
  }
}

function inferPrefix(dungeonId) {
  // qingfengshan → QFS（青峰山），yucun → YC（渔村），riTower → RTD
  const map = { qingfengshan: 'QFS', yucun: 'YC', ritower: 'RTD' };
  return map[dungeonId] || dungeonId.slice(0, 3).toUpperCase();
}

module.exports = DungeonRegistry;
