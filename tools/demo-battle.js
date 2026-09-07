/* tools/demo-battle.js — 战斗系统现场演示（驱动真实 battleEngine）
 * 幕 1：武士(架势条/招架) + 诡术小丑(暴击回资源) + 警官(正义值) vs 深潜修格斯(400HP)
 *        —— 展示团队战斗：技能/暴击/资源/格挡/怪物意图；武士挨打攒架势 → 招架抵消
 * 幕 2：警官 solo —— 普攻攒正义值 → 满值自动【正义处决】真实伤害
 * 用法：node tools/demo-battle.js
 */
const BE = require('../server/battleEngine');
const SB = require('../config/skill_battle.json');

function makeSnap(role, sid, name, career, treeId, opts) {
  const skills = {};
  const sb = (SB[treeId] && SB[treeId].skills) || {};
  Object.keys(sb).forEach(k => { skills[k] = sb[k]; });
  return {
    sid, name, career, role,
    hp: opts.hp || 120, maxHp: opts.hp || 120, san: 90, sanMax: 90,
    physAtk: opts.physAtk || 18, magAtk: opts.magAtk || 10, physDef: opts.physDef || 0, magDef: 0,
    pierce: 0, blockBonus: 0, shieldBase: 0, dex: opts.dex || 30, energyDice: opts.energyDice || '3D6',
    weapon: opts.weapon || null, skills, passives: [],
    resource: opts.resource || null, resourceRule: opts.resourceRule || {}, resourceSkill: opts.resourceSkill || null,
    mechanic: opts.mechanic || null
  };
}

function fmtRes(sid) {
  const u = BE.battleStatus('demo').units.find(x => x.sid === sid);
  const r = u && u.resource; if (!r || !r.id) return '';
  return `  [${r.id} ${r.value}/${r.max}]`;
}
function fmtMec(sid) {
  const u = BE.battleStatus('demo').units.find(x => x.sid === sid);
  const m = u && u.mechanic; if (!m || !m.acc) return '';
  if (m.id === 'stance') { const st = m.acc.stance || {}; return `  【架势条 ${st.count}/${st.threshold}${m.parry ? ' ⚔招架就绪' : ''}】`; }
  return '';
}
function meHp(sid) { return BE.battleStatus('demo').units.find(x => x.sid === sid).hp; }
function monHp() { return BE.battleStatus('demo').monsters[0].hp; }

// 标准怪物回合：全员 end → battleCurrent 切怪物阶段 → 怪物攻击 → 回玩家
function monsterTurn(rid) {
  const cur = BE.battleCurrent(rid);
  return BE.battleMonsterAct(rid);
}

// ════════════════ 幕 1：团队战斗 ════════════════
BE.battleReset('demo');
const w1 = makeSnap('战士', 'w1', '武士·影斩', '武士', 'wushi', {
  hp: 170, physAtk: 22, dex: 70, energyDice: '2D6',
  weapon: { name: '居合刀', baseDmg: 12, hits: 2, ap: 2 },
  resource: { id: '禅意', type: 'passive', value: 0, max: 10 },
  mechanic: { id: 'stance', label: '架势条', trigger: { onHurt: 1, onDodge: 2, threshold: 5 }, effect: '累积满触发『招架』' }
});
const c1 = makeSnap('敏捷', 'c1', '诡术小丑·嘻嘻', '诡术小丑', 'guishuxiaochou', {
  hp: 110, physAtk: 20, dex: 55, energyDice: '2D6',
  weapon: { name: '戏法短刃', baseDmg: 9, hits: 3, ap: 2 },
  resource: { id: '狂欢能量', type: 'active', value: 0, max: 12 },
  resourceRule: { gainOnCrit: 3, gainOnBasic: 1, costPerSkill: 3, max: 12 }
});
const o1 = makeSnap('爆发', 'o1', '警官·铁律', '警官', 'jingguan', {
  hp: 140, physAtk: 20, dex: 25, energyDice: '2D6',
  weapon: { name: '制式左轮', baseDmg: 10, hits: 1, ap: 3 },
  resource: { id: '正义值', type: 'mix', value: 0, max: 10 },
  resourceRule: { gainOnBasic: 1, gainOnKill: 5, max: 10, autoExecute: '满值自动正义处决' }
});
const players = [w1, c1, o1];
const shoggoth = { type: 'shoggoth', name: '深潜修格斯', intents: [{ move: 'attack', label: '拟足横扫', dmgBase: 8, ratio: 0.3 }] };
BE.battleStart('demo', { players, monsters: [shoggoth] });

log_header = () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ⚔ 寂静之地 · 战斗系统现场演示（杀戮尖塔2式）           ║');
  console.log('║  武士(架势条/招架) + 诡术小丑(暴击回资源) + 警官(正义)  ║');
  console.log('║  VS 深潜修格斯（HP 400）                                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
};
log_header();

