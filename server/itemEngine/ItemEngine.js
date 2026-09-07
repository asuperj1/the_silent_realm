/**
 * ItemEngine.js — 物品引擎·全局单例（框架入口）
 * 聚合：Registry / Factory / Inventory / Equipment / EffectEngine / Loot / Serializer / DungeonRegistry
 * 扩容 = 新建 config/items/dungeons/<副本>.json 导入清单，引擎零改动。
 */
const path = require('path');
const fs = require('fs');

const ItemRegistry = require('./ItemRegistry');
const ItemFactory = require('./ItemFactory');
const EffectEngine = require('./EffectEngine');
const EquipmentSystem = require('./EquipmentSystem');
const LootSystem = require('./LootSystem');
const DungeonRegistry = require('./DungeonRegistry');
const ItemSerializer = require('./ItemSerializer');
const { QUALITY, EQUIP_SLOTS, SLOT_LABELS, WEAPON_KINDS } = require('./BaseItem');

class ItemEngine {
  constructor() {
    this.registry = new ItemRegistry();
    this.factory = new ItemFactory(this.registry);
    this.effects = new EffectEngine();
    this.equipment = new EquipmentSystem(this.effects);
    this.loot = new LootSystem(this.factory);
    this.dungeons = new DungeonRegistry(this.registry, this.loot);
    this.serializer = new ItemSerializer();
    this._byName = new Map();   // itemName -> template
    this._configDir = null;

    // 装备系统通过 itemName 解析模板
    this.equipment.setTemplateResolver((name) => this.resolveByName(name));
  }

  /**
   * 初始化：加载全局物品池 + 注册副本清单定义 + 注册内置自定义效果
   * @param {string} configDir 通常指向 config/items
   */
  init(configDir) {
    this._configDir = configDir || path.join(__dirname, '..', '..', 'config', 'items');
    // 1) 全局物品池 G-*（常驻）
    try {
      const g = require(path.join(this._configDir, 'global_items.json'));
      if (g.items && Array.isArray(g.items)) {
        this.registry.register(g.items, { global: true, prefix: 'G' });
      }
    } catch (e) { console.warn('[ItemEngine] 全局物品池加载失败', e.message); }

    // 2) 副本导入清单（注册定义 + ★ 物品模板常驻注册，供装备/使用解析；掉落仍按副本激活）
    const dungeonDir = path.join(this._configDir, 'dungeons');
    if (fs.existsSync(dungeonDir)) {
      for (const f of fs.readdirSync(dungeonDir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const m = JSON.parse(fs.readFileSync(path.join(dungeonDir, f), 'utf8'));
          this.dungeons.registerManifest(m);
          // 物品模板常驻注册（副本隔离通过「副本结束清背包」保证，掉落按副本激活）
          const all = [...(m.items || []), ...(m.bossDrop || [])];
          this.registry.register(all, { prefix: m.prefix || 'COPY' });
        } catch (e) { console.warn('[ItemEngine] 副本清单加载失败', f, e.message); }
      }
    }

    // 3) 注册副本专属自定义效果 handler（每个副本目录一份 handler 文件）
    this._registerDungeonHandlers();

    this._reindex();
    console.log(`[ItemEngine] 就绪：全局物品 ${this.registry.byType('consumable').length + this.registry.byType('material').length} 件，副本清单 ${this.dungeons.allManifests().length} 份`);
    return this;
  }

