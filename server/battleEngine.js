/**
 * battleEngine.js — 杀戮尖塔2式战斗引擎（纯 JS，v2.1 设计）
 *
 * 回合结构（§2）：
 *   玩家回合（全体玩家轮流：各自掷职业能量骰得 AP → 用普攻/技能/消耗品/换装/结束）
 *   → 敌人回合（每个存活怪物按【意图】行动）→ 回合+1 → 回玩家回合
 *
 * 核心规则（§3/§4/§6/§9）：
 *   - AP = 职业能量骰原值（2D6/3D6/4D6，不跨回合累计）
 *   - 普攻伤害 = 武器 baseDmg（空手 = 角色物攻）
 *   - 技能按 config/skill_battle.json 结算（damage/heal/block/effects）
 *   - 格挡临时值：玩家 T1 清零 / 怪物 T3 清零
 *   - 状态 11 种，T4 回合结束衰减
 *   - 伤害链：基础+面板×ratio → 力量/脆弱/易伤乘区 → 护甲减免(穿透) → 格挡 → HP
 *
 * 接口：battleStart / battleCurrent / battlePlayerAct / battleMonsterAct /
 *       battleStatus / battleReset / battleIntent
 */
const MONSTERS = require('../config/battle_monsters.json');
const SKILL_BATTLE = require('../config/skill_battle.json');
// ★ 事件驱动系统（2026-08-16）：全局事件管理器 + 回合制定时调度器
const eventBus = require('./eventBus');
const EVENTS = require('./eventTypes');
const timerScheduler = require('./timerScheduler');

const rooms = new Map(); // roomId -> battle state

const STATUS_LABEL = {
  strength: '力量', weak: '脆弱', vulnerable: '易伤', poison: '中毒', burn: '灼烧',
  blockUp: '格挡增强', dexUp: '敏捷', immobilize: '禁锢', stun: '眩晕', regen: '再生',
  shield: '护盾', fear: '恐惧', lifesteal: '吸血'
};

function getRoom(rid) { return rooms.get(String(rid)) || null; }

function rollDice(count, sides = 6) {
  let s = 0;
  for (let i = 0; i < count; i++) s += Math.floor(Math.random() * sides) + 1;
  return s;
}
function parseDice(diceStr) { const m = /^(\d+)D/i.exec(diceStr || ''); return m ? parseInt(m[1], 10) : 2; }

// ==================== 状态工具 ====================
function getStatus(unit, id) {
  return (unit.statuses || []).find(s => s.id === id) || null;
}
function addStatus(unit, id, value, turns) {
  unit.statuses = unit.statuses || [];
  const st = getStatus(unit, id);
  if (st) { st.value += (value || 0); st.turns = Math.max(st.turns, turns || 1); }
  else unit.statuses.push({ id, value: value || 1, turns: turns || 1 });
}
function decayStatuses(unit) {
  (unit.statuses || []).forEach(s => { s.turns--; });
  unit.statuses = (unit.statuses || []).filter(s => s.turns > 0);
}
function clearExpired(unit) { unit.statuses = (unit.statuses || []).filter(s => s.turns > 0); }

// ==================== 伤害结算链（§4.2） ====================
function calcDamage(attacker, defender, cfg) {
  // cfg: { base, ratio, scale: 'physAtk'|'magAtk', isTrue, hits, useWeaponBase }
  const atk = (cfg.scale === 'magAtk') ? (attacker.magAtk || 0) : (attacker.physAtk || 0);
  let base = cfg.useWeaponBase ? ((cfg.base != null) ? cfg.base : (attacker.weapon ? attacker.weapon.baseDmg : (attacker.physAtk || 0)))
    : ((cfg.base || 0) + atk * (cfg.ratio || 0));
  // 力量（攻击方）每层 +10%
  const str = getStatus(attacker, 'strength');
  if (str) base *= (1 + 0.1 * str.value);
  // 脆弱 weak（攻击方）每层 -25%
  const wk = getStatus(attacker, 'weak');
  if (wk) base *= (1 - 0.25 * wk.value);
  // 易伤 vulnerable（防守方）每层 +50%
  const vul = getStatus(defender, 'vulnerable');
  if (vul) base *= (1 + 0.5 * vul.value);
  // 疯狂：伤害 -30%
  if (getStatus(attacker, 'crazy')) base *= 0.7;
  let dmg = base;
  if (!cfg.isTrue) {
    // 护甲减免（穿透百分比削防）
    const pierce = (attacker.pierce || 0) / 100;
    const def = (defender.physDef || 0) * (1 - pierce);
    dmg -= def;
  }
  // 格挡吸收
  const block = defender.block || 0;
  const absorbed = Math.min(block, dmg);
  defender.block = Math.max(0, block - absorbed);
  dmg -= absorbed;
  dmg = Math.max(1, Math.round(dmg));
  return dmg;
}

// 持伤 dot：中毒 2×层 / 灼烧 3×层 / 再生 3×层 回复
function applyDot(unit) {
  let dmg = 0, heal = 0;
  const po = getStatus(unit, 'poison'); if (po) dmg += 2 * po.value;
  const bu = getStatus(unit, 'burn'); if (bu) dmg += 3 * bu.value;
  const rg = getStatus(unit, 'regen'); if (rg) heal += 3 * rg.value;
  if (dmg) { unit.hp = Math.max(0, unit.hp - dmg); }
  if (heal) { unit.hp = Math.min(unit.maxHp, unit.hp + heal); }
  return { dmg, heal };
}

