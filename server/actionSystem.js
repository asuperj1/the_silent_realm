/**
 * actionSystem.js — 战斗行为系统 1.0 引擎桥接层
 *
 * 优先加载 C++ 原生模块（native/build/Release/battle_engine.node，高性能状态机）；
 * 若原生模块不可用，降级到 JS 实现（同接口）。
 *
 * 接口统一（roomId 为房间 id，如 'game_room_xxx'）：
 *   exploreStart / explorePlayerDice / exploreConsume / exploreEndPlayer / exploreAllEnded
 *   battleStart / battleCurrent / battlePlayerAct / battleMonsterAct / battleStatus / roomReset
 */
const path = require('path');

let engine = null;
try {
  engine = require(path.join(__dirname, '..', 'native', 'build', 'Release', 'battle_engine.node'));
  // console.log('[actionSystem] 使用 C++ 引擎');
} catch (e) {
  engine = createJsFallback();
  // console.log('[actionSystem] 使用 JS fallback 引擎');
}

// ==================== JS fallback（与 C++ 同接口） ====================
function createJsFallback() {
  const rooms = new Map(); // roomId -> { explore, battle }
  const getRoom = (rid) => {
    if (!rooms.has(rid)) rooms.set(rid, { explore: { active: false, round: 0, players: new Map() }, battle: null });
    return rooms.get(rid);
  };
  const rollDice = (count, sides = 6) => { let s = 0; for (let i = 0; i < count; i++) s += Math.floor(Math.random() * sides) + 1; return s; };
  // ★ 回合值改由 KP 动态判定（【回合值】X），此处固定消耗归零，只保留操作次数管理
  const costFor = () => 0;

  return {
    exploreStart(roomId) {
      const r = getRoom(String(roomId));
      r.explore.active = true;
      r.explore.round += 1;
      r.explore.players.clear();
      return { round: r.explore.round };
    },
    explorePlayerDice(roomId, sid) {
      const r = getRoom(String(roomId));
      const st = r.explore.players;
      if (!st.has(sid)) st.set(sid, { dice: rollDice(1, 6), used: 0, cost: 0, ended: false });
      const p = st.get(sid);
      return { dice: p.dice, used: p.used, cost: p.cost, ended: p.ended, round: r.explore.round };
    },
    exploreConsume(roomId, sid, costType) {
      const r = getRoom(String(roomId));
      const st = r.explore.players;
      if (!st.has(sid)) st.set(sid, { dice: rollDice(1, 6), used: 0, cost: 0, ended: false });
      const p = st.get(sid);
      if (p.ended || p.used >= p.dice) return { dice: p.dice, used: p.used, skipped: true, newCost: p.cost, forcedEnd: false, ended: p.ended, actionCost: 0, reason: p.ended ? 'ended' : 'limit' };
      const actionCost = costFor(costType);
      p.cost = Math.round((p.cost + actionCost) * 100) / 100;
      p.used += 1;
      const forcedEnd = p.cost >= 1.5;
      if (forcedEnd) p.ended = true;
      return { dice: p.dice, used: p.used, actionCost, newCost: p.cost, forcedEnd, ended: p.ended, skipped: false };
    },
    exploreEndPlayer(roomId, sid) {
      const r = getRoom(String(roomId));
      const p = r.explore.players.get(sid);
      if (!p) return { ok: false };
      p.ended = true;
      return { ok: true, dice: p.dice, cost: p.cost };
    },
    exploreAllEnded(roomId, sids) {
      const r = getRoom(String(roomId));
      if (!r.explore.active || !sids.length) return { allEnded: false };
      return { allEnded: sids.every(s => { const p = r.explore.players.get(s); return p && p.ended; }) };
    },
    battleStart(roomId, players, monsters) {
      const r = getRoom(String(roomId));
      const units = players.map(p => ({ ...p, energy: 0, dead: false }));
      const mons = monsters.map((m, i) => ({ ...m, instanceId: i, dead: false }));
      const monDex = Math.max(...mons.map(m => m.dex || 15));
      const maxPlayerDex = Math.max(...units.map(u => u.dex || 20));
      const cycle = [];
      units.slice().sort((a, b) => (b.dex || 0) - (a.dex || 0)).forEach(u => {
        const rounds = Math.max(1, Math.round((u.dex || 20) / monDex));
        for (let i = 0; i < rounds; i++) cycle.push({ type: 'player', sid: u.sid });
      });
      const monRounds = Math.max(1, Math.round(monDex / maxPlayerDex));
      for (let i = 0; i < monRounds; i++) cycle.push({ type: 'monster', idx: 0 });
      r.battle = { units, monsters: mons, cycle, cycleIndex: 0, waitingFor: '', energy: 0, energyDice: '', over: false, started: true };
      return { units: units.length, monsters: mons.length, cycleLen: cycle.length };
    },
    battleCurrent(roomId) {
      const r = getRoom(String(roomId));
      const b = r.battle;
      if (!b || !b.started || b.over) return { over: true, msg: 'no battle' };
      if (b.waitingFor) {
        const u = b.units.find(x => x.sid === b.waitingFor);
        if (u && !u.dead && b.energy >= 2) return { over: false, type: 'player', sid: b.waitingFor, energy: b.energy, energyDice: b.energyDice };
        b.waitingFor = '';
        b.cycleIndex++;
      }
      let guard = 0;
      while (guard++ < b.cycle.length + 2) {
        if (b.cycleIndex >= b.cycle.length) b.cycleIndex = 0;
        const node = b.cycle[b.cycleIndex];
        if (node.type === 'player') {
          const u = b.units.find(x => x.sid === node.sid);
          if (u && !u.dead) {
            const cnt = parseInt((u.energyDice || '2D6')[0]) || 2;
            const energy = rollDice(cnt, 6);
            u.energy = energy; b.energy = energy; b.energyDice = u.energyDice; b.waitingFor = u.sid;
            return { over: false, type: 'player', sid: u.sid, energy, energyDice: u.energyDice };
          }
        } else {
          if (b.monsters.some(m => !m.dead)) return { over: false, type: 'monster' };
        }
        b.cycleIndex++;
      }
      return { over: true };
    },
    battlePlayerAct(roomId, sid, action, skillDmg) {
      const r = getRoom(String(roomId));
      const b = r.battle;
      if (!b || b.over) return { ok: false, msg: '战斗已结束' };
      if (b.waitingFor !== sid) return { ok: false, msg: '还没轮到你的行动轮' };
      const u = b.units.find(x => x.sid === sid);
      if (!u || u.dead) return { ok: false, msg: '你已无法行动' };
      if (action === 'end') { b.waitingFor = ''; b.cycleIndex++; return { ok: true, msg: `${u.name} 结束了本轮行动`, end: true, energy: b.energy }; }
      if (action === 'flee') { u.dead = true; b.waitingFor = ''; b.cycleIndex++; return { ok: true, msg: `${u.name} 撤退了`, flee: true }; }
      const cost = action === 'skill' ? 4 : (action === 'item' ? 1 : 2);
      if (b.energy < cost) return { ok: false, msg: `能量不足（需要 ${cost}，剩余 ${b.energy}）` };
      const mon = b.monsters.find(m => !m.dead);
      if (!mon) { b.over = true; return { ok: true, over: true, win: true, msg: '所有敌人已被消灭！' }; }
      if (action === 'item') { u.hp = Math.min(u.maxHp, u.hp + 5); b.energy -= cost; return { ok: true, msg: `${u.name} 服用消耗品，回复 5 HP`, hp: u.hp, energy: b.energy }; }
      const dmg = action === 'skill' ? Math.max(4, (skillDmg || 15) + Math.round(u.per * 0.3)) : Math.max(2, Math.round(u.str * 0.4) + 3);
      mon.hp -= dmg; b.energy -= cost;
      if (mon.hp <= 0) mon.dead = true;
      const over = b.monsters.every(m => m.dead);
      if (over) { b.over = true; return { ok: true, over: true, win: true, dmg, msg: `${u.name} 造成 ${dmg} 点伤害，${mon.name} 被消灭！` }; }
      return { ok: true, dmg, energy: b.energy, over: false, msg: `${u.name} 造成 ${dmg} 点伤害，${mon.name} 剩余 HP ${Math.max(0, mon.hp)}` };
    },
    battleMonsterAct(roomId) {
      const r = getRoom(String(roomId));
      const b = r.battle;
      if (!b || b.over) return { over: true };
      const mon = b.monsters.find(m => !m.dead);
      if (!mon) { b.over = true; return { over: true }; }
      const targets = b.units.filter(u => !u.dead);
      if (targets.length) {
        const t = targets[Math.floor(Math.random() * targets.length)];
        const dmg = mon.attackDamage || 6;
        t.hp = Math.max(0, t.hp - dmg);
        b.cycleIndex++;
        const over = b.units.every(u => u.dead);
        if (over) b.over = true;
        return { over, dmg, target: t.name, hp: t.hp, msg: `${mon.name} 发动攻击` };
      }
      b.cycleIndex++;
      b.over = true;
      return { over: true };
    },
    battleStatus(roomId) {
      const r = getRoom(String(roomId));
      const b = r.battle;
      if (!b) return { over: true, started: false };
      return {
        over: b.over, started: b.started,
        units: b.units.map(u => ({ sid: u.sid, name: u.name, hp: u.hp, maxHp: u.maxHp, dead: u.dead })),
        monsters: b.monsters.map(m => ({ type: m.type, name: m.name, hp: Math.max(0, m.hp), maxHp: m.maxHp, dead: m.dead })),
        waitingFor: b.waitingFor, energy: b.energy
      };
    },
    battleReset(roomId) { const r = getRoom(String(roomId)); r.battle = null; return true; },
    roomReset(roomId) { rooms.delete(String(roomId)); return true; }
  };
}

module.exports = engine;
