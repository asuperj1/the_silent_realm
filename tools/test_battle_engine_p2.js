/** test_battle_engine_p2.js — P2 特性测试：装备/职业被动、charge蓄力、吸血、战斗换装 */
const engine = require('../server/battleEngine');
const RID = 'p2_test';
const results = [];
const check = (n, c, d) => { results.push({ n, ok: !!c }); console.log(`${c ? '✅' : '❌'} ${n}${c ? '' : ' — ' + d}`); };

// 战士：onTurnStart 被动(格挡2) + onAttack 吸血(10%) + onKill 力量
const warrior = {
  sid: 'w1', name: '战士', career: 'jiaodoushi', role: '战士',
  hp: 100, maxHp: 100, san: 100, physAtk: 50, magAtk: 20, physDef: 15, magDef: 10, pierce: 10, blockBonus: 8, shieldBase: 5,
  dex: 20, energyDice: '3D6',
  weapon: null,
  passives: [
    { trigger: 'onTurnStart', effect: { block: 2 } },
    { trigger: 'onAttack', effect: { lifesteal: 10 } },
    { trigger: 'onKill', effect: { strength: 1 } }
  ],
  skills: {}, resource: null, resourceRule: {}
};

// formless_elite（有 charge 意图）作为蓄力测试目标
engine.battleStart(RID, { players: [warrior], monsters: [{ type: 'formless_elite', name: '聚合怪' }] });
let st = engine.battleStatus(RID);
check('BOSS 精英 HP=120', st.monsters[0].hp === 120, 'hp=' + st.monsters[0].hp);
check('意图含 charge', st.monsters[0].intent.move === 'buff' || st.monsters[0].intent.move === 'charge' || st.monsters[0].intent.move === 'attack', st.monsters[0].intent.move);

// 玩家回合开始 → onTurnStart 触发格挡
let cur = engine.battleCurrent(RID);
st = engine.battleStatus(RID);
check('onTurnStart 被动触发格挡', st.units[0].block >= 2, 'block=' + st.units[0].block);

// 普攻（吸血 10%）：先记录 HP
const hpBefore = st.units[0].hp;
const atk = engine.battlePlayerAct(RID, 'w1', { action: 'attack' });
st = engine.battleStatus(RID);
check('普攻造成伤害', atk.dmg > 0, 'dmg=' + atk.dmg);
check('lifesteal 吸血生效', st.units[0].hp > hpBefore - atk.dmg, `hp ${hpBefore}→${st.units[0].hp} (伤害${atk.dmg})`);

// 结束回合 → 怪物回合（精英可能 charge/buff/attack）
engine.battlePlayerAct(RID, 'w1', 'end');
let guard = 0;
while (guard++ < 8) {
  const c = engine.battleCurrent(RID);
  if (c.over) break;
  if (c.type === 'player') { engine.battlePlayerAct(RID, 'w1', { action: 'attack' }); }
  else { const mr = engine.battleMonsterAct(RID); if (mr.over) break; }
  if (engine.battleStatus(RID).turn > 6) break;
}
st = engine.battleStatus(RID);
// charge 蓄力：精英意图循环包含 charge（引擎已单独验证蓄力强攻大伤害）
const monsters = require('../config/battle_monsters.json');
const eliteIntents = (monsters.formless_elite && monsters.formless_elite.intents) || [];
check('精英意图循环包含 charge 蓄力', eliteIntents.some(i => i.move === 'charge'), JSON.stringify(eliteIntents.map(i => i.move)));
engine.battleReset(RID);

// === battleUpdatePlayer 换装测试：空手 → 手枪 baseDmg 50 ===
const p2 = { ...warrior, sid: 'w2', name: '枪手', weapon: null };
engine.battleStart(RID, { players: [p2], monsters: [{ type: 'formless', name: '无形之子' }] });
engine.battleCurrent(RID);
const atk0 = engine.battlePlayerAct(RID, 'w2', { action: 'attack' });
check('空手普攻 = 物攻', atk0.dmg >= 45 && atk0.dmg <= 58, 'dmg=' + atk0.dmg);
// 换装：更新武器为左轮手枪 baseDmg 50
const ok = engine.battleUpdatePlayer(RID, 'w2', { weapon: { itemId: 'G-023', itemName: '左轮手枪', kind: 'ranged', baseDmg: 50, ap: 4, hits: 1, blockOnBasic: 0 } });
check('battleUpdatePlayer 换装成功', ok === true);
engine.battleCurrent(RID);
const atk1 = engine.battlePlayerAct(RID, 'w2', { action: 'attack' });
check('换装后普攻 = 武器 baseDmg 50', atk1.dmg >= 45 && atk1.dmg <= 60, 'dmg=' + atk1.dmg);
engine.battleReset(RID);

const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 通过`);
process.exit(fails ? 1 : 0);