const MAIN_TURNS = 8;
for (let t = 1; t <= MAIN_TURNS && !BE.battleStatus('demo').over; t++) {
  console.log(`\n──────────────── 第 ${t} 回合（怪物 HP ${monHp()}/400） ────────────────`);
  BE.battleCurrent('demo'); // 掷 AP + 回合开始 + 警官正义处决检查
  const auto = players.filter(p => p._lastAuto).map(p => p._lastAuto);
  if (auto.length) auto.forEach(m => console.log(`  ⚡ ${m}`));
  for (const p of players) {
    const me = BE.battleStatus('demo').units.find(u => u.sid === p.sid);
    if (p.dead || !me || me.acted || BE.battleStatus('demo').over) continue;
    const ap = me.ap || 0;
    const sk = Object.keys(p.skills).filter(n => { const s = p.skills[n]; return s && s.ap != null && s.ap <= ap && !(p.skillCds && p.skillCds[n] > BE.battleStatus('demo').turn); });
    let res;
    if (sk.length) {
      res = BE.battlePlayerAct('demo', p.sid, { action: 'skill', skillId: sk[0], target: 0 });
      if (res.ok) console.log(`  🗡 ${res.msg}${fmtRes(p.sid)}${fmtMec(p.sid)}`);
      else { res = BE.battlePlayerAct('demo', p.sid, { action: 'attack', target: 0 }); if (res.ok) console.log(`  ⚔ ${res.msg}${fmtRes(p.sid)}${fmtMec(p.sid)}`); }
    } else {
      res = BE.battlePlayerAct('demo', p.sid, { action: 'attack', target: 0 });
      if (res.ok) console.log(`  ⚔ ${res.msg}${fmtRes(p.sid)}${fmtMec(p.sid)}`);
    }
    if (!res || !res.ok) console.log(`  ⚠ ${p.name}：${res && res.msg}`);
  }
  players.forEach(p => { if (!p.dead) BE.battlePlayerAct('demo', p.sid, 'end'); });
  const mres = monsterTurn('demo');
  if (mres && mres.msg) console.log(`  👹 ${mres.msg}`);
  players.forEach(p => {
    if (!p.dead) console.log(`     ${p.name} HP${meHp(p.sid)}${fmtMec(p.sid)}`);
  });
}
const st1 = BE.battleStatus('demo');
console.log(`\n幕 1 结束：${st1.over ? (st1.winner === 'players' ? '🎉 队伍获胜' : '💀 队伍覆灭') : ('演示至第 ' + MAIN_TURNS + ' 回合，怪 HP ' + st1.monsters[0].hp + '/400')}`);

// ════════════════ 幕 2：警官正义处决 ════════════════
BE.battleReset('demo2');
const o2 = makeSnap('爆发', 'o1', '警官·铁律', '警官', 'jingguan', {
  hp: 200, physAtk: 22, dex: 25, energyDice: '2D6',
  weapon: { name: '制式左轮', baseDmg: 10, hits: 1, ap: 3 },
  resource: { id: '正义值', type: 'mix', value: 0, max: 10 },
  resourceRule: { gainOnBasic: 1, gainOnKill: 5, max: 10, autoExecute: '满值自动正义处决' }
});
BE.battleStart('demo2', { players: [o2], monsters: [shoggoth] });
console.log('\n');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  幕 2：警官 solo —— 每回合普攻攒正义 → 满值自动【正义处决】║');
console.log('╚══════════════════════════════════════════════════════════╝');
let executed = false;
for (let t = 1; t <= 14 && !BE.battleStatus('demo2').over && !executed; t++) {
  const hpBefore = BE.battleStatus('demo2').monsters[0].hp;
  BE.battleCurrent('demo2'); // 回合开始：警官正义值满 → 自动正义处决
  const hpAfter = BE.battleStatus('demo2').monsters[0].hp;
  const drop = hpBefore - hpAfter;
  if (drop > 15) {
    console.log(`  第 ${t} 回合开始：⚡ 正义值满！触发【正义处决】无视防御造成 ${drop} 点真实伤害（怪 HP ${hpBefore}→${hpAfter}，正义清零）`);
    executed = true;
    break;
  }
  const u = BE.battleStatus('demo2').units[0];
  // 只普攻（攒正义），不放技能
  const res = BE.battlePlayerAct('demo2', o2.sid, { action: 'attack', target: 0 });
  const resVal = res.status ? res.status.units[0].resource.value : BE.battleStatus('demo2').units[0].resource.value;
  console.log(`  第 ${t} 回合：${res.msg}  [正义值 ${resVal}/${u.resource.max}]`);
  BE.battlePlayerAct('demo2', o2.sid, 'end');
  const mres = monsterTurn('demo2');
  if (mres && mres.msg) console.log(`         👹 ${mres.msg}（警官 HP${BE.battleStatus('demo2').units[0].hp}）`);
}
if (!executed) console.log('  警官 HP 耗尽前正义未满（未触发处决）');
console.log('');
