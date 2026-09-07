/**
 * dungeonFramework.js 单测（Node 内置 node:test，零依赖）
 * 运行：node --test tests/dungeonFramework.test.js
 *
 * 覆盖：注册表解析 / 状态工厂 / 空间系统 / 怪物触发门控 / 线索目录 / 真相层级 / 副本回顾 / 专属引擎
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const DF = require('../server/dungeonFramework');

const QF_ID = 'qingfeng_train_800';
const QF_NAME = '废都纪元800｜青峰山虚空列车';

describe('dungeonFramework', () => {
  test('resolveDungeon 按副本名解析', () => {
    const cfg = DF.resolveDungeon(QF_NAME);
    assert.ok(cfg);
    assert.strictEqual(cfg.id, QF_ID);
    assert.strictEqual(DF.resolveDungeon('不存在的副本'), null);
  });

  test('getDungeonConfig 按 id 取配置', () => {
    assert.strictEqual(DF.getDungeonConfig(QF_ID).name, QF_NAME);
    assert.strictEqual(DF.getDungeonConfig('no_such'), null);
  });

  test('createDungeonState：初始状态 + 专属字段 + 深拷贝不共享', () => {
    const s1 = DF.createDungeonState(DF.getDungeonConfig(QF_ID));
    const s2 = DF.createDungeonState(DF.getDungeonConfig(QF_ID));
    assert.strictEqual(s1.currentCar, 'car_4_dining');
    assert.strictEqual(s1.truthTier, 0);
    assert.deepStrictEqual(s1.cluesFound, []);
    assert.strictEqual(s1.miGoDeceived, true);           // 专属字段（initialState）
    assert.ok(s1.chenHui && s1.chenHui.alive);           // 专属字段
    assert.strictEqual(s1.dungeonConfigId, QF_ID);       // 框架注册 id
    // 深拷贝防共享：修改 s1 不影响 s2
    s1.carStates.car_1_cab.visited = true;
    s1.cluesFound.push('L1');
    assert.strictEqual(s2.carStates.car_1_cab.visited, false);
    assert.deepStrictEqual(s2.cluesFound, []);
  });

  test('空间系统：邻接 / 标签', () => {
    const cfg = DF.getDungeonConfig(QF_ID);
    assert.deepStrictEqual(DF.getAdjacent(cfg, 'car_4_dining'), ['car_3_luggage', 'car_5_sleeper']);
    assert.strictEqual(DF.getSpaceLabel(cfg, 'car_8_cabin'), '8号车');
    assert.deepStrictEqual(DF.getAdjacent(cfg, 'no_space'), []);
  });

  test('怪物触发：门控（5号车需 formlessTriggered）/ 清除标记 / 修格斯', () => {
    const cfg = DF.getDungeonConfig(QF_ID);
    const s = DF.createDungeonState(cfg);
    assert.strictEqual(DF.getSpaceMonsters(cfg, 'car_3_luggage', s).length, 1);   // 直接出怪
    assert.strictEqual(DF.getSpaceMonsters(cfg, 'car_5_sleeper', s).length, 0);   // 门控未触发
    s.carStates.car_5_sleeper.formlessTriggered = true;
    assert.strictEqual(DF.getSpaceMonsters(cfg, 'car_5_sleeper', s).length, 1);   // 门控触发
    s.carStates.car_5_sleeper.clearedSpawn = true;
    assert.strictEqual(DF.getSpaceMonsters(cfg, 'car_5_sleeper', s).length, 0);   // 已清
    assert.strictEqual(DF.getSpaceMonsters(cfg, 'car_8_cabin', s).length, 1);     // 修格斯
  });

  test('线索目录', () => {
    const cfg = DF.getDungeonConfig(QF_ID);
    assert.strictEqual(DF.getClue(cfg, 'L1').name, '线索·乘客护照');
    assert.strictEqual(DF.getClue(cfg, 'L8').icon, '🗺️');
    assert.strictEqual(DF.getClue(cfg, 'L99'), null);
    assert.ok(Object.keys(DF.getClueCatalog(cfg)).length >= 8);
  });

  test('真相层级：按线索数驱动（3→1, 5→2, 7→3 并解除欺骗）', () => {
    const cfg = DF.getDungeonConfig(QF_ID);
    const s = DF.createDungeonState(cfg);
    s.cluesFound = ['L1', 'L2', 'L3'];
    DF.updateTruthTier(cfg, s);
    assert.strictEqual(s.truthTier, 1);
    s.cluesFound.push('L4', 'L5');
    DF.updateTruthTier(cfg, s);
    assert.strictEqual(s.truthTier, 2);
    s.cluesFound.push('L6', 'L7');
    DF.updateTruthTier(cfg, s);
    assert.strictEqual(s.truthTier, 3);
    assert.strictEqual(s.miGoDeceived, false);
  });

  test('副本回顾：线索/真相标签/回合', () => {
    const cfg = DF.getDungeonConfig(QF_ID);
    const s = DF.createDungeonState(cfg);
    s.cluesFound = ['L1', 'L3'];
    s.truthTier = 1;
    s.turn = 8;
    const rv = DF.buildReview(cfg, s);
    assert.strictEqual(rv.clues.length, 2);
    assert.strictEqual(rv.truthLabel, '碎片拾取');
    assert.strictEqual(rv.turns, 8);
  });

  test('专属引擎加载（qingfengTrain）', () => {
    const engine = DF.loadEngine(DF.getDungeonConfig(QF_ID));
    assert.ok(engine);
    assert.strictEqual(typeof engine.walkieTalkie, 'function');
    assert.strictEqual(DF.loadEngine(null), null);
    assert.strictEqual(DF.loadEngine({ engine: 'no_such_module' }), null);
  });
});