// ==================== 战斗初始化 ====================
function battleStart(roomId, cfg) {
  const rid = String(roomId);
  const players = (cfg.players || []).map(p => ({
    sid: p.sid, name: p.name, career: p.career, role: p.role,
    hp: p.hp, maxHp: p.maxHp, san: p.san,
    physAtk: p.physAtk, magAtk: p.magAtk, physDef: p.physDef, magDef: p.magDef,
    pierce: p.pierce, blockBonus: p.blockBonus, shieldBase: p.shieldBase,
    dex: p.dex || 20, energyDice: p.energyDice || '3D6',
    weapon: p.weapon || null, skills: p.skills || {},
    passives: p.passives || (p.passive ? [{ trigger: p.passive.trigger || 'onTurnStart', effect: p.passive.effect }] : []),
    resource: p.resource || { id: '能量', type: 'active', value: 0, max: 10 },
    resourceRule: p.resourceRule || {},
    resourceSkill: p.resourceSkill || null,
    ap: 0, block: 0, statuses: [], acted: false, dead: false, skillCds: {},
    offline: !!p.offline,   // ★ 改进④：离线标记（轮到时自动跳过，防卡死）
    // ★ 职业特殊机制（battle_roles.passive：武士架势条 / 百夫长五段战姿）+ 累积器 + 招架/连击标记
    mechanic: p.mechanic || null,
    _acc: (() => {
      const m = p.mechanic || {}; const acc = {};
      if (m.id === 'stance' && m.trigger && m.trigger.threshold) acc.stance = { count: 0, threshold: m.trigger.threshold };
      if (m.id === 'five_stance' && m.trigger) acc.combo = { count: 0, threshold: (m.trigger.maxCombo || 5) };
      return acc;
    })(),
    _parry: false, _combo: 0
  }));
  const monsters = (cfg.monsters || []).map((m, i) => {
    const tpl = MONSTERS[m.type] || {};
    return {
      type: m.type, name: m.name || tpl.name || '未知怪物',
      hp: (tpl.hp != null) ? tpl.hp : (m.hp != null ? m.hp : 20),
      maxHp: (tpl.hp != null) ? tpl.hp : (m.maxHp != null ? m.maxHp : 20),
      dex: tpl.dex || 15, physDef: tpl.def || 0, magDef: tpl.magDef || 0,
      intents: (m.intents && m.intents.length) ? m.intents : (tpl.intents || []),
      intentIdx: 0, charging: null, block: 0, statuses: [], dead: false, idx: i
    };
  });
  // 玩家按敏捷降序
  players.sort((a, b) => (b.dex || 0) - (a.dex || 0));
  const battle = {
    turn: 1, phase: 'player', playerOrder: players.map(p => p.sid),
    playerIdx: 0, waitingFor: '', ap: 0, apDice: '',
    players, monsters, over: false, winner: null,
    monsterIdx: 0, intents: [], statusBroadcast: null
  };
  battle.roomId = rid;
  rooms.set(rid, battle);
  // 战斗开始被动 onBattleStart + 意图初始化
  players.forEach(p => triggerPassives(p, 'onBattleStart'));
  refreshIntents(battle);
  // ★ 事件：战斗开始（供 buff 注入/成就/记录系统订阅）
  eventBus.emit(EVENTS.BATTLE_START, { actor: rid, value: 1, data: { units: players.length, monsters: monsters.length } });
  return { units: players.length, monsters: monsters.length };
}

function refreshIntents(b) {
  b.intents = b.monsters.map(m => {
    const i = m.intents[Math.min(m.intentIdx, Math.max(0, m.intents.length - 1))] || { move: 'attack', label: '攻击', dmgBase: 3 };
    // ★ 组合意图：moves 数组（可同时攻击+上buff/上debuff），无 moves 时兼容单动作
    const moves = (Array.isArray(i.moves) && i.moves.length) ? i.moves : [i];
    return {
      type: m.type, name: m.name, idx: m.idx,
      move: moves[0].move, label: moves[0].label,
      moves: moves.map(x => ({ move: x.move, label: x.label, ...intentDisplay(x, m) }))
    };
  });
}

// 意图展示（预估数值，供前端气泡）
function intentDisplay(intent, mon) {
  const atk = (mon.physAtk != null) ? mon.physAtk : 8;
  const d = intent;
  const out = {};
  if (d.move === 'attack') {
    out.dmg = Math.max(1, Math.round((d.dmgBase || 3) + atk * (d.ratio || 0.3)));
    if (d.hitAll) out.hitAll = true;
  } else if (d.move === 'block') { out.block = d.block || 0; }
  else if (d.move === 'charge') { out.dmg = Math.max(1, Math.round((d.chargeDmg || 10) + atk * (d.ratio || 0.5))); out.charge = true; }
  else if (d.move === 'buff') { out.buff = d.self ? ((STATUS_LABEL[d.self.id] || d.self.id) + (d.self.value || 1)) : ''; }
  else if (d.move === 'debuff') { out.debuff = d.effect ? ((STATUS_LABEL[d.effect.id] || d.effect.id) + (d.effect.value || 1)) : ''; }
  else if (d.move === 'summon') { out.summon = d.summon || ''; }
  return out;
}