  _registerDungeonHandlers() {
    const dir = path.join(__dirname, 'dungeonHandlers');
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      try {
        const mod = require(path.join(dir, f));
        if (mod && typeof mod.register === 'function') mod.register(this.effects);
      } catch (e) { console.warn('[ItemEngine] 自定义效果 handler 注册失败', f, e.message); }
    }
  }

  /** 重建 name → template 索引 */
  _reindex() {
    this._byName.clear();
    for (const t of this.registry.all()) {
      this._byName.set(t.itemName, t);
    }
  }

  resolveTemplate(itemIdOrName) {
    return this.registry.get(itemIdOrName) || this._byName.get(itemIdOrName) || null;
  }

  resolveByName(name) {
    return this._byName.get(name) || null;
  }

  // ==================== 副本生命周期 ====================
  loadDungeon(dungeonId) {
    const n = this.dungeons.loadDungeon(dungeonId);
    this._reindex();
    return n;
  }

  unloadDungeon(dungeonId) {
    const n = this.dungeons.unloadDungeon(dungeonId);
    this._reindex();
    return n;
  }

  isDungeonActive(dungeonId) {
    return this.dungeons.isActive(dungeonId);
  }

  // ==================== 使用/装备/掉落 ====================
  useItem(character, inst, ctx = {}) {
    return this.effects.useItem(inst, character, { dungeonId: ctx.dungeonId, room: ctx.room });
  }

  equip(character, inst, slot) {
    return this.equipment.equip(character, inst, slot);
  }

  unequip(character, slot) {
    return this.equipment.unequip(character, slot);
  }

  roll(dungeonId, scene, action, ctx = {}) {
    return this.loot.roll(dungeonId, scene, action, ctx);
  }

  onTurnStart(character) {
    return this.effects.onTurnStart(character);
  }

  // ==================== 黑色可成长装备（P0，文档模块3）====================
  /**
   * 黑色装备绑定角色：掉落时调用，写入 boundTo
   * @param {Object} inst 物品实例（quality==='black' 或 bind）
   * @param {string} characterUid
   */
  bindTo(inst, characterUid) {
    if (!inst) return inst;
    if (inst.quality === 'black' || inst.bind) {
      inst.bind = true;
      inst.boundTo = characterUid || inst.boundTo || null;
    }
    return inst;
  }

  /** 判断实例是否为黑色成长装备 */
  isGrowthItem(inst) {
    return !!(inst && (inst.quality === 'black' || inst.bind) && Array.isArray(inst.growthConditions));
  }

  /**
   * 成长进度追踪：击杀/素材/剧情事件推进黑色装备成长条件
   * @param {Object} character 角色
   * @param {Object} inst 黑色装备实例
   * @param {Object} evt { type:'kill'|'material'|'quest', target, count }
   * @returns {{ changed:boolean, tier:number, done:Object|null }}
   */
  trackGrowth(character, inst, evt) {
    if (!this.isGrowthItem(inst)) return { changed: false, tier: inst.growthTier || 0, done: null };
    if (!evt || !evt.type) return { changed: false, tier: inst.growthTier || 0, done: null };
    inst.growthProgress = inst.growthProgress || [];
    inst.growthLog = inst.growthLog || [];
    // ★ 所有匹配的未完成条件统一累加进度（互不打断）
    inst.growthConditions.forEach((c, i) => {
      if (c.done) return;
      if (c.type !== evt.type) return;
      if (c.target && c.target !== evt.target) return;
      inst.growthProgress[i] = (inst.growthProgress[i] || 0) + (evt.count || 1);
    });
    // ★ 一次事件至多完成一个最先达标条件
    let changed = false, doneCond = null;
    for (let i = 0; i < inst.growthConditions.length; i++) {
      const c = inst.growthConditions[i];
      if (c.done) continue;
      if ((inst.growthProgress[i] || 0) < (c.amount || 1)) continue;
      c.done = true;
      inst.growthTier = (inst.growthTier || 0) + 1;
      if (Array.isArray(c.grant && c.grant.effects)) {
        inst.effects.push(...c.grant.effects.map(e => ({ ...e })));
      }
      inst.growthLog.push({ tier: inst.growthTier, msg: (c.grant && c.grant.msg) || '成长阶段提升', target: c.target, time: new Date().toISOString() });
      changed = true;
      doneCond = c;
      break;
    }
    return { changed, tier: inst.growthTier || 0, done: doneCond };
  }

  /**
   * 工坊：黑色装备消耗成长素材直接晋升（每阶段需素材）
   * @param {Object} inst 黑色装备实例
   * @param {Object} matInst 消耗的成长素材实例（或 null 纯剧情）
   * @returns {{ ok:boolean, msg:string, tier:number }}
   */
  growthUpgrade(inst, matInst) {
    if (!this.isGrowthItem(inst)) return { ok: false, msg: '非黑色可成长装备' };
    const nextCond = (inst.growthConditions || []).find(c => !c.done);
    if (!nextCond) return { ok: false, msg: '该装备成长路线已全部解锁' };
    if (nextCond.type === 'material') {
      if (!matInst) return { ok: false, msg: '该成长阶段需消耗成长素材' };
      const need = (nextCond.material && nextCond.material.itemId) || (nextCond.material && nextCond.material.tag);
      const has = need ? (matInst.itemId === need || (matInst.tags || []).includes(need)) : true;
      if (!has) return { ok: false, msg: '成长素材不匹配' };
    } else {
      return { ok: false, msg: '该成长条件由副本事件自动推进（击杀 / 通关 / 剧情）' };
    }
    nextCond.done = true;
    inst.growthTier = (inst.growthTier || 0) + 1;
    inst.growthProgress = inst.growthProgress || [];
    inst.growthLog = inst.growthLog || [];
    if (Array.isArray(nextCond.grant && nextCond.grant.effects)) {
      inst.effects.push(...nextCond.grant.effects.map(e => ({ ...e })));
    }
    inst.growthLog.push({ tier: inst.growthTier, msg: (nextCond.grant && nextCond.grant.msg) || '工坊成长', target: nextCond.target, time: new Date().toISOString() });
    return { ok: true, msg: (nextCond.grant && nextCond.grant.msg) || '成长成功', tier: inst.growthTier };
  }

  // ==================== 目录 / 快照 ====================
  catalog() {
    return this.serializer.toViewList(this.registry.all());
  }

  globalCatalog() {
    return this.serializer.toViewList(this.registry.all().filter(t => this.registry.isGlobal(t.itemId)));
  }

  dungeonCatalog(dungeonId) {
    const m = this.dungeons.getManifest(dungeonId);
    if (!m) return [];
    const all = [...(m.items || []), ...(m.bossDrop || [])];
    return this.serializer.toViewList(all);
  }

  qualityMap() {
    const out = {};
    for (const [k, v] of Object.entries(QUALITY)) out[k] = v;
    return out;
  }

  slotsInfo() {
    return { slots: EQUIP_SLOTS, labels: SLOT_LABELS, weaponKinds: WEAPON_KINDS };
  }
}

let _instance = null;

function getItemEngine() {
  if (!_instance) _instance = new ItemEngine();
  return _instance;
}

function createItemEngine() {
  return new ItemEngine();
}

module.exports = { ItemEngine, getItemEngine, createItemEngine };
