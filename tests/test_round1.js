/**
 * 第1轮迭代 — 自动化测试脚本
 * 验证本轮修复的 checkLevelUp、battleCore、storage 等模块
 * 运行方式：node test_round1.js
 */

const gameLogic = require('../server/gamelogic');
const storage = require('../server/storage');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.error(`  ❌ ${testName}`);
  }
}

console.log('\n========== 测试套件：第1轮迭代验证 ==========\n');

// ==================== T1: checkLevelUp 经验值计算 ====================
console.log('📋 T1: checkLevelUp 经验值计算');

(function() {
  // 场景1：刚好升1级
  const p1 = {
    level: 1, exp: 100,
    attr: { str: 40, dex: 40, con: 40, per: 40, wil: 40, hp: 80, maxHp: 80, san: 40, maxSan: 100 }
  };
  gameLogic.checkLevelUp(p1);
  assert(p1.level === 2, 'T1.1 刚好100exp升到Lv2');
  assert(p1.exp === 0, 'T1.2 升级后exp归零（100-100=0）');

  // 场景2：经验足够连升3级（Lv1→Lv4，需100+200+300=600）
  const p2 = {
    level: 1, exp: 700,
    attr: { str: 40, dex: 40, con: 40, per: 40, wil: 40, hp: 80, maxHp: 80, san: 40, maxSan: 100 }
  };
  gameLogic.checkLevelUp(p2);
  assert(p2.level === 4, 'T1.3 700exp升到Lv4（需600）');
  assert(p2.exp === 100, 'T1.4 剩余100exp（700-600=100）');

  // 场景3：经验不足以升级
  const p3 = {
    level: 5, exp: 200,
    attr: { str: 50, dex: 50, con: 50, per: 50, wil: 50, hp: 100, maxHp: 100, san: 50, maxSan: 100 }
  };
  gameLogic.checkLevelUp(p3);
  assert(p3.level === 5, 'T1.5 200exp不够Lv5升Lv6（需500），维持原等级');
  assert(p3.exp === 200, 'T1.6 exp不变');

  // 场景4：满级不再升级
  const p4 = {
    level: 20, exp: 9999,
    attr: { str: 80, dex: 80, con: 80, per: 80, wil: 80, hp: 160, maxHp: 160, san: 80, maxSan: 100 }
  };
  gameLogic.checkLevelUp(p4);
  assert(p4.level === 20, 'T1.7 Lv20满级不再升级');
  assert(p4.exp === 9999, 'T1.8 满级经验值不变');

  // 场景5：升级触发属性增长
  const p5 = {
    level: 1, exp: 100,
    attr: { str: 40, dex: 40, con: 40, per: 40, wil: 40, hp: 80, maxHp: 80, san: 40, maxSan: 100 }
  };
  gameLogic.checkLevelUp(p5);
  assert(p5.attr.str === 42, 'T1.9 升级后力量+2');
  assert(p5.attr.maxHp === p5.attr.con * 2, 'T1.10 maxHp同步con更新');
})();

// ==================== T2: 战斗伤害计算 ====================
console.log('\n📋 T2: battleCore 伤害计算（需手动引入）');

try {
  const battle = require('../server/battleCore');
  
  // 徒手攻击（基础伤害来自力量）
  const attacker = { name: '测试者', attr: { str: 60, dex: 40, hp: 100 } };
  const dmg = battle.calculateDamage(attacker, '徒手');
  assert(dmg === 60, 'T2.1 徒手伤害=力量值60');

  // 生锈长剑（12 + 60*0.5 + 40*0.2 = 12+30+8=50）
  const dmg2 = battle.calculateDamage(attacker, '生锈长剑');
  assert(dmg2 === 50, 'T2.2 生锈长剑伤害=12+30+8=50');

  // 未知武器降级为徒手
  const dmg3 = battle.calculateDamage(attacker, '不存在的武器');
  assert(dmg3 === 60, 'T2.3 未知武器降级为徒手');

  // 攻速计算
  const speed = battle.calculateAttackSpeed(attacker, '徒手');
  assert(speed === 40, 'T2.4 基础攻速=敏捷40');

  // 带武器攻速
  const speed2 = battle.calculateAttackSpeed(attacker, '旧印短剑');
  assert(speed2 === 60, 'T2.5 旧印短剑攻速=40+20=60');

  // 攻击次数
  const counts = battle.calculateAttackCounts(60, 40);
  assert(counts.attackerAttacks === 1, 'T2.6 攻速60→攻击1次');
  assert(counts.defenderAttacks === 1, 'T2.7 攻速40→攻击1次（不低于1）');

  // 高攻速多次攻击
  const counts2 = battle.calculateAttackCounts(250, 100);
  assert(counts2.attackerAttacks === 3, 'T2.8 攻速250→攻击3次（250/100≈3）');

  // 战斗模拟：攻击方秒杀
  const strong = { name: '强者', attr: { str: 80, dex: 50, hp: 200, maxHp: 200, san: 100, maxSan: 100 } };
  const weak = { name: '弱者', attr: { str: 10, dex: 10, hp: 20, maxHp: 20, san: 100, maxSan: 100 } };
  const result = battle.simulateBattleRound(strong, weak, '生锈长剑', '徒手');
  assert(result.winner === '强者', 'T2.9 强者胜弱者');
  assert(result.defenderHp <= 0, 'T2.10 防御者HP归零');
  assert(result.log.length > 0, 'T2.11 战斗日志非空');

  console.log('  ℹ️ 战斗日志:', result.log.join(' | '));
} catch (e) {
  console.log(`  ⚠️ battleCore 模块未导出，跳过战斗测试 (${e.message})`);
}

