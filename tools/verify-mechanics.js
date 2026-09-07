/* tools/verify-mechanics.js — 职业机制引擎验证（临时脚本，可删除）
 * 验证：暴击回资源(gainOnCrit) / 技能多段 hits / 闪避(onDodge) / 架势条累积+招架抵消
 *       / 装填(reload) / 标记弱点(markWeak)
 * 用法：node tools/verify-mechanics.js
 */
const BE = require('../server/battleEngine');

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✅ ' + name);
  else { failures++; console.log('  ❌ ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}
function setRandom(v) { Math.random = () => v; }
function myRes(st, sid) { return st.units.find(u => u.sid === sid).resource; }
function myMec(st, sid) { return st.units.find(u => u.sid === sid).mechanic; }
function myHp(st, sid) { return st.units.find(u => u.sid === sid).hp; }
// ★ 标准回合推进：玩家结束行动 → 切怪物阶段 → 怪物攻击一次 → 回玩家阶段
function roundWithMonster(rid, sid) {
  BE.battleCurrent(rid);                // 玩家阶段（掷 AP / 回合开始被动）
  BE.battlePlayerAct(rid, sid, 'end');  // 结束玩家行动
  BE.battleCurrent(rid);                // 全员 acted → 切怪物阶段
  return BE.battleMonsterAct(rid);      // 怪物攻击 1 次 + 回玩家阶段
}

function wushiSnap(sid) {
  return {
    sid, name: '武士', career: '武士', role: '战士',
    hp: 200, maxHp: 200, san: 80, physAtk: 20, magAtk: 10, physDef: 0, magDef: 0,
    pierce: 0, blockBonus: 0, shieldBase: 0, dex: 50, energyDice: '2D6',
    weapon: { name: '居合刀', baseDmg: 12, hits: 2, ap: 2 },
    skills: {}, passives: [],
    resource: { id: '禅意', type: 'passive', value: 0, max: 10 }, resourceRule: {}, resourceSkill: null,
    mechanic: { id: 'stance', label: '架势条', trigger: { onHurt: 1, onDodge: 2, threshold: 5 }, effect: '累积满触发『招架』' }
  };
}
function clownSnap(sid) {
  return {
    sid, name: '小丑', career: '诡术小丑', role: '敏捷',
    hp: 200, maxHp: 200, san: 80, physAtk: 20, magAtk: 10, physDef: 0, magDef: 0,
    pierce: 0, blockBonus: 0, shieldBase: 0, dex: 50, energyDice: '4D6',
    weapon: { name: '戏法短刃', baseDmg: 9, hits: 3, ap: 2 },
    skills: { '连环戏法': { ap: 3, cd: 1, target: 'single', damage: { base: 6, ratio: 0.5, scale: 'physAtk', hits: 3 } } },
    passives: [],
    resource: { id: '狂欢能量', type: 'active', value: 0, max: 12 },
    resourceRule: { gainOnCrit: 3, gainOnBasic: 1, costPerSkill: 3, max: 12 },
    resourceSkill: null, mechanic: null
  };
}
function gunnerSnap(sid) {
  return {
    sid, name: '枪手', career: '枪手', role: '敏捷',
    hp: 100, maxHp: 100, san: 80, physAtk: 18, magAtk: 8, physDef: 0, magDef: 0,
    pierce: 0, blockBonus: 0, shieldBase: 0, dex: 50, energyDice: '3D6',
    weapon: { name: '左轮', baseDmg: 10, hits: 2, ap: 4 },
    skills: {}, passives: [],
    resource: { id: '子弹', type: 'active', value: 0, max: 12 },
    resourceRule: { gainOnReload: 5, gainOnTurnStart: 2, costPerSkill: 1, max: 12 },
    resourceSkill: null, mechanic: null
  };
}
function detectiveSnap(sid) {
  return {
    sid, name: '侦探', career: '侦探', role: '敏捷',
    hp: 100, maxHp: 100, san: 80, physAtk: 16, magAtk: 10, physDef: 0, magDef: 0,
    pierce: 0, blockBonus: 0, shieldBase: 0, dex: 50, energyDice: '3D6',
    weapon: { name: '连刺匕首', baseDmg: 10, hits: 2, ap: 2 },
    skills: {}, passives: [],
    resource: { id: '探知值', type: 'mix', value: 0, max: 10 },
    resourceRule: { gainOnBasic: 1, gainOnTurnStart: 1, costPerSkill: 2, max: 10, markWeak: '消耗2探知标记1目标弱点(易伤+1)' },
    resourceSkill: null, mechanic: null
  };
}
// 无攻击怪物（只格挡），用于纯玩家行动测试
const blockOnlyMon = { type: 'formless', name: '怪A', hp: 500, intents: [{ move: 'block', label: '格挡', block: 1 }] };
// 攻击怪物（formless 撕咬 def=3，怪物无 physAtk → dmg=6）
const atkMon = { type: 'formless', name: '怪B', hp: 200, intents: [{ move: 'attack', label: '撕咬', dmgBase: 6, ratio: 0.3 }] };

// ============ 1. 诡术小丑：暴击回资源 + 技能多段 hits ============
console.log('\n[1] 诡术小丑：暴击回资源(gainOnCrit) + 技能多段 hits');
BE.battleReset('t1');
BE.battleStart('t1', { players: [clownSnap('c1')], monsters: [blockOnlyMon] });
BE.battleCurrent('t1');
setRandom(0.001); // 必暴击（0.001 < critRate 0.25）
const atk = BE.battlePlayerAct('t1', 'c1', { action: 'attack' });
check('普攻 3 段全暴击 → 狂欢能量 = 3×3(暴击) + 1(普攻) = 10', atk.status && myRes(atk.status, 'c1').value === 10, { res: myRes(atk.status, 'c1') });
// 技能多段（不暴击）：每段 6+20*0.5=16，怪 def=3 → 13/段，3 段 = 39
setRandom(0.99);
const sk = BE.battlePlayerAct('t1', 'c1', { action: 'skill', skillId: '连环戏法' });
check('技能 3 段 hits 总伤 = 39（含怪 def 3×3）', sk.dmg === 39, { dmg: sk.dmg });
check('技能消耗资源 3 → value = 10 - 3 = 7', myRes(sk.status, 'c1').value === 7, { res: myRes(sk.status, 'c1') });

// ============ 2. 武士：架势条累积 → 招架抵消；闪避(onDodge) 累积 ============
console.log('\n[2] 武士：架势条累积 → 招架抵消；闪避(onDodge) 累积');
BE.battleReset('t2');
BE.battleStart('t2', { players: [wushiSnap('w1')], monsters: [atkMon] });
BE.battleCurrent('t2');
setRandom(0.99); // 不闪避
let parryRes = null;
for (let i = 0; i < 5; i++) parryRes = roundWithMonster('t2', 'w1');
check('受击 5 次后架势条 count=0 且 parry=true', myMec(parryRes.status, 'w1').acc.stance.count === 0 && myMec(parryRes.status, 'w1').parry === true, { mec: myMec(parryRes.status, 'w1') });
const hpBefore = myHp(parryRes.status, 'w1');
// 第 6 次攻击 → 招架抵消（HP 不变）
const p6 = roundWithMonster('t2', 'w1');
check('第 6 次攻击被【招架】抵消（HP 不变）', myHp(p6.status, 'w1') === hpBefore, { before: hpBefore, after: myHp(p6.status, 'w1') });
check('招架后 parry=false 且受击又 +1 → stance=1', myMec(p6.status, 'w1').parry === false && myMec(p6.status, 'w1').acc.stance.count === 1, { mec: myMec(p6.status, 'w1') });
// 闪避累积
BE.battleReset('t3');
BE.battleStart('t3', { players: [wushiSnap('w2')], monsters: [atkMon] });
BE.battleCurrent('t3');
setRandom(0.001); // 必闪避（0.001 < dodgeRate）
const d0 = BE.battleStatus('t3').units.find(u => u.sid === 'w2').hp;
const dod = roundWithMonster('t3', 'w2');
check('闪避成功：HP 不减', myHp(dod.status, 'w2') === d0, { hp: myHp(dod.status, 'w2'), d0 });
check('闪避 onDodge 累积 → stance=2', myMec(dod.status, 'w2').acc.stance.count === 2, { mec: myMec(dod.status, 'w2') });

// ============ 3. 枪手：装填回子弹 ============
console.log('\n[3] 枪手：装填(reload) 回子弹');
BE.battleReset('t4');
BE.battleStart('t4', { players: [gunnerSnap('g1')], monsters: [blockOnlyMon] });
BE.battleCurrent('t4');
const rl = BE.battlePlayerAct('t4', 'g1', { action: 'reload' });
check('装填后子弹 = 2(回合开始) + 5 = 7', myRes(rl.status, 'g1').value === 7, { res: myRes(rl.status, 'g1') });
check('装填扣 1 AP（energy < 21）', rl.energy < 21, { energy: rl.energy });
check('status.specialAction === reload', rl.status.units.find(u => u.sid === 'g1').specialAction === 'reload');

// ============ 4. 侦探：标记弱点 ============
console.log('\n[4] 侦探：标记弱点(markWeak)');
BE.battleReset('t5');
BE.battleStart('t5', { players: [detectiveSnap('d1')], monsters: [atkMon] });
BE.battleCurrent('t5');
// 探知不足（0<2）→ 拒绝
const mwFail = BE.battlePlayerAct('t5', 'd1', { action: 'markWeak', target: 0 });
check('探知不足(0<2) → 拒绝', mwFail.ok === false && /探知值不足/.test(mwFail.msg), { msg: mwFail.msg });
// 走 2 回合累积 2 探知 → markWeak 成功
roundWithMonster('t5', 'd1'); // 回合1：+1 → 1
roundWithMonster('t5', 'd1'); // 回合2：+1 → 2
BE.battleCurrent('t5');
const mw = BE.battlePlayerAct('t5', 'd1', { action: 'markWeak', target: 0 });
check('探知=3 → 标记弱点成功', mw.ok === true && /标记了/.test(mw.msg), { msg: mw.msg });
check('标记后探知 = 3-2 = 1', myRes(mw.status, 'd1').value === 1, { res: myRes(mw.status, 'd1') });
const mon = mw.status.monsters[0];
check('目标获得【易伤】+1', (mon.statuses || []).some(s => s.id === 'vulnerable' && s.value === 1), { st: mon.statuses });

console.log('\n' + (failures === 0 ? '🎉 全部通过' : `⚠ ${failures} 项失败`));
process.exit(failures === 0 ? 0 : 1);
