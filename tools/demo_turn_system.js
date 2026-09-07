/**
 * demo_turn_system.js — 回合制系统演示
 * 演示内容：
 *  A. 杀戮尖塔2式战斗回合：玩家回合（全员轮流）→ 怪物回合 → turn+1
 *  B. 全员回合制 + 回合纪律（非当前行动者/已行动者被拒、能量不足自动结束）
 *  C. 事件驱动回合：BATTLE_TURN / TURN_ADVANCED 事件 + timerScheduler（技能CD/buff到期）
 *  D. 离线成员自动跳过（防卡死）
 * 运行：node tools/demo_turn_system.js
 */
'use strict';
const battleEngine = require('../server/battleEngine');
const eventBus = require('../server/eventBus');
const EVENTS = require('../server/eventTypes');
const timerScheduler = require('../server/timerScheduler');

function mkPlayer(sid, dex, career, over = {}) {
  return {
    sid, name: sid, career, hp: 200, maxHp: 200, san: 100,
    physAtk: 18, magAtk: 18, physDef: 5, magDef: 5, pierce: 0,
    blockBonus: 0, shieldBase: 0, dex, energyDice: '3D6',
    weapon: { itemId: 'G', itemName: '武器', kind: 'melee', baseDmg: 12, ap: 2, hits: 1, blockOnBasic: 0 },
    skills: {
      '火球术': { ap: 3, cd: 2, target: 'single', damage: { base: 25, ratio: 0.5 } },
      '护体术': { ap: 2, cd: 1, target: 'self', block: 10 }
    },
    passives: [], resource: { id: '能量', type: 'active', value: 0, max: 10 },
    resourceRule: {}, resourceSkill: null, ...over
  };
}
function mkMonster(type, name, hp, over = {}) {
  return { type, name, hp, maxHp: hp, dex: 5, physDef: 0, magDef: 0,
    intents: [{ move: 'attack', label: '攻击', dmgBase: 8, ratio: 0.3 }], ...over };
}
const line = () => console.log('─'.repeat(60));

// ==================== A. 杀戮尖塔2式战斗回合 ====================
console.log('\n════════════════ A. 战斗回合（杀戮尖塔2式） ════════════════');
{
  const roomId = 'demo_a';
  const p1 = mkPlayer('p1', 40, '方士');
  const p2 = mkPlayer('p2', 30, '角斗士');
  battleEngine.battleStart(roomId, { players: [p1, p2], monsters: [mkMonster('slime', '史莱姆', 400)] });
  console.log('⚔ 战斗开始：方士(p1,敏捷40) + 角斗士(p2,敏捷30) vs 史莱姆(HP400)');

  let guard = 0;
  while (guard++ < 12) {
    const cur = battleEngine.battleCurrent(roomId);   // ★ 驱动循环核心：battleCurrent 推进
    if (cur.over) { console.log(`🏁 战斗结束，胜方: ${cur.winner === 'players' ? '玩家' : '怪物'}`); break; }
    if (cur.type === 'monster') {
      const m = battleEngine.battleMonsterAct(roomId);
      const units = battleEngine.battleStatus(roomId).units;
      console.log(`  👾 [回合${battleEngine.battleStatus(roomId).turn - 1}] 怪物回合：${m.msg}`);
      console.log(`     → 怪物行动完毕，turn+1 回玩家回合（当前 turn=${battleEngine.battleStatus(roomId).turn}）`);
      continue;
    }
    const turn = battleEngine.battleStatus(roomId).turn;
    const r = battleEngine.battlePlayerAct(roomId, cur.sid, { action: 'attack' });
    console.log(`  [T${turn}玩家回合] ${cur.sid}(${cur.sid==='p1'?'方士':'角斗士'}) 掷骰AP=${cur.ap}，普攻造成 ${r.dmg} 伤害（AP剩余 ${r.energy}）`);
    battleEngine.battlePlayerAct(roomId, cur.sid, 'end');
    const next = battleEngine.battleCurrent(roomId);   // ★ end 后驱动下一行动者
    if (next.type === 'player') console.log(`  [T${turn}] ${cur.sid} 结束回合 → 下一行动者: ${next.sid}（不进入怪物回合）`);
    else console.log(`  [T${turn}] 全员结束 → 进入怪物回合`);
  }
  battleEngine.battleReset(roomId);
}

