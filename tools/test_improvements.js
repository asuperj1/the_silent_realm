/**
 * test_improvements.js — 四项评估改进 + 副本持久化 验证
 * 覆盖：
 *  改进① 事件驱动扩展：PLAYER_HP_CHANGED / PLAYER_SAN_CHANGED / BATTLE_HEAL / SKILL_CD_READY /
 *       ITEM_USED / MONSTER_SPAWNED / MONSTER_DEFEATED / LOOT_ROLLED / CLUE_FOUND / COPY_START/END
 *  改进② 统一回合入口：turnService.advanceRoomTurn → tickTurn + TURN_ADVANCED
 *  改进③ BATTLE_TURN 事件：battleCurrent 新行动者 emit {data.sid}
 *  改进④ 离线跳过：battlePlayerOffline 当前行动者自动结束；battleCurrent 自动跳过 offline
 *  持久化  roomPersistence：save/load/findRoomByUid/remove 往返；eventRecorder 写入房间 eventLog
 */
const assert = require('assert');
const eventBus = require('../server/eventBus');
const EVENTS = require('../server/eventTypes');
const timerScheduler = require('../server/timerScheduler');
const turnService = require('../server/turnService');
const battleEngine = require('../server/battleEngine');
const roomPersistence = require('../server/roomPersistence');
const state = require('../server/state');

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) { passed++; console.log('  ✅', name); } else { failed++; console.log('  ❌', name); } }
function okEq(a, b, name) { ok(a === b, `${name}（期望 ${b}，实际 ${a}）`); }

function mkPlayer(sid, over = {}) {
  return {
    sid, name: sid, career: '方士', hp: 200, maxHp: 200, san: 100,
    physAtk: 15, magAtk: 15, physDef: 5, magDef: 5, pierce: 0,
    blockBonus: 0, shieldBase: 0, dex: 40, energyDice: '6D6',
    weapon: { itemId: 'G', itemName: 'w', kind: 'ranged', baseDmg: 10, ap: 1, hits: 1, blockOnBasic: 0 },
    skills: { '火球术': { ap: 2, cd: 2, target: 'single', damage: { base: 20, ratio: 0.5 }, sanCost: 5, heal: { base: 10, ratio: 0.2 } } },
    passives: [], resource: { id: '能量', type: 'active', value: 0, max: 10 },
    resourceRule: {}, resourceSkill: null, ...over
  };
}
function mkMonster(type, over = {}) {
  return { type, name: '史莱姆', hp: 1000, maxHp: 1000, dex: 5, physDef: 0, magDef: 0,
    intents: [{ move: 'attack', label: 'a', dmgBase: 30, ratio: 0.1 }], ...over };
}

// ============ 改进② 统一回合入口 ============
console.log('\n[1. 改进② 统一回合入口 turnService]');
{
  const fired = [];
  let turnAdvanced = 0;
  const room = { id: 'room_t1', turn: 1 };
  const off1 = eventBus.on(EVENTS.TURN_ADVANCED, () => turnAdvanced++);
  timerScheduler.schedule(2, () => fired.push('tick'), { type: 'buff', target: 'x' });
  const t1 = turnService.advanceRoomTurn(room);
  okEq(t1, 2, 'advanceRoomTurn 回合 +1');
  ok(timerScheduler.pendingCount() === 1, 'tickTurn 已驱动调度器（任务仍在倒计时）');
  turnService.advanceRoomTurn(room);
  okEq(fired.length, 1, '2 次推进后定时任务到期（buff/CD 随探索回合统一过期）');
  okEq(turnAdvanced, 2, 'TURN_ADVANCED 事件广播次数=2');
  eventBus.off(EVENTS.TURN_ADVANCED, off1);
}

