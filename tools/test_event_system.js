/**
 * test_event_system.js — 事件驱动系统测试（2026-08-16）
 * 覆盖：eventBus（on/emit/off/once）、timerScheduler（schedule/loop/cancel/tickTurn）、
 *       战斗引擎事件（BATTLE_START/TURN/DAMAGE/END + 回合调度器驱动）
 * 运行：node tools/test_event_system.js
 */
const eventBus = require('../server/eventBus');
const EVENTS = require('../server/eventTypes');
const Scheduler = require('../server/timerScheduler');
const battleEngine = require('../server/battleEngine');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✅', name, extra || ''); } else { fail++; console.log('  ❌', name, extra || ''); } };

console.log('\n[1. 事件管理器 eventBus]');
eventBus.clear();
let got = [];
eventBus.on(EVENTS.BATTLE_DAMAGE, (ev) => got.push(ev));
eventBus.emit(EVENTS.BATTLE_DAMAGE, { actor: 'p1', value: 25, data: { target: 'formless', kind: 'phys' } });
ok(got.length === 1, 'on + emit 收到事件', JSON.stringify({ actor: got[0].actor, value: got[0].value }));
ok(got[0].actor === 'p1' && got[0].value === 25 && got[0].data.kind === 'phys', '事件结构体 {actor, value, data} 完整');
ok(typeof got[0].timestamp === 'number' && typeof got[0].type === 'string', '自动附加 {type, timestamp}');

// off
const off = eventBus.on(EVENTS.BATTLE_DAMAGE, () => got.push('x'));
off(); // 取消
const lenBefore = got.length;
eventBus.emit(EVENTS.BATTLE_DAMAGE, { actor: 'p1', value: 5 });
ok(!got.includes('x') && got.length === lenBefore + 1, 'off 取消后新监听不再触发（旧监听仍收）');

// once
let onceCount = 0;
eventBus.once(EVENTS.CLUE_FOUND, () => onceCount++);
eventBus.emit(EVENTS.CLUE_FOUND, {});
eventBus.emit(EVENTS.CLUE_FOUND, {});
ok(onceCount === 1, 'once 只触发一次');

console.log('\n[2. 回合制定时调度器 timerScheduler]');
Scheduler.clear();
let fired = [];
// 一次性：3 回合后执行
Scheduler.schedule(3, () => fired.push('one'), { type: 'countdown', target: 'room1' });
// 循环：每 2 回合执行
Scheduler.schedule(2, () => fired.push('loop'), { type: 'buff', target: 'uid1', loop: true });
ok(Scheduler.pendingCount() === 2, '注册 2 个任务', `pending=${Scheduler.pendingCount()}`);

Scheduler.tickTurn('room1'); // 回合1
Scheduler.tickTurn('room1'); // 回合2 → loop 触发（第1次）
ok(fired.includes('loop') && !fired.includes('one'), '第2回合 loop 触发，one 未到', JSON.stringify(fired));
Scheduler.tickTurn('room1'); // 回合3 → one 触发（loop 每2回合，本次不触发）
ok(fired.filter(x => x === 'one').length === 1, '第3回合 一次性任务触发', JSON.stringify(fired));
ok(fired.filter(x => x === 'loop').length === 1, 'loop 每2回合：第3回合不重复触发', JSON.stringify(fired));
Scheduler.tickTurn('room1'); // 回合4 → loop 再触发（第2次）
ok(fired.filter(x => x === 'loop').length === 2, 'loop 第4回合再触发（每2回合）', JSON.stringify(fired));
ok(Scheduler.pendingCount() === 1, '一次性任务移除，只剩 loop', `pending=${Scheduler.pendingCount()}`);

// cancel
const tid = Scheduler.schedule(1, () => fired.push('cancelme'), { type: 'timer' });
Scheduler.cancel(tid);
Scheduler.tickTurn('room1');
ok(!fired.includes('cancelme'), 'cancel 取消后不触发');

// cancelByTarget
Scheduler.schedule(1, () => fired.push('buffA'), { type: 'buff', target: 'uid1' });
Scheduler.schedule(1, () => fired.push('buffB'), { type: 'buff', target: 'uid1' });
Scheduler.schedule(1, () => fired.push('cdX'), { type: 'skillCd', target: 'uid2' });
Scheduler.cancelByTarget('uid1');
Scheduler.tickTurn('room1');
ok(!fired.includes('buffA') && !fired.includes('buffB') && fired.includes('cdX'), 'cancelByTarget 按目标取消', JSON.stringify(fired.slice(-3)));

console.log('\n[3. 战斗引擎事件集成]');
eventBus.clear();
Scheduler.clear();
let startEv = null, turnEv = [], dmgEv = [], endEv = null;
eventBus.on(EVENTS.BATTLE_START, (ev) => startEv = ev);
eventBus.on(EVENTS.BATTLE_TURN, (ev) => turnEv.push(ev));
eventBus.on(EVENTS.BATTLE_DAMAGE, (ev) => dmgEv.push(ev));
eventBus.on(EVENTS.BATTLE_END, (ev) => endEv = ev);

const player = { sid: 'p1', name: '方士测试', career: '方士', hp: 500, maxHp: 500, san: 100, physAtk: 20, magAtk: 20, physDef: 5, magDef: 5, pierce: 0, blockBonus: 0, shieldBase: 0, dex: 40, energyDice: '2D3', weapon: { itemId: 'G-023', itemName: '左轮手枪', kind: 'ranged', baseDmg: 12, ap: 1, hits: 1, blockOnBasic: 0 }, skills: {}, passives: [], resource: { id: '能量', type: 'active', value: 0, max: 10 }, resourceRule: {}, resourceSkill: null };
const mon = { type: 'test_slime', name: '测试史莱姆', hp: 150, maxHp: 150, dex: 5, physDef: 0, magDef: 0, intents: [{ move: 'attack', label: '撞击', dmgBase: 3, ratio: 0.2 }] };

const RID = 'event_test_room';
battleEngine.battleStart(RID, { players: [player], monsters: [mon] });
ok(startEv && startEv.actor === RID, 'battleStart 触发 BATTLE_START', startEv ? JSON.stringify(startEv.data) : 'null');

// 循环战斗直到结束（模拟驱动回合调度）
let guard = 0;
while (guard++ < 20) {
  const c = battleEngine.battleCurrent(RID);
  if (c.over) break;
  if (c.type === 'player') {
    battleEngine.battlePlayerAct(RID, 'p1', { action: 'attack' });
  } else {
    battleEngine.battleMonsterAct(RID);
  }
}
ok(dmgEv.length > 0, '普攻触发 BATTLE_DAMAGE', `dmg 次数=${dmgEv.length}`);
ok(turnEv.length > 0, '回合推进触发 BATTLE_TURN', `turn 次数=${turnEv.length}`);
const st = battleEngine.battleStatus(RID);
ok(st.over === true && endEv && endEv.value === 'players', '战斗结束触发 BATTLE_END', `win=${endEv && endEv.value}`);
battleEngine.battleReset(RID);
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