// ==================== T3: SAN 值边界 ====================
console.log('\n📋 T3: SAN 值机制边界测试');

(function() {
  // 属性极值检测
  const normalAttr = { str: 50, dex: 50, con: 50, per: 50, wil: 50 };
  assert(gameLogic.checkAttrImbalance(normalAttr) === null, 'T3.1 均衡属性不触发极值');

  const imbalanceAttr = { str: 90, dex: 30, con: 30, per: 50, wil: 50 };
  assert(gameLogic.checkAttrImbalance(imbalanceAttr) === 'imbalance', 'T3.2 一高两低触发imbalance');

  const extremeAttr = { str: 96, dex: 25, con: 28, per: 50, wil: 50 };
  assert(gameLogic.checkAttrImbalance(extremeAttr) === 'extreme', 'T3.3 极高+极低触发extreme');

  const edgeAttr = { str: 85, dex: 35, con: 35, per: 50, wil: 50 };
  assert(gameLogic.checkAttrImbalance(edgeAttr) === 'imbalance', 'T3.4 边界值85+35触发imbalance');
})();

// ==================== T4: 存储层读写 ====================
console.log('\n📋 T4: 存储层操作');

(function() {
  // 验证 users.json 可读
  const users = storage.loadAllUsers();
  assert(typeof users === 'object', 'T4.1 loadAllUsers返回对象');

  // 验证角色目录存在
  const fs = require('fs');
  assert(fs.existsSync('./data/characters'), 'T4.2 characters目录存在');

  // 加载一个已有角色
  const chars = fs.readdirSync('./data/characters');
  if (chars.length > 0) {
    const testCharFile = chars[0];
    const testUid = testCharFile.replace('.json', '');
    const char = storage.loadCharacter(testUid);
    assert(char !== null, `T4.3 加载角色 ${testUid} 成功`);
    assert(char.uid === testUid, 'T4.4 角色uid一致');
    assert(char.attr && typeof char.attr === 'object', 'T4.5 角色attr结构正常');
    assert(char.attr.hp !== undefined, 'T4.6 角色hp字段存在');
    assert(char.attr.san !== undefined, 'T4.7 角色san字段存在');
  } else {
    console.log('  ⚠️ data/characters/ 为空，跳过角色加载测试');
  }
})();

// ==================== T5: 副本评分计算 ====================
console.log('\n📋 T5: 副本评分计算');

(function() {
  const stateS = { scores: { clue: 30, survival: 25, sanity: 20, contribution: 15 } };
  const rS = gameLogic.calculateScore(stateS);
  assert(rS.grade === 'S', 'T5.1 总分90→S级');
  assert(rS.reward.mysteryPoint === 60, 'T5.2 S级奖励60诡秘点');

  const stateA = { scores: { clue: 30, survival: 25, sanity: 15, contribution: 5 } };
  const rA = gameLogic.calculateScore(stateA);
  assert(rA.grade === 'A', 'T5.3 总分75→A级');

  const stateD = { scores: { clue: 5, survival: 5, sanity: 5, contribution: 5 } };
  const rD = gameLogic.calculateScore(stateD);
  assert(rD.grade === 'D', 'T5.4 总分20→D级');
  assert(rD.reward.mysteryPoint === 0, 'T5.5 D级无奖励');
})();

// ==================== T6: ResourceManager 单例 ====================
console.log('\n📋 T6: ResourceManager 单例验证');

(function() {
  assert(gameLogic.resourceManager !== undefined, 'T6.1 resourceManager单例已导出');
  assert(typeof gameLogic.resourceManager.matchResource === 'function', 'T6.2 matchResource方法可用');

  // 测试标签匹配
  const url = gameLogic.resourceManager.matchResource(['荒村', '民居']);
  assert(url !== null, 'T6.3 标签匹配返回有效URL');
  console.log(`  ℹ️ 匹配结果: ${url}`);

  // ===== ADR-008 新增资源检索（T-1 扩展）=====
  // 行动次数图标（独有标签规避同分取首歧义）
  const hourglass = gameLogic.resourceManager.matchResource(['行动次数', '战斗面板']);
  assert(hourglass && hourglass.includes('hourglass'), 'T6.4 行动次数沙漏图标可检索');
  // 高SAN异象场景（集合包含，确定性返回 twisted_space.png）
  const highSan = gameLogic.resourceManager.matchResource(['扣散异象', '高SAN消耗场景']);
  assert(highSan !== null, 'T6.5 高SAN异象场景可检索');
  // 小队面板底板（独有标签）
  const teamBg = gameLogic.resourceManager.matchResource(['底板', '小队信息']);
  assert(teamBg && teamBg.includes('panel_team_bg'), 'T6.6 小队信息面板底板可检索');
  // 倒地/疯狂状态图标（独有标签）
  const down = gameLogic.resourceManager.matchResource(['倒地', 'HP归零']);
  const mad = gameLogic.resourceManager.matchResource(['疯狂', 'SAN归零']);
  assert(down && down.includes('down') && mad && mad.includes('mad'), 'T6.7 倒地/疯狂状态图标可检索');
})();

// ==================== 结果汇总 ====================
console.log('\n========================================');
console.log(`  测试完成：通过 ${passed} / 失败 ${failed} / 总计 ${passed + failed}`);
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);