// ============ 改进③ BATTLE_TURN 事件（含 data.sid） ============
console.log('\n[2. 改进③ BATTLE_TURN 事件订阅]');
{
  const turnEvents = [];
  const off = eventBus.on(EVENTS.BATTLE_TURN, ev => { if (ev.data && ev.data.sid) turnEvents.push(ev.data.sid); });
  battleEngine.battleStart('room_t3', { players: [mkPlayer('p1'), mkPlayer('p2')], monsters: [mkMonster('m')] });
  const c1 = battleEngine.battleCurrent('room_t3'); // p1 行动者
  ok(turnEvents.length >= 1 && turnEvents[0] === c1.sid, `BATTLE_TURN 携带当前行动者 sid（${turnEvents[0]}）`);
  battleEngine.battlePlayerAct('room_t3', 'p1', 'end'); // p1 结束 → p2 成为新行动者
  const c2 = battleEngine.battleCurrent('room_t3');
  ok(turnEvents.length >= 2 && turnEvents[1] === 'p2', `新行动者切换再次触发 BATTLE_TURN（p2）`);
  // 同一行动者重复调用不重复触发（_lastActor 守卫）
  battleEngine.battleCurrent('room_t3');
  okEq(turnEvents.length, 2, '同一行动者不重复触发（_lastActor 守卫）');
  battleEngine.battleReset('room_t3');
  eventBus.off(EVENTS.BATTLE_TURN, off);
}

// ============ 改进④ 离线跳过防卡死 ============
console.log('\n[3. 改进④ 离线成员自动跳过]');
{
  battleEngine.battleStart('room_t4', { players: [mkPlayer('p1'), mkPlayer('p2')], monsters: [mkMonster('m')] });
  battleEngine.battleCurrent('room_t4'); // p1 行动者
  const offRes = battleEngine.battlePlayerOffline('room_t4', 'p1');
  ok(offRes.ok && offRes.advanced, '离线时若为当前行动者 → 自动结束其回合');
  const cur = battleEngine.battleCurrent('room_t4');
  okEq(cur.sid, 'p2', 'p1 离线后自动轮到 p2（不卡死）');
  // 防御性：battleCurrent 遍历时自动跳过离线未行动者
  battleEngine.battlePlayerAct('room_t4', 'p2', 'end');
  // p1 已 offline 且 acted，p2 已 end → 全员结束 → 怪物回合
  const after = battleEngine.battleCurrent('room_t4');
  okEq(after.type, 'monster', '全员（含离线）结束后进入怪物回合');
  battleEngine.battleReset('room_t4');
}

// ============ 改进① HP/SAN/HEAL/CD/物品/怪物事件 ============
console.log('\n[4. 改进① 事件驱动扩展]');
{
  const events = { hp: [], san: [], heal: [], cdReady: [], dmg: [] };
  const offs = [
    eventBus.on(EVENTS.PLAYER_HP_CHANGED, ev => events.hp.push(ev)),
    eventBus.on(EVENTS.PLAYER_SAN_CHANGED, ev => events.san.push(ev)),
    eventBus.on(EVENTS.BATTLE_HEAL, ev => events.heal.push(ev)),
    eventBus.on(EVENTS.SKILL_CD_READY, ev => events.cdReady.push(ev)),
    eventBus.on(EVENTS.BATTLE_DAMAGE, ev => events.dmg.push(ev)),
  ];
  // 技能（含 SAN 消耗 + 治疗 + CD）→ SKILL_CD_READY 由 tickTurn 触发
  battleEngine.battleStart('room_t5', { players: [mkPlayer('p1')], monsters: [mkMonster('m')] });
  battleEngine.battleCurrent('room_t5');
  const rSkill = battleEngine.battlePlayerAct('room_t5', 'p1', { action: 'skill', skillId: '火球术' });
  ok(rSkill.ok, '技能释放成功');
  ok(events.san.length >= 1 && events.san[0].value === -5, `技能 SAN 消耗事件（-5）`);
  ok(events.heal.length >= 1 && events.heal[0].value >= 10, `技能治疗 BATTLE_HEAL`);
  ok(events.hp.length >= 1, `技能治疗 PLAYER_HP_CHANGED`);
  ok(timerScheduler.countByTarget('p1') >= 1, `技能 CD 已注册到回合制定时器`);
  // 驱动 2 回合 → SKILL_CD_READY 到期
  timerScheduler.tickTurn('room_t5'); timerScheduler.tickTurn('room_t5');
  ok(events.cdReady.length >= 1 && events.cdReady[0].data.skillName === '火球术', `SKILL_CD_READY 到期事件`);
  battleEngine.battleReset('room_t5');
  offs.forEach(f => eventBus.off(EVENTS.BATTLE_TURN, f));
  // 怪物攻击 → PLAYER_HP_CHANGED（负值）
  const hpBefore = events.hp.length;
  battleEngine.battleStart('room_t5b', { players: [mkPlayer('p1', { hp: 200 })], monsters: [mkMonster('m', { intents: [{ move: 'attack', dmgBase: 40, ratio: 0 }] })] });
  battleEngine.battleCurrent('room_t5b');
  battleEngine.battlePlayerAct('room_t5b', 'p1', 'end'); // → 怪物回合
  battleEngine.battleMonsterAct('room_t5b');
  ok(events.hp.length > hpBefore && events.hp[events.hp.length - 1].value < 0, `怪物攻击触发 PLAYER_HP_CHANGED（负值）`);
  battleEngine.battleReset('room_t5b');
  offs.forEach(f => eventBus.off(EVENTS.PLAYER_HP_CHANGED, f));
}

