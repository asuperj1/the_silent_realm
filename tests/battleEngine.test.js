/**
 * battleEngine.js 单测（Node 内置 node:test，零依赖）
 * 运行：node --test tests/battleEngine.test.js
 *
 * 覆盖：战斗初始化 / 尖塔式队伍回合 AP 掷骰 / 能量不足拦截 / 已行动拦截 /
 *       技能冷却拦截 / 击杀结算 / battleStatus 结构
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const BE = require('../server/battleEngine');

let roomSeq = 0;
function mkPlayer(sid, o = {}) {
  return Object.assign({
    sid, name: '测试' + sid, career: '方士', role: '法师',
    hp: 80, maxHp: 80, san: 100,
    physAtk: 100, magAtk: 100, physDef: 10, magDef: 10,
    pierce: 0, blockBonus: 0, shieldBase: 0,
    dex: 20, energyDice: '3D6',
    weapon: { name: '测试武器', baseDmg: 20, ap: 2, hits: 1 },
    skills: {}
  }, o);
}
function startBattle(players, monsters = [{ type: 'formless' }]) {
  const rid = 'test_room_' + (++roomSeq);
  BE.battleStart(rid, { players, monsters });
  return rid;
}

describe('battleEngine', () => {
  test('battleStart 创建战斗：玩家/怪物数量正确', () => {
    const rid = startBattle([mkPlayer('a'), mkPlayer('b')], [{ type: 'formless' }, { type: 'formless' }]);
    const st = BE.battleStatus(rid);
    assert.ok(st.started);
    assert.strictEqual(st.units.length, 2);
    assert.strictEqual(st.monsters.length, 2);
    assert.strictEqual(st.phase, 'player');
  });

  test('battleCurrent 尖塔式队伍回合：掷出 AP（>0）且 teamTurn', () => {
    const rid = startBattle([mkPlayer('a', { energyDice: '3D6' })]);
    const cur = BE.battleCurrent(rid);
    assert.strictEqual(cur.over, false);
    assert.strictEqual(cur.teamTurn, true);
    const st = BE.battleStatus(rid);
    const me = st.units.find(u => u.sid === 'a');
    assert.ok(me.ap > 0, '应已为存活玩家掷出 AP');
  });

  test('能量不足拦截：换装 cost 99 超出 AP → 拒绝且不算行动', () => {
    const rid = startBattle([mkPlayer('a')]);
    BE.battleCurrent(rid);
    const r = BE.battlePlayerAct(rid, 'a', { action: 'equip', slot: 'weapon', cost: 99 });
    assert.strictEqual(r.ok, false);
    assert.match(r.msg, /能量不足/);
    const st = BE.battleStatus(rid);
    assert.strictEqual(st.units[0].acted, false, '失败操作不应标记已行动');
  });

  test('已行动拦截：end 后再次攻击被拒', () => {
    const rid = startBattle([mkPlayer('a')]);
    BE.battleCurrent(rid);
    const r1 = BE.battlePlayerAct(rid, 'a', 'end');
    assert.strictEqual(r1.ok, true);
    const r2 = BE.battlePlayerAct(rid, 'a', { action: 'attack' });
    assert.strictEqual(r2.ok, false);
    assert.match(r2.msg, /已结束行动/);
  });

  test('技能冷却拦截：首次施放设 CD，再次施放被拒', () => {
    const skill = { ap: 1, cd: 2, target: 'single', type: 'attack' };
    const rid = startBattle([mkPlayer('a', { energyDice: '4D6', skills: { 测试技能: skill } })]);
    BE.battleCurrent(rid);
    const r1 = BE.battlePlayerAct(rid, 'a', { action: 'skill', skillId: '测试技能' });
    assert.strictEqual(r1.ok, true, '首次施放应成功');
    const r2 = BE.battlePlayerAct(rid, 'a', { action: 'skill', skillId: '测试技能' });
    assert.strictEqual(r2.ok, false);
    assert.match(r2.msg, /冷却/);
  });

  test('击杀结算：高伤害武器一击击杀 → over:true win:true', () => {
    // baseDmg=100 → 单次伤害 97 > 55 HP；energyDice 3D6 保证 AP≥3 够普攻
    const rid = startBattle([mkPlayer('a', { weapon: { name: '重锤', baseDmg: 100, ap: 2, hits: 1 } })], [{ type: 'formless' }]);
    BE.battleCurrent(rid);
    const r = BE.battlePlayerAct(rid, 'a', { action: 'attack' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.over, true);
    assert.strictEqual(r.win, true);
  });

  test('battleStatus 结构完整（units/monsters/turn/phase/energyDice）', () => {
    const rid = startBattle([mkPlayer('a')]);
    BE.battleCurrent(rid);
    const st = BE.battleStatus(rid);
    assert.ok(Array.isArray(st.units));
    assert.ok(Array.isArray(st.monsters));
    assert.strictEqual(typeof st.turn, 'number');
    assert.ok(['player', 'monster'].includes(st.phase));
    assert.ok(st.units[0].energyDice, '应有 energyDice 供前端掷骰展示');
  });
});
