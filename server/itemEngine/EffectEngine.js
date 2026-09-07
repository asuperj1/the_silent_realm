/**
 * EffectEngine.js — 效果引擎：效果/词条/冷却/持续回合执行器
 * 内置效果开箱即用；副本专属特殊效果 = EffectEngine.register(id, handler) 后由 effects[].custom 引用
 * 对齐《通用物品框架系统设计 V1.0》3.2 / 6.x 节
 */

// ★ 6 维镜像同步：per↔int、wil↔hidden.will（cha↔hidden.soul）
function _syncAttrMirror(attr, char) {
  if (!attr) return;
  if (attr.int !== undefined && attr.per !== undefined) attr.per = attr.int;
  const hidden = char && char.hidden;
  if (hidden) {
    if (attr.wil !== undefined && hidden.will !== undefined) hidden.will = attr.wil;
    if (attr.cha !== undefined && hidden.soul !== undefined) hidden.soul = attr.cha;
  }
}

class EffectEngine {
  constructor() {
    this._handlers = new Map();   // custom id -> handler(effect, ctx)
  }

  /**
   * 注册副本专属自定义效果（扩容只填配置的关键）
   * @param {string} id 如 'qingfengshan.timelock'
   * @param {(effect, ctx) => {msg?:string, changes?:Object}} handler
   */
  register(id, handler) {
    if (typeof handler !== 'function') throw new Error('EffectEngine.register 需要函数: ' + id);
    this._handlers.set(id, handler);
  }

  hasCustom(id) {
    return this._handlers.has(id);
  }

  /**
   * 执行单个效果
   * @param {Object} effect { trigger, kind, stat, value, duration, target, custom }
   * @param {Object} ctx { character, dungeonId, room, source }
   * @returns {Object} { msg, changes } changes 可直接合并到角色
   */
  apply(effect, ctx = {}) {
    const char = ctx.character;
    if (!char) return { msg: '' };
    const attr = char.attr || (char.attr = {});
    const value = effect.value || 0;
    const stat = effect.stat ? effect.stat.toLowerCase() : null;
    const messages = [];

    // 自定义效果优先
    if (effect.kind === 'custom' && effect.custom && this._handlers.has(effect.custom)) {
      const r = this._handlers.get(effect.custom)(effect, ctx);
      if (r && r.msg) messages.push(r.msg);
      return { msg: messages.join('；'), changes: (r && r.changes) || null };
    }

    switch (effect.kind) {
      case 'hp': {
        if (value > 0) {
          const cap = attr.maxHp || attr.hp || 0;
          const before = attr.hp;
          attr.hp = Math.min(cap, (attr.hp || 0) + value);
          messages.push(`HP ${before}→${attr.hp}`);
        } else {
          attr.hp = Math.max(0, (attr.hp || 0) + value);
          messages.push(`HP ${attr.hp}`);
        }
        break;
      }
      case 'san': {
        if (value > 0) {
          const cap = attr.maxSan || attr.san || 0;
          attr.san = Math.min(cap, (attr.san || 0) + value);
          messages.push(`SAN +${value}（当前 ${attr.san}）`);
        } else {
          attr.san = Math.max(0, (attr.san || 0) + value);
          messages.push(`SAN ${attr.san}`);
        }
        break;
      }
      case 'stat': {
        if (stat && attr[stat] !== undefined) {
          if (effect.duration && effect.duration > 0) {
            // 临时 buff：立即加到属性（战斗/判定直接读 attr），回合衰减时减回
            char.itemBuffs = char.itemBuffs || [];
            char.itemBuffs.push({
              stat, value,
              remainTurns: effect.duration,
              source: (ctx.source && ctx.source.itemName) || effect.custom || 'item'
            });
            attr[stat] = Math.max(0, (attr[stat] || 0) + value);
            _syncAttrMirror(attr, char);
            messages.push(`${stat.toUpperCase()} ${value > 0 ? '+' : ''}${value}（${effect.duration}回合）`);
          } else {
            // 永久（装备主属性、perm 道具）
            attr[stat] += value;
            _syncAttrMirror(attr, char);
            messages.push(`${stat.toUpperCase()} ${value > 0 ? '+' : ''}${value}（当前 ${attr[stat]}）`);
          }
        }
        break;
      }
      case 'shield': {
        char.itemShield = (char.itemShield || 0) + value;
        messages.push(`护盾 +${value}`);
        break;
      }
      case 'damage': {
        // 直接伤害（攻击类弹药等）
        attr.hp = Math.max(0, (attr.hp || 0) - value);
        messages.push(`造成伤害 ${value}`);
        break;
      }
      case 'buff':
      case 'debuff': {
        char.statusEffects = char.statusEffects || [];
        char.statusEffects.push({
          id: effect.custom || (effect.kind + '_' + Date.now()),
          label: effect.label || (effect.kind === 'buff' ? '增益' : '减益'),
          value, remainTurns: effect.duration || 1,
          stat
        });
        messages.push(`${effect.label || (effect.kind === 'buff' ? '增益' : '减益')}生效`);
        break;
      }
      case 'identify':
        messages.push(effect.msg || '获得辨识信息');
        break;
      case 'loot':
        messages.push(effect.msg || '触发额外掉落');
        break;
      case 'dialog':
        messages.push(effect.msg || '触发对话');
        break;
      default:
        messages.push(effect.msg || '效果已生效');
    }
    return { msg: messages.join('；') };
  }