// ==================== B. 全员回合制 + 回合纪律 ====================
console.log('\n════════════════ B. 全员回合制 + 回合纪律 ════════════════');
{
  const roomId = 'demo_b';
  battleEngine.battleStart(roomId, { players: [mkPlayer('p1', 40, '方士'), mkPlayer('p2', 30, '角斗士')], monsters: [mkMonster('slime', '史莱姆', 999)] });
  let cur = battleEngine.battleCurrent(roomId);
  console.log('当前行动者:', cur.sid);

  const t1 = battleEngine.battlePlayerAct(roomId, 'p1', { action: 'attack' });
  console.log('p1 行动(普攻):', t1.ok);
  const rejectP2 = battleEngine.battlePlayerAct(roomId, 'p2', { action: 'attack' });
  console.log('❌ p2 抢行动（当前是 p1）→ 拒绝:', !rejectP2.ok, `(${rejectP2.msg})`);
  battleEngine.battlePlayerAct(roomId, 'p1', 'end');
  cur = battleEngine.battleCurrent(roomId);   // ★ 驱动 p2 成为行动者
  console.log('p1 结束 → 下一行动者:', cur.sid, '（不进入怪物回合）');
  const rejectP1 = battleEngine.battlePlayerAct(roomId, 'p1', { action: 'attack' });
  console.log('❌ p1 已结束再行动 → 拒绝:', !rejectP1.ok, `(${rejectP1.msg})`);
  battleEngine.battlePlayerAct(roomId, 'p2', 'end');
  cur = battleEngine.battleCurrent(roomId);
  console.log('p2 结束 → 全员结束，phase:', cur.type, '（应=monster）');
  line();
  console.log('▶ 若 p2 未结束就想推进？— 引擎要求全员 acted 才进怪物回合');
  battleEngine.battleReset(roomId);
}

// ==================== C. 事件驱动回合 + 定时调度 ====================
console.log('\n════════════════ C. 事件驱动回合 + timerScheduler ════════════════');
{
  const roomId = 'demo_c';
  const events = { turn: [], cdReady: [], advanced: [] };
  const offs = [
    eventBus.on(EVENTS.BATTLE_TURN, ev => { if (ev.data && ev.data.sid) events.turn.push(`T${ev.value}→${ev.data.sid}`); }),
    eventBus.on(EVENTS.TURN_ADVANCED, ev => events.advanced.push(ev.value)),
    eventBus.on(EVENTS.SKILL_CD_READY, ev => events.cdReady.push(`${ev.data.skillName} 冷却完成`))
  ];
  const p1 = mkPlayer('p1', 40, '方士', { energyDice: '6D6' });
  battleEngine.battleStart(roomId, { players: [p1], monsters: [mkMonster('slime', '史莱姆', 999)] });
  battleEngine.battleCurrent(roomId);
  const r = battleEngine.battlePlayerAct(roomId, 'p1', { action: 'skill', skillId: '火球术' });
  console.log(`p1 释放【火球术】: ${r.ok} 伤害 ${r.dmg}（CD=2 回合，已注册到调度器）`);
  console.log('调度器技能CD任务数:', timerScheduler.countByTarget('p1'));
  console.log('BATTLE_TURN 事件(当前行动者):', events.turn.join(' | '));
  // 驱动 2 回合 → CD 到期
  timerScheduler.tickTurn(roomId);
  timerScheduler.tickTurn(roomId);
  console.log('SKILL_CD_READY 事件:', events.cdReady.join(' | ') || '（未到期）');
  battleEngine.battleReset(roomId);
  offs.forEach(f => eventBus.off(EVENTS.BATTLE_TURN, f));
}

// ==================== D. 离线成员自动跳过 ====================
console.log('\n════════════════ D. 离线成员自动跳过（防卡死） ════════════════');
{
  const roomId = 'demo_d';
  battleEngine.battleStart(roomId, { players: [mkPlayer('p1', 40, '方士'), mkPlayer('p2', 30, '角斗士'), mkPlayer('p3', 20, '侦探')], monsters: [mkMonster('slime', '史莱姆', 500)] });
  battleEngine.battleCurrent(roomId); // p1
  const off = battleEngine.battlePlayerOffline(roomId, 'p1');
  console.log('p1 断线（当前行动者）→ 自动结束其回合:', off.advanced);
  const cur = battleEngine.battleCurrent(roomId);
  console.log('下一行动者:', cur.sid, '（p1 离线被跳过，不卡死）');
  battleEngine.battlePlayerAct(roomId, 'p2', 'end');
  const cur2 = battleEngine.battleCurrent(roomId);
  console.log('p2 结束后下一行动者:', cur2.sid, '（p1 仍未回来 → 继续跳过）');
  battleEngine.battleReset(roomId);
}

console.log('\n✅ 回合制系统演示完成');
