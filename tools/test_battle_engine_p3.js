/** test_battle_engine_p3.js — P3 测试：米戈召唤仆从、SAN 消耗与疯狂机制 */
const engine = require('../server/battleEngine');
const RID = 'p3_test';
const results = [];
const check = (n, c, d) => { results.push({ n, ok: !!c }); console.log(`${c ? '✅' : '❌'} ${n}${c ? '' : ' — ' + d}`); };

const player = {
  sid: 'p1', name: '调查员', career: 'fangshi', role: '法师',
  hp: 100, maxHp: 100, san: 30, sanMax: 100, physAtk: 40, magAtk: 40, physDef: 10, magDef: 5, pierce: 5, blockBonus: 5, shieldBase: 5,
  dex: 20, energyDice: '3D6', weapon: null, skills: {}, passives: [], resource: null, resourceRule: {}
};

// ===== 1. 米戈召唤仆从 =====
const migo = { type: 'custom', name: '米戈', hp: 80, maxHp: 80, dex: 22, intents: [{ move: 'summon', label: '呼唤仆从', summon: 'formless' }] };
engine.battleStart(RID, { players: [{ ...player, san: 100 }], monsters: [migo] });
// 模拟 driveBattle：玩家结束 → 怪物召唤
let c = engine.battleCurrent(RID);
engine.battlePlayerAct(RID, 'p1', 'end');
let mr = engine.battleMonsterAct(RID);
let st = engine.battleStatus(RID);
check('米戈召唤出仆从（战场 2 个怪物）', st.monsters.length === 2, '数量=' + st.monsters.length);
check('召唤的仆从是无形之子', st.monsters[1].name.includes('无形之子'), st.monsters[1].name);
engine.battleReset(RID);

// ===== 2. SAN 消耗 → 疯狂 =====
const p2 = { ...player, san: 20, skills: { '禁忌咒': { ap: 2, damage: { base: 20, scale: 'magAtk', ratio: 0.5 }, sanCost: 200, cd: 0 } } };
engine.battleStart(RID, { players: [p2], monsters: [{ type: 'formless', name: '无形之子' }] });
engine.battleCurrent(RID);
const sk = engine.battlePlayerAct(RID, 'p1', { action: 'skill', skillId: '禁忌咒' });
st = engine.battleStatus(RID);
check('禁忌咒消耗 SAN（20→0）', st.units[0].san === 0, 'san=' + st.units[0].san);
check('SAN 归零进入疯狂状态', st.units[0].statuses.some(s => s.id === 'crazy'), JSON.stringify(st.units[0].statuses.map(s => s.id)));
// 疯狂后普攻伤害 -30%（对照：正常物攻 40 - 防 3 ≈ 37；疯狂 ×0.7 ≈ 25）
engine.battleCurrent(RID);
const atk = engine.battlePlayerAct(RID, 'p1', { action: 'attack' });
check('疯狂时普攻伤害约 -30%', atk.dmg >= 18 && atk.dmg <= 30, 'dmg=' + atk.dmg);
engine.battleReset(RID);

const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 通过`);
process.exit(fails ? 1 : 0);