// ==================== 当前行动者（尖塔式：全队共享回合、自由行动） ====================
function battleCurrent(roomId) {
  const b = getRoom(roomId);
  if (!b || b.over) return { over: true, started: !!b };
  if (b.phase === 'monster') {
    return { over: false, type: 'monster', status: battleStatus(roomId) };
  }
  // ★ 尖塔式全队回合：回合首次进入玩家回合 → 为所有存活玩家掷 AP（各自能量骰）+ 清格挡 + 触发回合开始被动
  if (!b._teamApRolled) {
    b._teamApRolled = true;
    b.players.forEach(p => {
      if (p.dead) return;
      // 防御：HP≤0 未标记阵亡 → 补标记（防死循环）
      if (p.hp <= 0 && !p.dead) p.dead = true;
      p.block = 0; // 玩家格挡 T1 清零
      p.ap = rollDice(parseDice(p.energyDice), 6);
      // 回合开始被动 onTurnStart + 回资源
      triggerPassives(p, 'onTurnStart');
      if (p.resourceRule && p.resourceRule.gainOnTurnStart) {
        p.resource.value = Math.min(p.resource.max || 10, (p.resource.value || 0) + p.resourceRule.gainOnTurnStart);
      }
      // ★ 警官：正义值满自动「正义处决」（真实伤害，无视防御，攻击当前存活敌人）
      if (p.resourceRule && p.resourceRule.autoExecute && p.resource && (p.resource.value || 0) >= (p.resource.max || 10)) {
        const t = b.monsters.find(mn => !mn.dead);
        if (t) {
          const ed = Math.max(p.physAtk || 10, p.magAtk || 10);
          t.hp = Math.max(0, t.hp - ed);
          p.resource.value = 0;
          if (t.hp <= 0) t.dead = true;
          // 广播到日志（battleStatus 后续会反映 HP 变化）
          p._lastAuto = `⚖ 正义值满！触发【正义处决】无视防御造成 ${Math.round(ed)} 点伤害`;
        }
      }
    });
    b.waitingFor = '';
    b._lastActor = null;
    refreshIntents(b);
    // ★ 警官正义处决消息汇总（回合开始广播附带，供前端提示）
    const autoMsgs = b.players.filter(p => p._lastAuto).map(p => { const m = p._lastAuto; p._lastAuto = null; return m; });
    // ★ 广播队伍回合开始（battleHandler 转发 battleTurn teamTurn，无单一行动者）
    eventBus.emit(EVENTS.BATTLE_TURN, {
      actor: b.roomId, value: b.turn,
      data: { phase: 'player', teamTurn: true, status: battleStatus(roomId), autoMsgs: autoMsgs.length ? autoMsgs : undefined }
    });
  }
  // 所有存活玩家都已结束行动/撤退/阵亡 → 敌人回合
  const alive = b.players.filter(p => !p.dead);
  if (alive.length === 0 || alive.every(p => p.acted)) {
    b.phase = 'monster';
    b.monsterIdx = 0;
    b._teamApRolled = false; // 下次玩家回合重新掷 AP
    // 敌人回合开始：怪物格挡不清（T3 行动后清），重置怪物意图充电
    b.monsters.forEach(m => { m.charging = null; });
    return { over: false, type: 'monster', status: battleStatus(roomId) };
  }
  refreshIntents(b);
  // 队伍回合：返回第一个未行动玩家作为"建议高亮"，供前端显示/催促定位
  const next = alive.find(p => !p.acted);
  return {
    over: false, type: 'player', teamTurn: true,
    sid: next ? next.sid : '', ap: next ? next.ap : 0, apDice: next ? next.energyDice : '',
    intents: b.intents, status: battleStatus(roomId)
  };
}