// ============ eventRecorder + roomPersistence ============
console.log('\n[5. 事件记录器 + 副本磁盘持久化]');
{
  // eventRecorder：先确保已启动（socketHandler 会在生产启动时调用；测试中显式启动）
  const eventRecorder = require('../server/eventRecorder');
  eventRecorder.ensureStarted();
  // 造一个房间，用事件 actor=roomId 驱动记录
  const room = { id: 'room_persist', turn: 1, players: new Map(), history: [], copyName: '废都纪元800｜青峰山虚空列车', copyState: { name: 'x', scores: {} }, dungeonState: { turn: 1, currentCar: 'car_4_dining', cluesFound: [], carStates: {} } };
  room.players.set('sock_a', { uid: 'u_test_1', socketId: 'sock_a', name: 'A', carId: 'car_4_dining', offline: false, attr: { hp: 80, san: 90, maxHp: 80, maxSan: 100 } });
  state.gameRooms.set(room.id, room);
  eventBus.emit(EVENTS.COPY_START, { actor: room.id, data: { copyName: room.copyName } });
  eventBus.emit(EVENTS.CLUE_FOUND, { actor: room.id, data: { clueId: 'L1', finder: 'A' } });
  eventBus.emit(EVENTS.PLAYER_HP_CHANGED, { actor: 'u_test_1', value: -10, data: { hp: 70, cause: 'test' } });
  ok(room.eventLog && room.eventLog.length === 2, `eventRecorder 已写入房间 eventLog（${room.eventLog.length} 条）`);
  // roomPersistence 往返
  ok(roomPersistence.saveRoom(room), 'saveRoom 落盘成功');
  const loaded = roomPersistence.loadRoom(room.id);
  ok(!!loaded, 'loadRoom 还原成功');
  ok(loaded.players.size === 1 && loaded.players.has('sock_a'), '还原玩家槽位');
  okEq(loaded.eventLog.length, 2, '还原 eventLog 记录');
  const found = roomPersistence.findRoomByUid('u_test_1');
  ok(!!found && found.id === room.id, 'findRoomByUid 命中');
  ok(!!roomPersistence.findRoomByUid('u_nonexist') === false, 'findRoomByUid 未命中返回 null');
  roomPersistence.removeRoom(room.id);
  ok(roomPersistence.loadRoom(room.id) === null, 'removeRoom 已删除磁盘副本');
  state.gameRooms.delete(room.id);
}

