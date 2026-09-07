/**
 * EquipmentSystem.js — 装备槽 + 五维属性计算
 * 六槽 + 武器：EQUIP_SLOTS = { weapon, head, body, hand, foot, accessory }
 * 装备主属性直接叠加角色五维 → 立即重算面板（HP 上限按 CON）
 */
const { EQUIP_SLOTS, SLOT_LABELS, WEAPON_KINDS } = require('./BaseItem');

class EquipmentSystem {
  /**
   * @param {EffectEngine} effectEngine
   */
  constructor(effectEngine) {
    this._effect = effectEngine;
  }

  /** 角色装备槽（兼容旧两槽存档：缺失槽返回 null） */
  getEquipMap(character) {
    const e = character.equip || {};
    const map = {};
    for (const slot of EQUIP_SLOTS) {
      const name = e[slot];
      map[slot] = name || null;
    }
    return map;
  }

  /**
   * 装备一件物品到指定槽
   * @param {Object} character
   * @param {Object} inst 物品实例（须 type=equipment）
   * @param {string} slot
   * @returns {{ok:boolean, msg:string, old?:Object|null, equip:Object, items:Object[]}}
   *  old = 被顶下的旧装备（若槽被占），调用方负责放回背包
   */
  equip(character, inst, slot) {
    if (!inst || inst.type !== 'equipment') return { ok: false, msg: '非装备物品' };
    if (!EQUIP_SLOTS.includes(slot)) return { ok: false, msg: '非法装备槽' };
    if (!character.equip) character.equip = {};
    // ★ 兼容旧框架物品（只有 name 无 itemName）
    const itemName = inst.itemName || inst.name;
    if (!itemName) return { ok: false, msg: '装备缺少名称' };
    const oldName = character.equip[slot] || null;
    // 卸下旧装备的属性加成
    if (oldName) this._unequipByName(character, slot, oldName);
    // 装上新的
    character.equip[slot] = itemName;
    this._applySlotStat(character, slot, itemName);
    return { ok: true, msg: `${itemName} 已装备到「${SLOT_LABELS[slot]}」`, old: oldName, equip: { ...character.equip } };
  }

  /**
   * 卸下某槽装备
   * @returns {{ok:boolean, msg:string, name:string|null, equip:Object}}
   */
  unequip(character, slot) {
    if (!EQUIP_SLOTS.includes(slot)) return { ok: false, msg: '非法装备槽' };
    if (!character.equip) character.equip = {};
    const name = character.equip[slot] || null;
    if (!name) return { ok: false, msg: '该槽位为空', name: null, equip: { ...character.equip } };
    this._unequipByName(character, slot, name);
    character.equip[slot] = null;
    return { ok: true, msg: `${name} 已卸下`, name, equip: { ...character.equip } };
  }

  /** 应用装备提供的常驻属性（stat passive/onEquip）到 attr，并重算 HP 上限 */
  _applySlotStat(character, slot, itemName) {
    const tpl = this._findTemplate(character, itemName);
    if (!tpl) return;
    const bonus = this._effect.computePassiveBonus([tpl]);
    this._applyStatDelta(character, bonus);
  }

  _unequipByName(character, slot, itemName) {
    const tpl = this._findTemplate(character, itemName);
    if (!tpl) return;
    const bonus = this._effect.computePassiveBonus([tpl]);
    const neg = {};
    for (const [k, v] of Object.entries(bonus)) neg[k] = -v;
    this._applyStatDelta(character, neg);
  }

  /** 查找物品模板：优先从角色物品/引擎目录查（由 ItemEngine 注入 resolveTemplate） */
  _findTemplate(character, itemName) {
    // 由外部注入的解析器（ItemEngine 在构造后设置）
    if (this._resolveTemplate) return this._resolveTemplate(itemName);
    return null;
  }

  /** 属性增减 + HP 重算 */
  _applyStatDelta(character, delta) {
    if (!character.attr) return;
    for (const [k, v] of Object.entries(delta || {})) {
      if (['str', 'dex', 'con', 'int', 'cha', 'lck', 'per', 'wil'].includes(k) && character.attr[k] !== undefined) {
        character.attr[k] = Math.max(0, Math.min(100, character.attr[k] + v));
      }
    }
    // ★ 6 维镜像同步：per↔int、wil↔hidden.will
    const attr = character.attr;
    if (attr.int !== undefined && attr.per !== undefined) attr.per = attr.int;
    const hidden = character.hidden;
    if (hidden) {
      if (attr.wil !== undefined && hidden.will !== undefined) hidden.will = attr.wil;
      if (attr.cha !== undefined && hidden.soul !== undefined) hidden.soul = attr.cha;
    }
    // HP 上限 = CON × 2（对齐创建规则），HP 不超上限
    if (character.attr.con !== undefined) {
      character.attr.maxHp = character.attr.con * 2;
      if (character.attr.hp > character.attr.maxHp) character.attr.hp = character.attr.maxHp;
    }
  }

  /** 注入模板解析器（ItemEngine 调用） */
  setTemplateResolver(fn) {
    this._resolveTemplate = fn;
  }

  static SLOTS = EQUIP_SLOTS;
  static LABELS = SLOT_LABELS;
  static WEAPON_KINDS = WEAPON_KINDS;
}

module.exports = EquipmentSystem;