// ==================== 玩家行动 ====================
function battlePlayerAct(roomId, sid, action) {
  const b = getRoom(roomId);
  if (!b || b.over) return { ok: false, msg: '战斗已结束' };
  if (b.phase !== 'player') return { ok: false, msg: '还没轮到玩家行动' };
  const p = b.players.find(x => x.sid === sid);
  if (!p || p.dead) return { ok: false, msg: '你已无法行动' };
  // ★ 尖塔式全队回合：不强制单一行动者；每位玩家每回合自由行动（仅限未结束行动的存活者）
  if (p.offline) return { ok: false, msg: '你已离线，无法行动' };
  if (p.acted) return { ok: false, msg: '你本回合已结束行动' };

  // ---- 结束回合（标记已行动，不推进固定顺序） ----
  if (action === 'end' || (action && action.action === 'end')) {
    p.acted = true;
    return { ok: true, end: true, msg: `${p.name} 结束了本回合行动`, status: battleStatus(roomId) };
  }
  // ---- 撤退 ----
  if (action === 'flee' || (action && action.action === 'flee')) {
    p.acted = true; p.dead = true;
    checkOver(b);
    return { ok: true, flee: true, msg: `${p.name} 撤退了`, status: battleStatus(roomId) };
  }

  // ---- 普攻 ----
  if (action === 'attack' || (action && action.action === 'attack')) {
    const apCost = (p.weapon && p.weapon.ap) ? p.weapon.ap : 2;
    if (p.ap < apCost) return { ok: false, msg: `能量不足（普攻需 ${apCost}）` };
    const tgt = pickTarget(b, action.target);
    if (!tgt) { b.over = true; b.winner = 'players'; return { ok: true, over: true, win: true, msg: '所有敌人已被消灭！' }; }
    const hits = (p.weapon && p.weapon.hits) ? p.weapon.hits : 1;
    const useWeapon = !!(p.weapon && p.weapon.baseDmg > 0);
    let totalDmg = 0;
    // ★ 多段武器修复：perHit = baseDmg/hits，每段用 perHit（原 useWeaponBase 会丢弃 perHit，总伤被 hits 倍放大）
    const perHit = Math.max(1, Math.round((useWeapon ? p.weapon.baseDmg : (p.physAtk || 0)) / hits));
    const msgs = [];
    // ★ 百夫长五段战姿：连击每段 +8%，满 5 段后本段 +50%（计数跨回合累积）
    const fiveStance = !!(p.mechanic && p.mechanic.id === 'five_stance');
    for (let h = 0; h < hits; h++) {
      let dmg = calcDamage(p, tgt, { base: perHit, ratio: 0, isTrue: false });
      // ★ 暴击判定：×1.5，触发暴击回资源（诡术小丑 gainOnCrit）
      if (rollCrit(p)) {
        dmg = Math.round(dmg * 1.5);
        msgs.push('暴击！');
        if (p.resourceRule && p.resourceRule.gainOnCrit) gainResource(p, p.resourceRule.gainOnCrit);
      }
      if (fiveStance) {
        p._combo = (p._combo || 0) + 1;
        if (p._combo >= 5) { p._combo = 0; dmg = Math.round(dmg * 1.5); msgs.push('五段战姿！本段 +50%'); }
        else dmg = Math.round(dmg * (1 + 0.08 * p._combo));
      }
      totalDmg += dmg;
      tgt.hp = Math.max(0, tgt.hp - dmg);
    }
    p.ap -= apCost;
    // ★ 事件：造成伤害（供吸血/装备词条/成就等系统订阅，替代硬编码调用链）
    eventBus.emit(EVENTS.BATTLE_DAMAGE, { actor: p.sid, value: totalDmg, data: { target: tgt.sid || tgt.type, kind: 'phys', hits, roomId: b.roomId } });
    // 战斗被动 onAttack（含吸血）+ 武器词条
    triggerPassives(p, 'onAttack', tgt, totalDmg);
    // 普攻回资源
    if (p.resourceRule && p.resourceRule.gainOnBasic) {
      p.resource.value = Math.min(p.resource.max || 10, (p.resource.value || 0) + p.resourceRule.gainOnBasic);
    }
    // 骑士盾击附格挡
    if (p.weapon && p.weapon.blockOnBasic) p.block += p.weapon.blockOnBasic;
    if (tgt.hp <= 0) {
      tgt.dead = true; triggerPassives(p, 'onKill'); msgs.push(`${tgt.name} 被消灭！`);
      // ★ 职业机制：击杀回资源（警官/侦探等 gainOnKill）
      if (p.resourceRule && p.resourceRule.gainOnKill) gainResource(p, p.resourceRule.gainOnKill);
      // ★ 事件：击杀（供掉落/成就系统订阅）
      eventBus.emit(EVENTS.BATTLE_DEATH, { actor: p.sid, value: 0, data: { target: tgt.sid || tgt.type, roomId: b.roomId } });
    }
    checkOver(b);
    const over = b.over;
    return {
      ok: true, dmg: totalDmg, hits, energy: p.ap, over,
      win: over ? b.winner === 'players' : undefined,
      msg: `${p.name} 造成 ${totalDmg} 点物理伤害，${tgt.name} 剩余 HP ${Math.max(0, tgt.hp)}`,
      status: battleStatus(roomId)
    };
  }

  // ---- 技能 ----
  if (action && action.action === 'skill') {
    const skillName = action.skillId || '';
    const skill = (p.skills || {})[skillName];
    if (!skill) return { ok: false, msg: '无此技能战斗配置' };
    // 技能 CD
    const cdKey = skillName;
    if (p.skillCds[cdKey] && p.skillCds[cdKey] > b.turn) {
      return { ok: false, msg: `技能冷却中（还需 ${p.skillCds[cdKey] - b.turn} 回合）` };
    }
    const apCost = skill.ap || 4;
    if (p.ap < apCost) return { ok: false, msg: `能量不足（技能需 ${apCost}）` };
    p.ap -= apCost;
    if (skill.cd) {
      p.skillCds[cdKey] = b.turn + skill.cd;
      // ★ 改进①：技能 CD 改用回合制定时调度器（到期 emit SKILL_CD_READY，替代纯硬编码回合号）
      timerScheduler.schedule(skill.cd, () => {
        if (p.skillCds[cdKey]) delete p.skillCds[cdKey];
        eventBus.emit(EVENTS.SKILL_CD_READY, { actor: p.sid, data: { skillName, roomId: b.roomId } });
      }, { type: 'skillCd', target: p.sid, data: { skillName, roomId: b.roomId } });
    }
    // 资源消耗
    if (p.resource && p.resource.type === 'active' && p.resourceRule && p.resourceRule.costPerSkill) {
      p.resource.value = Math.max(0, (p.resource.value || 0) - p.resourceRule.costPerSkill);
    }
    // ★ SAN 消耗（禁忌技能）→ SAN 归零进入疯狂
    if (skill.sanCost) {
      p.san = Math.max(0, (p.san || 0) - skill.sanCost);
      // ★ 改进①：SAN 变化事件（供恐惧/疯狂联动系统订阅）
      eventBus.emit(EVENTS.PLAYER_SAN_CHANGED, { actor: p.sid, value: -skill.sanCost, data: { san: p.san, cause: 'skill:' + skillName, roomId: b.roomId } });
    }
    const msgs = [];
    if ((p.san || 0) <= 0 && !getStatus(p, 'crazy')) { addStatus(p, 'crazy', 1, 99); msgs.push('你陷入疯狂！'); }
    const targets = skill.target === 'all' ? b.monsters.filter(m => !m.dead) : [pickTarget(b, action.target)];
    let totalDmg = 0;
    targets.forEach(tgt => {
      if (!tgt) return;
      if (skill.damage) {
        // ★ 技能多段 hits 循环：每段独立结算伤害 + 暴击判定（gainOnCrit 暴击回资源）
        const dHits = Math.max(1, skill.damage.hits || 1);
        for (let h = 0; h < dHits; h++) {
          let dmg = calcDamage(p, tgt, { base: skill.damage.base, ratio: skill.damage.ratio, scale: skill.damage.scale, isTrue: (skill.element === 'true') });
          if (rollCrit(p)) {
            dmg = Math.round(dmg * 1.5);
            msgs.push('暴击！');
            if (p.resourceRule && p.resourceRule.gainOnCrit) gainResource(p, p.resourceRule.gainOnCrit);
          }
          tgt.hp = Math.max(0, tgt.hp - dmg);
          totalDmg += dmg;
        }
      }
      (skill.effects || []).forEach(e => addStatus(tgt, e.id, e.value, e.turns));
      if (tgt.hp <= 0) {
        tgt.dead = true; triggerPassives(p, 'onKill'); msgs.push(`${tgt.name} 被消灭！`);
        // ★ 职业机制：击杀回资源
        if (p.resourceRule && p.resourceRule.gainOnKill) gainResource(p, p.resourceRule.gainOnKill);
      }
    });
    // 治疗/格挡
    if (skill.heal) {
      const heal = Math.round((skill.heal.base || 0) + (p.magAtk || 0) * (skill.heal.ratio || 0.4));
      p.hp = Math.min(p.maxHp, p.hp + heal);
      msgs.push(`回复 ${heal} HP`);
      // ★ 改进①：治疗事件（供吸血/装备词条/记录系统订阅）
      eventBus.emit(EVENTS.BATTLE_HEAL, { actor: p.sid, value: heal, data: { target: p.sid, roomId: b.roomId } });
      eventBus.emit(EVENTS.PLAYER_HP_CHANGED, { actor: p.sid, value: heal, data: { hp: p.hp, maxHp: p.maxHp, cause: 'skill:' + skillName, roomId: b.roomId } });
    }
    if (skill.block) p.block += skill.block;
    triggerPassives(p, 'onAttack', targets[0], totalDmg);
    checkOver(b);
    const over = b.over;
    return {
      ok: true, dmg: totalDmg, skill: skillName, energy: p.ap, over,
      win: over ? b.winner === 'players' : undefined,
      msg: `${p.name} 释放【${skillName}】${totalDmg ? `造成 ${totalDmg} 点伤害` : ''}${msgs.length ? '；' + msgs.join('；') : ''}`,
      status: battleStatus(roomId)
    };
  }

  // ---- 消耗品 ----
  if (action && action.action === 'item') {
    const apCost = (action.apCost != null) ? action.apCost : 0;
    if (p.ap < apCost) return { ok: false, msg: `能量不足（消耗品需 ${apCost}）` };
    p.ap -= apCost;
    // handler 已用 EffectEngine 结算并传 hpDelta/shield
    if (action.hpDelta) { p.hp = Math.min(p.maxHp, p.hp + action.hpDelta); }
    if (action.sanDelta && p.san != null) { p.san = Math.max(0, Math.min(p.sanMax || 100, p.san + action.sanDelta)); }
    if (action.shield) { p.block += action.shield; }
    (action.effects || []).forEach(e => addStatus(p, e.id, e.value, e.turns));
    return {
      ok: true, msg: `${p.name} 使用消耗品${action.msg ? '：' + action.msg : ''}`,
      energy: p.ap, over: false, status: battleStatus(roomId)
    };
  }

  // ---- 特殊资源技能（不耗 AP，消耗特殊资源：招架/炁盾/战吼…） ----
  if (action && action.action === 'resourceSkill') {
    const rs = p.resourceSkill;
    if (!rs) return { ok: false, msg: '本职业无特殊技能' };
    const cost = rs.cost || 0;
    if (!p.resource || (p.resource.value || 0) < cost) {
      return { ok: false, msg: `${rs.name} 资源不足（需 ${cost} ${p.resource ? p.resource.id : ''}）` };
    }
    p.resource.value = Math.max(0, (p.resource.value || 0) - cost);
    const eff = rs.effect || {};
    const msgs = [];
    if (eff.kind === 'block') { p.block += eff.value || 0; msgs.push(`获得 ${eff.value || 0} 格挡`); }
    else if (eff.kind === 'hp') {
      p.hp = Math.min(p.maxHp, p.hp + (eff.value || 0)); msgs.push(`回复 ${eff.value || 0} HP`);
      // ★ 改进①：治疗事件
      eventBus.emit(EVENTS.BATTLE_HEAL, { actor: p.sid, value: eff.value || 0, data: { target: p.sid, roomId: b.roomId } });
      eventBus.emit(EVENTS.PLAYER_HP_CHANGED, { actor: p.sid, value: eff.value || 0, data: { hp: p.hp, maxHp: p.maxHp, cause: 'resourceSkill:' + (rs.name || ''), roomId: b.roomId } });
    }
    else if (eff.kind === 'buff' && eff.id) { addStatus(p, eff.id, eff.value || 1, eff.turns || 1); msgs.push(`获得【${STATUS_LABEL[eff.id] || eff.id}】`); }
    else if (eff.kind === 'debuff' && eff.id) {
      const t = pickTarget(b, action.target);
      if (t) { addStatus(t, eff.id, eff.value || 1, eff.turns || 1); msgs.push(`对【${t.name}】施加【${STATUS_LABEL[eff.id] || eff.id}】`); }
      else msgs.push('没有可作用的目标');
    }
    return {
      ok: true, msg: `${p.name} 使用【${rs.name}】${msgs.length ? '：' + msgs.join('；') : ''}`,
      energy: p.ap, over: false, status: battleStatus(roomId)
    };
  }

  // ---- 装填（枪手：消耗1AP，触发装填回资源 gainOnReload） ----
  if (action && action.action === 'reload') {
    const apCost = 1;
    if (p.ap < apCost) return { ok: false, msg: `能量不足（装填需 ${apCost} AP）` };
    p.ap -= apCost;
    let got = 0;
    if (p.resourceRule && p.resourceRule.gainOnReload) { gainResource(p, p.resourceRule.gainOnReload); got = p.resourceRule.gainOnReload; }
    return { ok: true, msg: `${p.name} 装填弹药${got ? `，获得 ${got} 子弹` : ''}`, energy: p.ap, over: false, status: battleStatus(roomId) };
  }
  // ---- 标记弱点（侦探：消耗2探知，目标易伤+1） ----
  if (action && action.action === 'markWeak') {
    const cost = (p.resourceRule && p.resourceRule.markWeak) ? 2 : 0;
    if ((p.resource && p.resource.value || 0) < cost) return { ok: false, msg: `探知值不足（标记弱点需 ${cost}）` };
    p.resource.value = Math.max(0, (p.resource.value || 0) - cost);
    const t = pickTarget(b, action.target);
    if (!t) return { ok: false, msg: '没有可标记的目标' };
    addStatus(t, 'vulnerable', 1, 2);
    return { ok: true, msg: `${p.name} 标记了【${t.name}】的弱点（易伤+1，2回合）`, energy: p.ap, over: false, status: battleStatus(roomId) };
  }

  // ---- 换装（战斗中更换装备，扣 AP） ----
  if (action && action.action === 'equip') {
    const cost = action.cost != null ? action.cost : (action.slot === 'weapon' ? 5 : 3);
    if (p.ap < cost) return { ok: false, msg: `能量不足（换装需 ${cost} AP）` };
    p.ap -= cost;
    return { ok: true, msg: `${p.name} 更换了装备（消耗 ${cost} AP）`, energy: p.ap, over: false, status: battleStatus(roomId) };
  }

  return { ok: false, msg: '未知行动' };
}