// ============ 战斗事件记录（改进① + 记录持久化联动） ============
console.log('\n[6. 战斗事件写入房间 eventLog]');
{
  const room = { id: 'room_btl', turn: 1, players: new Map(), history: [] };
  room.players.set('sock_b', { uid: 'u_btl', socketId: 'sock_b', name: 'B', carId: 'car_4_dining', offline: false, attr: {} });
  state.gameRooms.set(room.id, room);
  battleEngine.battleStart(room.id, { players: [mkPlayer('p1')], monsters: [mkMonster('m')] });
  const before = (room.eventLog || []).length;
  battleEngine.battleCurrent(room.id);
  battleEngine.battlePlayerAct(room.id, 'p1', { action: 'skill', skillId: '火球术' });
  ok((room.eventLog || []).length > before, `战斗（BATTLE_DAMAGE/HP/SAN/HEAL）已写入 eventLog`);
  battleEngine.battleReset(room.id);
  state.gameRooms.delete(room.id);
}
// ============ 战斗状态持久化（导出/恢复/重映射） ============
console.log('\n[7. 战斗状态持久化（battleExport/Restore/RemapSid）]');
{
  battleEngine.battleStart('btl_p', { players: [mkPlayer('p1'), mkPlayer('p2')], monsters: [mkMonster('m')] });
  battleEngine.battleCurrent('btl_p'); // p1 行动者
  const exp = battleEngine.battleExport('btl_p');
  ok(!!exp && exp.players.length === 2 && exp.monsters.length === 1, 'battleExport 导出活动战斗');
  ok(exp.waitingFor === 'p1', `导出含当前行动者（waitingFor=p1）`);
  battleEngine.battleReset('btl_p');
  ok(battleEngine.battleExport('btl_p') === null, '战斗结束后 export 为 null（不落盘残留）');
  // 恢复
  ok(battleEngine.battleRestore('btl_p', exp), 'battleRestore 还原战斗');
  const cur = battleEngine.battleCurrent('btl_p');
  okEq(cur.sid, 'p1', '还原后当前行动者仍为 p1');
  // sid 重映射（断线/刷新重连：旧 socket → 新 socket）
  ok(battleEngine.battleRemapSid('btl_p', 'p1', 'p1_new'), 'battleRemapSid 重映射 p1 → p1_new');
  const cur2 = battleEngine.battleCurrent('btl_p');
  okEq(cur2.sid, 'p1_new', '重映射后当前行动者 = p1_new');
  // 新 sid 可正常行动
  const act = battleEngine.battlePlayerAct('btl_p', 'p1_new', { action: 'attack' });
  ok(act.ok, '重映射后新 socket 可正常行动');
  battleEngine.battleReset('btl_p');
}
// ============ 回归：离线 + HP0 不导致驱动死循环 ============
console.log('\n[8. 回归：离线+阵亡不触发驱动死循环]');
{
  // 复现：玩家 hp=0（怪物打空）且 offline → battleCurrent / battleMonsterAct 不应死循环
  battleEngine.battleStart('btl_loop2', { players: [mkPlayer('p1', { hp: 1 })], monsters: [mkMonster('m', { intents: [{ move: 'attack', dmgBase: 50, ratio: 0 }] })] });
  battleEngine.battleCurrent('btl_loop2'); // p1
  battleEngine.battlePlayerAct('btl_loop2', 'p1', 'end'); // → 怪物回合，怪物打 p1 → hp 0 → dead
  battleEngine.battlePlayerOffline('btl_loop2', 'p1');   // p1 此刻离线
  let steps = 0, result = null;
  try {
    result = battleEngine.battleCurrent('btl_loop2');
    steps++;
    if (!result.over && result.type === 'monster') { battleEngine.battleMonsterAct('btl_loop2'); steps++; }
    result = battleEngine.battleStatus('btl_loop2');
  } catch (e) { ok(false, '驱动未抛异常（' + e.message + '）'); }
  ok(steps <= 3, '驱动步数受控（未死循环，steps=' + steps + '）');
  ok(result.over === true, '离线+阵亡后战斗正常判定结束');
  const p1u = result.units ? result.units.find(u => u.sid === 'p1') : null;
  ok(!!p1u && p1u.dead === true, '阵亡玩家已标记 dead（不再死循环）');
  battleEngine.battleReset('btl_loop2');

  // 全员离线 → 暂停（不驱动）；重连（remap）→ 恢复在线可继续
  battleEngine.battleStart('btl_pause', { players: [mkPlayer('p1', { hp: 100 }), mkPlayer('p2')], monsters: [mkMonster('m')] });
  battleEngine.battleCurrent('btl_pause'); // p1 行动者
  ok(battleEngine.battleHasOnlinePlayer('btl_pause') === true, '初始有在线玩家');
  battleEngine.battlePlayerOffline('btl_pause', 'p1');
  battleEngine.battlePlayerOffline('btl_pause', 'p2');   // 全员离线
  ok(battleEngine.battleHasOnlinePlayer('btl_pause') === false, '全员离线 → 无在线玩家（暂停不驱动）');
  ok(battleEngine.battleRemapSid('btl_pause', 'p1', 'p1_new'), 'p1 重连重映射');
  ok(battleEngine.battleHasOnlinePlayer('btl_pause') === true, '重连后恢复在线');
  battleEngine.battleReset('btl_pause');
}
console.log(`\n===== 结果: ${passed} passed, ${failed} failed =====`);
process.exit(failed ? 1 : 0);