  /**
   * 使用物品：执行全部 trigger='use' 效果
   * @param {Object} inst 物品实例
   * @param {Object} character
   * @param {Object} ctx { dungeonId, room }
   * @returns {Object} { ok, msg }
   */
  useItem(inst, character, ctx = {}) {
    if (!inst.usable && inst.type !== 'consumable') return { ok: false, msg: '该物品不可主动使用' };
    const useEffects = (inst.effects || []).filter(e => e.trigger === 'use' || !e.trigger);
    if (!useEffects.length) return { ok: false, msg: '该物品无使用效果' };
    const msgs = [];
    for (const eff of useEffects) {
      const r = this.apply(eff, { character, dungeonId: ctx.dungeonId, room: ctx.room, source: inst });
      if (r.msg) msgs.push(r.msg);
    }
    return { ok: true, msg: msgs.join('；') };
  }

  /**
   * 结算回合开始：衰减临时 buff / statusEffects / 冷却
   * @param {Object} character
   */
  onTurnStart(character) {
    const msgs = [];
    if (Array.isArray(character.itemBuffs)) {
      for (let i = character.itemBuffs.length - 1; i >= 0; i--) {
        const b = character.itemBuffs[i];
        b.remainTurns--;
        if (b.remainTurns <= 0) {
          character.itemBuffs.splice(i, 1);
          // ★ 临时属性加成到期 → 减回属性
          if (b.stat && character.attr && character.attr[b.stat] !== undefined) {
            character.attr[b.stat] = Math.max(0, (character.attr[b.stat] || 0) - b.value);
            _syncAttrMirror(character.attr, character);
          }
          msgs.push(`${b.source || '临时加成'}失效`);
        }
      }
    }
    if (Array.isArray(character.statusEffects)) {
      for (let i = character.statusEffects.length - 1; i >= 0; i--) {
        const s = character.statusEffects[i];
        s.remainTurns--;
        if (s.remainTurns <= 0) character.statusEffects.splice(i, 1);
      }
    }
    return msgs;
  }

  /** 计算装备/被动提供的属性加成合计（叠加到角色 attr 时使用） */
  computePassiveBonus(instList) {
    const total = {};
    for (const inst of instList || []) {
      if (!inst || !Array.isArray(inst.effects)) continue;
      for (const eff of inst.effects) {
        if (eff.kind !== 'stat') continue;
        if (eff.trigger !== 'passive' && eff.trigger !== 'onEquip') continue;
        const stat = eff.stat ? eff.stat.toLowerCase() : null;
        if (!stat) continue;
        if (eff.duration && eff.duration > 0) continue; // 临时不算常驻
        total[stat] = (total[stat] || 0) + (eff.value || 0);
      }
    }
    return total;
  }
}

module.exports = EffectEngine;
