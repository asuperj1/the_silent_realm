/**
 * test_engine.js — C++ 战斗行为系统 1.0 引擎单元测试
 * 运行：node native/test/test_engine.js
 */
const engine = require('../build/Release/battle_engine.node');
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } };

// ============ 探索体系 ============
console.log('\n[探索回合体系]');
let r = engine.exploreStart('roomA');
ok(r.round === 1, `首次 startExploreRound → round=1 (${r.round})`);
r = engine.exploreStart('roomA');
ok(r.round === 2, `再次 startExploreRound → round=2 (${r.round})`);

let d = engine.explorePlayerDice('roomA', 'p1');
ok(d.dice >= 1 && d.dice <= 6, `p1 掷 1D6 → ${d.dice}`);
let d2 = engine.explorePlayerDice('roomA', 'p1');
ok(d2.dice === d.dice, '同一大回合再次掷骰复用同一点数');

let c1 = engine.exploreConsume('roomA', 'p1', 'simple_search');
ok(c1.actionCost === 0 && c1.newCost === 0, `成本归零（KP 回合值体系）→ actionCost=${c1.actionCost}`);
let c2 = engine.exploreConsume('roomA', 'p1', 'observe');
ok(c2.newCost === 0 && c2.forcedEnd === false, '连续行动成本仍为 0');
let c3 = engine.exploreConsume('roomA', 'p1', 'move');
ok(c3.used === 3 && c3.forcedEnd === false, `仅计操作次数 used=${c3.used}`);
let c4 = engine.exploreConsume('roomA', 'p1', 'bandage');
ok(c4.forcedEnd === false && c4.ended === false, '不再因成本强制结束');
// 操作次数上限：循环 consume 直到被跳过（p1 骰子点数随机）
let c5 = null; let guardC = 0;
while (guardC++ < 10) { c5 = engine.exploreConsume('roomA', 'p1', 'other'); if (c5.skipped) break; }
ok(c5 && c5.skipped === true, '操作次数用尽后被跳过');

let p2 = engine.explorePlayerDice('roomA', 'p2');
let ep = engine.exploreEndPlayer('roomA', 'p2');
ok(ep.ok === true && ep.dice === p2.dice, 'p2 手动结束回合');
// ★ 成本归零后 p1 不因成本强制结束，用尽操作次数后也需手动结束以同步（与 KP 回合值体系一致）
engine.exploreEndPlayer('roomA', 'p1');
let all = engine.exploreAllEnded('roomA', ['p1', 'p2']);
ok(all.allEnded === true, '所有玩家已结束 → allEnded=true');
let all2 = engine.exploreAllEnded('roomA', ['p1', 'p2', 'p3']);
ok(all2.allEnded === false, '还有 p3 未行动 → allEnded=false（多人同步）');

// ============ 战斗体系 ============
console.log('\n[战斗体系：敏捷比值 + 能量骰]');
const players = [
  { sid: 'p1', name: 'fangshi', career: 'fangshi', energyDice: '3D6', dex: 30, str: 40, per: 50, hp: 80, maxHp: 80 },
  { sid: 'p2', name: 'wushi', career: 'wushi', energyDice: '2D6', dex: 45, str: 60, per: 30, hp: 90, maxHp: 90 }
];
const monsters = [
  { type: 'formless', name: 'wuxingzhizi', dex: 15, hp: 120, maxHp: 120, attackDamage: 6 }
];
let b = engine.battleStart('roomA', players, monsters);
ok(b.units === 2 && b.monsters === 1, `battleStart → 2 players 1 monster (cycleLen=${b.cycleLen})`);

let cur = engine.battleCurrent('roomA');
ok(cur.type === 'player' && cur.sid === 'p2', `first actor p2 (dex45) energy=${cur.energy} dice=${cur.energyDice}`);
ok(cur.energy >= 2 && cur.energy <= 12, `p2 roll 2D6 energy → ${cur.energy}`);

let atk = engine.battlePlayerAct('roomA', 'p2', 'attack');
ok(atk.ok === true && atk.dmg >= 2, `p2 attack dmg=${atk.dmg} energyLeft=${atk.energy}`);

let cur2 = engine.battleCurrent('roomA');
ok(cur2.type === 'player' && cur2.sid === 'p2', 'same turn p2 continues (energy dump)');
let end = engine.battlePlayerAct('roomA', 'p2', 'end');
ok(end.ok === true, 'p2 ends turn');

let cur3 = engine.battleCurrent('roomA');
ok(cur3.type === 'player' && (cur3.sid === 'p2' || cur3.sid === 'p1'), `next actor p2/p1 → ${cur3.sid}`);

let wrong = engine.battlePlayerAct('roomA', 'p1', 'attack');
ok(wrong.ok === false, `not-turn p1 rejected: ${wrong.msg}`);

let guard = 0;
let curM = engine.battleCurrent('roomA');
while (guard++ < 20 && curM.type === 'player') {
  engine.battlePlayerAct('roomA', curM.sid, 'end');
  curM = engine.battleCurrent('roomA');
}
ok(curM.type === 'monster', `advance to monster turn → ${curM.type}`);
let mAct = engine.battleMonsterAct('roomA');
ok(mAct.dmg >= 1 && mAct.over === false, `monster attack dmg=${mAct.dmg}`);

console.log('\n[battle end]');
let guard2 = 0;
let over = false;
while (guard2++ < 60 && !over) {
  let cc = engine.battleCurrent('roomA');
  if (cc.over) { over = true; break; }
  if (cc.type === 'player') {
    engine.battlePlayerAct('roomA', cc.sid, 'attack');
    let st = engine.battleStatus('roomA');
    if (st.over || st.monsters.every(m => m.dead)) { over = true; break; }
  } else {
    engine.battleMonsterAct('roomA');
    let st = engine.battleStatus('roomA');
    if (st.over) { over = true; break; }
  }
}
let st = engine.battleStatus('roomA');
ok(st.over === true, `battle over=${st.over}`);
ok(st.monsters.every(m => m.dead), 'all monsters dead');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