// ---- ★ 职业特殊机制工具（资源获取 / 累积型被动 / 暴击 / 闪避） ----
function gainResource(p, amount) {
  if (!p || !p.resource || !amount) return;
  p.resource.value = Math.min(p.resource.max || 10, (p.resource.value || 0) + amount);
}
// ★ 暴击判定：基于 DEX 的暴击率（DEX 20→20%，DEX 80→50%，上限 50%），暴击伤害 ×1.5
function rollCrit(p) {
  const cr = Math.min(0.5, Math.max(0.05, 0.1 + ((p.dex || 20) - 20) * 0.005));
  return Math.random() < cr;
}
// ★ 闪避判定：基于 DEX 的闪避率（DEX 20→13%，DEX 80→37%，上限 50%）
function rollDodge(t) {
  const dr = Math.min(0.5, Math.max(0.02, 0.05 + ((t.dex || 20) - 20) * 0.004));
  return Math.random() < dr;
}
// 累积步进：累积器存在则 +step，达阈值返回 true（触发效果并清零）
function accPassive(p, key, step) {
  const a = p._acc || {};
  const cur = a[key];
  if (!cur || !cur.threshold) return false;
  cur.count = (cur.count || 0) + (step || 1);
  if (cur.count >= cur.threshold) { cur.count = 0; return true; }
  return false;
}
// 武士架势条：受击/闪避累积，满阈值 → 下一次攻击被招架抵消
function onStanceAccum(p, step) {
  if (accPassive(p, 'stance', step)) { p._parry = true; }
}

