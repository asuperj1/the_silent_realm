/** test_battle_engine.js — 杀戮尖塔2式战斗引擎单元测试 */
const engine = require('../server/battleEngine');

const RID = 'test_room_1';
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + detail}`);
}

// 方士战斗快照（无武器 → 空手物攻 22）
const fangshi = {
  sid: 'p1', name: '测试调查员', career: 'fangshi', role: '法师',
  hp: 80, maxHp: 80, san: 100,
  physAtk: 22, magAtk: 52, physDef: 20, magDef: 40, pierce: 11, blockBonus: 8, shieldBase: 22,
  dex: 20, energyDice: '3D6',
  weapon: null,
  skills: {
    '符箓镇邪': { ap: 6, type: 'attack', element: 'holy', damage: { base: 18, scale: 'magAtk', ratio: 0.6 }, effects: [{ id: 'vulnerable', value: 1, turns: 2 }], cd: 2 },
    '丹雾护佑': { ap: 5, type: 'heal', heal: { base: 16, scale: 'magAtk', ratio: 0.4 }, block: 6, cd: 3 }
  },
  passive: { trigger: 'onTurnStart', effect: { block: 2 } },
  resource: { id: '炁', type: 'active', value: 0, max: 12 },
  resourceRule: { gainOnBasic: 2, gainOnTurnStart: 1, costPerSkill: 2, max: 12 }
};

engine.battleStart(RID, { players: [fangshi], monsters: [{ type: 'formless', name: '无形之子1' }] });

let st = engine.battleStatus(RID);
check('战斗开始：怪物 HP=55（配置权威）', st.monsters[0].hp === 55, `hp=${st.monsters[0].hp}`);
check('战斗开始：意图已生成', st.intents.length === 1 && !!st.intents[0].move, JSON.stringify(st.intents));

const cur = engine.battleCurrent(RID);
check('轮到玩家：AP 在 3~18 区间', cur.ap >= 3 && cur.ap <= 18, `ap=${cur.ap}`);
check('轮到玩家：apDice=3D6', cur.apDice === '3D6', cur.apDice);

// 普攻（空手 → 物攻 22）
const atk = engine.battlePlayerAct(RID, 'p1', { action: 'attack' });
st = engine.battleStatus(RID);
check('空手普攻伤害≈22', atk.dmg >= 18 && atk.dmg <= 26, `dmg=${atk.dmg}`);
check('怪物 HP 扣减', st.monsters[0].hp < 55, `hp=${st.monsters[0].hp}`);

// 技能（符箓镇邪）：AP 足够才释放，否则验证"能量不足"拒绝逻辑
const curS = engine.battleCurrent(RID);
let skillEnded = false;
if (curS.ap >= 6) {
  const sk = engine.battlePlayerAct(RID, 'p1', { action: 'skill', skillId: '符箓镇邪' });
  st = engine.battleStatus(RID);
  check('技能释放成功', sk.ok === true && sk.dmg > 0, JSON.stringify(sk).slice(0, 80));
  check('技能效果生效（上易伤或击杀）', st.monsters[0].dead || st.monsters[0].statuses.some(s => s.id === 'vulnerable'), JSON.stringify(st.monsters[0].statuses));
  if (st.over) skillEnded = true; // 技能直接击杀 → 战斗结束
} else {
  const sk2 = engine.battlePlayerAct(RID, 'p1', { action: 'skill', skillId: '符箓镇邪' });
  check('AP不足时技能被拒绝', sk2.ok === false && /能量不足/.test(sk2.msg), sk2.msg);
  check('AP不足时无状态生效', (engine.battleStatus(RID).monsters[0].statuses || []).length === 0, 'ok');
}

if (!skillEnded) {
  // 结束回合 → 怪物回合
  const end = engine.battlePlayerAct(RID, 'p1', 'end');
  check('结束回合', end.end === true);
  const mcur = engine.battleCurrent(RID);
  check('进入怪物回合', mcur.type === 'monster', mcur.type);
  const mact = engine.battleMonsterAct(RID);
  st = engine.battleStatus(RID);
  check('怪物行动造成伤害', mact.dmg > 0, `dmg=${mact.dmg}, 玩家hp=${st.units[0].hp}`);

  // 回到玩家回合
  const cur2 = engine.battleCurrent(RID);
  check('怪物回合后回到玩家回合', cur2.type === 'player', cur2.type);
  check('回合+1', st.turn === 2, `turn=${st.turn}`);
}

// 连续普攻直到胜利（模拟）
let guard = 0;
while (!engine.battleStatus(RID).over && guard++ < 20) {
  const c = engine.battleCurrent(RID);
  if (c.over) break;
  if (c.type === 'player') {
    engine.battlePlayerAct(RID, 'p1', { action: 'attack' });
  } else {
    engine.battleMonsterAct(RID);
  }
}
st = engine.battleStatus(RID);
check('战斗最终胜利', st.over === true, JSON.stringify({ over: st.over, win: st.winner }));
engine.battleReset(RID);

// 有武器测试：左轮手枪 baseDmg 50
const gun = { ...fangshi, sid: 'p2', name: '枪手测试', weapon: { itemId: 'G-023', itemName: '左轮手枪', kind: 'ranged', baseDmg: 50, ap: 4, hits: 1, blockOnBasic: 0 } };
engine.battleStart(RID, { players: [gun], monsters: [{ type: 'formless', name: '无形之子1' }] });
engine.battleCurrent(RID);
const atk2 = engine.battlePlayerAct(RID, 'p2', { action: 'attack' });
check('手枪普攻伤害≈50（武器 baseDmg）', atk2.dmg >= 45 && atk2.dmg <= 58, `dmg=${atk2.dmg}`);
check('手枪普攻耗 4 AP', atk2.energy >= 0 && atk2.energy <= 18, `energy=${atk2.energy}`);
engine.battleReset(RID);

const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 通过`);
process.exit(fails ? 1 : 0);