// ★ 战斗被动词条引擎：触发当前 trigger 的所有被动（职业被动 + 装备词条）
function triggerPassives(p, trigger, target, lastDmg) {
  (p.passives || []).forEach(pv => {
    if (!pv || pv.trigger !== trigger) return;
    applyPassiveEffect(p, pv.effect || pv, target, lastDmg);
  });
}
function applyPassiveEffect(p, e, target, lastDmg) {
  if (!e) return;
  // 职业被动简写：{ block, lifesteal, dexUp, strength }
  if (e.block) p.block += e.block;
  if (e.dexUp) addStatus(p, 'dexUp', 1, 2);
  if (e.strength) addStatus(p, 'strength', e.value || 1, 3);
  // 标准词条：{ kind, stat, value, turns, target }
  if (e.kind === 'block') p.block += e.value || 0;
  if (e.kind === 'hp') p.hp = Math.min(p.maxHp, p.hp + (e.value || 0));
  if (e.kind === 'buff' && e.stat) addStatus(p, e.stat, e.value || 1, e.turns || 1);
  if (e.kind === 'debuff' && e.stat && target) addStatus(target, e.stat, e.value || 1, e.turns || 1);
  if (e.kind === 'stat' && e.duration) addStatus(p, e.stat, e.value || 1, e.duration);
  // 吸血（onAttack，按本次伤害比例）
  if (e.lifesteal && lastDmg) p.hp = Math.min(p.maxHp, p.hp + Math.round(lastDmg * e.lifesteal / 100));
}

/** 战斗内换装后：用 handler 重算的快照更新玩家单位 */
function battleUpdatePlayer(roomId, sid, snap) {
  const b = getRoom(roomId);
  if (!b) return false;
  const p = b.players.find(x => x.sid === sid);
  if (!p) return false;
  if (snap) {
    ['physAtk', 'magAtk', 'physDef', 'magDef', 'pierce', 'blockBonus', 'shieldBase', 'dex', 'maxHp'].forEach(k => { if (snap[k] != null) p[k] = snap[k]; });
    if (snap.hp != null) p.hp = Math.min(snap.hp, snap.maxHp || p.maxHp);
    if (snap.weapon) p.weapon = snap.weapon;
    if (snap.passives) p.passives = snap.passives;
  }
  return true;
}

/**
 * ★ 改进④：玩家断线/刷新时标记战斗单位离线。
 * 若该玩家恰为当前行动者 → 自动结束其回合（交给下一成员），防止全队回合卡死。
 * @returns {{ok:boolean, advanced:boolean}}
 */
function battlePlayerOffline(roomId, sid) {
  const b = getRoom(roomId);
  if (!b || b.over) return { ok: false, advanced: false };
  const p = b.players.find(x => x.sid === sid);
  if (!p) return { ok: false, advanced: false };
  p.offline = true;
  let advanced = false;
  // ★ 尖塔式：离线玩家直接视为已行动（不阻塞队伍回合），等待其刷新恢复后重新参战
  if (b.phase === 'player' && !p.acted) {
    p.acted = true;
    advanced = true;
  }
  return { ok: true, advanced };
}

/**
 * ★ 战斗状态导出（持久化用）：活动中的战斗序列化为可恢复 JSON。
 * 若战斗已结束 / 不存在返回 null（endBattle 已 battleReset，保存时自然为 null）。
 */
function battleExport(roomId) {
  const b = getRoom(roomId);
  if (!b || b.over) return null;
  try {
    return JSON.parse(JSON.stringify({
      turn: b.turn, phase: b.phase, playerOrder: b.playerOrder, playerIdx: b.playerIdx,
      waitingFor: b.waitingFor, ap: b.ap, apDice: b.apDice,
      players: b.players, monsters: b.monsters, over: b.over, winner: b.winner,
      monsterIdx: b.monsterIdx, intents: b.intents,
      _lastActor: b._lastActor, _endEmitted: !!b._endEmitted,
      _teamApRolled: !!b._teamApRolled
    }));
  } catch (e) {
    return null;
  }
}

/** ★ 战斗状态恢复（持久化还原）：还原活动中的战斗 */
function battleRestore(roomId, data) {
  if (!data || !Array.isArray(data.players) || !Array.isArray(data.monsters)) return false;
  const rid = String(roomId);
  rooms.set(rid, Object.assign({}, data, { roomId: rid }));
  return true;
}

/**
 * ★ 断线/刷新后 socket 重连：将战斗单位 sid 从旧 socketId 重映射到新 socketId，
 *   并恢复在线状态（保证新连接可正常行动 / 不被离线跳过）。
 */
function battleRemapSid(roomId, oldSid, newSid) {
  if (!oldSid || !newSid || oldSid === newSid) return false;
  const b = getRoom(roomId);
  if (!b) return false;
  let changed = false;
  b.players.forEach(p => { if (p.sid === oldSid) { p.sid = newSid; p.offline = false; changed = true; } });
  if (b.waitingFor === oldSid) { b.waitingFor = newSid; changed = true; }
  if (b._lastActor === oldSid) { b._lastActor = newSid; changed = true; }
  const idx = b.playerOrder.indexOf(oldSid);
  if (idx >= 0) { b.playerOrder[idx] = newSid; changed = true; }
  return changed;
}

/**
 * ★ 是否仍有在线且存活的玩家（断线时判定是否驱动战斗：全员离线 → 暂停等待恢复）
 */
function battleHasOnlinePlayer(roomId) {
  const b = getRoom(roomId);
  if (!b) return false;
  return b.players.some(p => !p.dead && !p.offline);
}

// ==================== 怪物回合 ====================
function battleMonsterAct(roomId) {
  const b = getRoom(roomId);
  if (!b || b.over) return { over: true };
  if (b.phase !== 'monster') {
    // 兼容：强制进入怪物回合（正常情况下由 battleCurrent 切换）
  }
  // 逐个怪物行动；最后一个行动完后立即结束怪物回合
  while (b.monsterIdx < b.monsters.length) {
    const m = b.monsters[b.monsterIdx];
    b.monsterIdx++;
    if (m.dead) continue;
    const res = monsterAct(b, m);
    const over = checkOver(b);
    if (b.monsterIdx >= b.monsters.length || over) {
      if (!over) endMonsterPhase(b);
      return { ...res, over: b.over, next: b.over ? undefined : 'player', status: battleStatus(roomId) };
    }
    return { ...res, over, status: battleStatus(roomId) };
  }
  // 无存活怪物
  if (!b.over) endMonsterPhase(b);
  return { over: b.over, next: b.over ? undefined : 'player', status: battleStatus(roomId) };
}

function monsterAct(b, m) {
  const intent = m.intents[Math.min(m.intentIdx, Math.max(0, m.intents.length - 1))] || { move: 'attack', label: '攻击', dmgBase: 3 };
  m.intentIdx = (m.intentIdx + 1) % Math.max(1, m.intents.length);
  // ★ 组合意图：一回合可同时执行多个动作（攻击+增益/减益）
  const moves = (Array.isArray(intent.moves) && intent.moves.length) ? intent.moves : [intent];
  const msgParts = [];
  let dmg = 0, block = 0;
  moves.forEach(mv => {
    const r = execMonsterMove(b, m, mv);
    if (r) { dmg += r.dmg || 0; block += r.block || 0; if (r.msgs) msgParts.push(...r.msgs); }
  });
  return { type: 'monster', dmg, block, msg: msgParts.join('；'), target: 'players' };
}

/** 执行单个怪物意图动作（attack/block/charge/buff/debuff/summon） */
function execMonsterMove(b, m, intent) {
  const msgParts = [];
  let dmg = 0, block = 0;
  if (intent.move === 'attack') {
    // ★ 蓄力强攻：charge 意图后，下次 attack 用蓄力伤害
    const strong = m.chargedIntent;
    const base = strong ? strong.dmgBase : (intent.dmgBase || 3);
    const ratio = strong ? strong.ratio : (intent.ratio || 0.3);
    m.chargedIntent = null;
    const targets = intent.hitAll ? b.players.filter(p => !p.dead) : [b.players.find(p => !p.dead)];
    targets.forEach(t => {
      if (!t) return;
      const d = calcDamage(m, t, { base, ratio, scale: 'physAtk' });
      let dealt = d;
      let dodged = false;
      // ★ 闪避判定：基于 DEX 躲开本次攻击（伤害归 0，触发 onDodge 累积，不触发受击回资源）
      if (rollDodge(t)) {
        dealt = 0; dodged = true;
        msgParts.push(`${t.name} 闪避了攻击！`);
        triggerPassives(t, 'onDodge');
        // 武士架势条：闪避 +2
        if (t.mechanic && t.mechanic.id === 'stance') onStanceAccum(t, (t.mechanic.trigger && t.mechanic.trigger.onDodge) || 2);
      }
      // ★ 武士招架：架势条满触发，抵消本次攻击（伤害归 0）
      else if (t._parry) { t._parry = false; dealt = 0; msgParts.push(`${t.name} 用【招架】抵消了攻击！`); }
      t.hp = Math.max(0, t.hp - dealt);
      // ★ 修复：玩家 HP≤0 → 标记阵亡（checkOver 依赖 dead 判定胜负，防死循环）
      if (t.hp <= 0) t.dead = true;
      dmg += dealt;
      // ★ 改进①：玩家受击 HP 变化事件（供恐惧/记录/联动系统订阅）
      eventBus.emit(EVENTS.PLAYER_HP_CHANGED, { actor: t.sid, value: -dealt, data: { hp: t.hp, maxHp: t.maxHp, cause: 'battle:' + m.type, roomId: b.roomId } });
      if (!dodged) {
        // 玩家受击 → 触发 onHurt 被动词条
        triggerPassives(t, 'onHurt');
        // ★ 职业机制：受击回资源（角斗士/骑士 gainOnHurt）+ 武士架势条受击累积
        if (t.resourceRule && t.resourceRule.gainOnHurt) gainResource(t, t.resourceRule.gainOnHurt);
        if (t.mechanic && t.mechanic.id === 'stance') onStanceAccum(t, (t.mechanic.trigger && t.mechanic.trigger.onHurt) || 1);
      }
      msgParts.push(`${t.name} ${dodged ? '毫发无伤' : ('受到 ' + dealt + ' 点伤害' + (strong ? '（蓄力）' : ''))}`);
    });
  } else if (intent.move === 'block') {
    m.block += intent.block || 0;
    block += intent.block || 0;
    msgParts.push(`获得格挡 ${intent.block || 0}`);
  } else if (intent.move === 'charge') {
    m.charging = { dmgBase: intent.chargeDmg || 10, ratio: intent.ratio || 0.5 };
    msgParts.push('蓄力中…');
  } else if (intent.move === 'buff') {
    if (intent.self) addStatus(m, intent.self.id, intent.self.value, intent.self.turns || 1);
    if (intent.regen) addStatus(m, intent.regen.id, intent.regen.value, intent.regen.turns || 1);
    msgParts.push('强化自身');
  } else if (intent.move === 'debuff') {
    const targets = intent.target === 'all' ? b.players.filter(p => !p.dead) : [b.players.find(p => !p.dead)];
    targets.forEach(t => {
      if (!t) return;
      if (intent.effect) addStatus(t, intent.effect.id, intent.effect.value, intent.effect.turns || 1);
    });
    msgParts.push('施加负面状态');
  } else if (intent.move === 'summon') {
    // ★ 召唤仆从（米·戈等）：把新怪物加入战场
    const st = MONSTERS[intent.summon] || MONSTERS['formless'] || {};
    const nm = (st.name || '无形之子') + '（仆从）';
    b.monsters.push({
      type: intent.summon || 'formless', name: nm,
      hp: st.hp || 30, maxHp: st.hp || 30, dex: st.dex || 15,
      physDef: st.def || 0, magDef: st.magDef || 0,
      intents: (st.intents || []).map(x => ({ ...x })), intentIdx: 0,
      charging: null, block: 0, statuses: [], dead: false, idx: b.monsters.length
    });
    msgParts.push(`呼唤出仆从（${nm}）`);
  }
  return { dmg, block, msgs: msgParts };
}

function endMonsterPhase(b) {
  // 玩家持伤（T3 后）
  b.players.forEach(p => { if (!p.dead) applyDot(p); });
  // 怪物格挡清零（T3）
  b.monsters.forEach(m => { m.block = 0; });
  // 状态衰减（T4）
  b.players.forEach(p => decayStatuses(p));
  b.monsters.forEach(m => decayStatuses(m));
  // 怪物意图：蓄力强攻结算（下回合 attack 时用 charging）
  // 回玩家回合
  b.turn++;
  // ★ 回合推进：驱动事件调度器（buff 持续/技能CD/副本倒计时到期）+ 广播回合事件
  if (b.roomId) {
    timerScheduler.tickTurn(b.roomId);
    eventBus.emit(EVENTS.BATTLE_TURN, { actor: b.roomId, value: b.turn, data: { phase: 'player' } });
    eventBus.emit(EVENTS.TURN_ADVANCED, { actor: b.roomId, value: b.turn });
  }
  b.phase = 'player';
  b.playerIdx = 0;
  b.waitingFor = '';
  b._lastActor = null;   // ★ 改进③：新回合重置当前行动者标记（确保 BATTLE_TURN 重新广播）
  b._teamApRolled = false; // ★ 尖塔式：新队伍回合待 battleCurrent 重新掷 AP + 广播
  b.monsters.forEach(m => { m.chargedIntent = m.charging; m.charging = null; });
  b.players.forEach(p => { p.acted = false; });
  checkOver(b);
}

function pickTarget(b, idx) {
  if (idx != null) {
    const m = b.monsters[idx];
    if (m && !m.dead) return m;
  }
  return b.monsters.find(m => !m.dead) || null;
}

function checkOver(b) {
  if (b.monsters.every(m => m.dead)) { b.over = true; b.winner = 'players'; }
  else if (b.players.every(p => p.dead)) { b.over = true; b.winner = 'monsters'; }
  if (b.over && !b._endEmitted) {
    b._endEmitted = true;
    // ★ 事件：战斗结束（win: 'players'|'monsters'，供结算/掉落/成就系统订阅）
    eventBus.emit(EVENTS.BATTLE_END, { actor: b.roomId || null, value: b.winner, data: { winner: b.winner, turn: b.turn } });
  }
  return b.over;
}

// ==================== 状态 ====================
function battleStatus(roomId) {
  const b = getRoom(roomId);
  if (!b) return { over: true, started: false };
  return {
    over: b.over, started: true, turn: b.turn, phase: b.phase,
    units: b.players.map(p => ({
      sid: p.sid, name: p.name, career: p.career, hp: p.hp, maxHp: p.maxHp, san: p.san,
      block: p.block, ap: p.ap, energyDice: p.energyDice, dead: p.dead,
      acted: p.acted, offline: p.offline,   // ★ 队友回合状态（已行动/离线，供队伍信息栏显示）
      resource: p.resource ? { id: p.resource.id, value: p.resource.value, max: p.resource.max } : null,
      resourceCost: (p.resourceRule && p.resourceRule.costPerSkill) || 0,
      resourceSkill: p.resourceSkill ? { name: p.resourceSkill.name, cost: p.resourceSkill.cost, desc: p.resourceSkill.desc, effect: p.resourceSkill.effect } : null,
      // ★ 职业机制进度（供前端架势条/战姿进度条）：累积器计数 + 招架标记 + 连击段数
      mechanic: p.mechanic ? {
        id: p.mechanic.id, label: p.mechanic.label,
        acc: p._acc || {}, parry: !!p._parry, combo: p._combo || 0
      } : null,
      // ★ 特殊行动（供前端装填/标记弱点按钮）：reload（枪手）/ markWeak（侦探）/ null
      specialAction: p.resourceRule && p.resourceRule.gainOnReload ? 'reload'
        : (p.resourceRule && p.resourceRule.markWeak ? 'markWeak' : null),
      statuses: (p.statuses || []).map(s => ({ ...s }))
    })),
    monsters: b.monsters.map(m => {
      const it = m.intents[Math.min(m.intentIdx, Math.max(0, m.intents.length - 1))] || { move: 'attack', label: '攻击', dmgBase: 3 };
      const imoves = (Array.isArray(it.moves) && it.moves.length) ? it.moves : [it];
      return {
        type: m.type, name: m.name, idx: m.idx, hp: Math.max(0, m.hp), maxHp: m.maxHp,
        block: m.block, dead: m.dead,
        intentIdx: m.intentIdx, charging: !!m.charging,
        intent: {
          move: it.move, label: it.label,
          moves: imoves.map(x => ({ move: x.move, label: x.label, ...intentDisplay(x, m) }))
        },
        statuses: (m.statuses || []).map(s => ({ ...s }))
      };
    }),
    intents: b.intents || [],
    waitingFor: b.waitingFor, ap: b.ap, apDice: b.apDice
  };
}

function battleIntent(roomId) {
  const b = getRoom(roomId);
  if (!b) return { intents: [] };
  refreshIntents(b);
  return { intents: b.intents };
}

function battleReset(roomId) { rooms.delete(String(roomId)); return true; }

module.exports = {
  battleStart, battleCurrent, battlePlayerAct, battleMonsterAct,
  battleStatus, battleIntent, battleReset, battleUpdatePlayer, battlePlayerOffline,
  battleExport, battleRestore, battleRemapSid, battleHasOnlinePlayer,
  STATUS_LABEL
};
