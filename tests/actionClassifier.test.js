/**
 * actionClassifier.js 单测（Node 内置 node:test，零依赖）
 * 运行：node --test tests/actionClassifier.test.js
 *
 * 覆盖：敏感词 / 元游戏指令 / 无关命令 三级拦截、白名单合法行动放行、
 *       克苏鲁合法题材不误伤、敏感词脱敏、空输入
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const AC = require('../server/actionClassifier');

describe('actionClassifier.checkRejection', () => {
  test('敏感词拦截（最高优先级）', () => {
    const r = AC.checkRejection('你就是个傻逼吧');
    assert.strictEqual(r.rejected, true);
    assert.strictEqual(r.type, 'sensitive');
    assert.ok(r.matched.length > 0);
  });

  test('涉政敏感词拦截', () => {
    const r = AC.checkRejection('支持台独的都是垃圾');
    assert.strictEqual(r.rejected, true);
    assert.strictEqual(r.type, 'sensitive');
  });

  test('元游戏指令拦截（开挂/退出游戏）', () => {
    const r = AC.checkRejection('我要开挂改存档');
    assert.strictEqual(r.rejected, true);
    assert.strictEqual(r.type, 'meta');
  });

  test('无关命令拦截（跳舞）', () => {
    const r = AC.checkRejection('我在这里跳舞可以吗');
    assert.strictEqual(r.rejected, true);
    assert.strictEqual(r.type, 'irrelevant');
  });

  test('白名单合法行动放行（前往/检查）', () => {
    const r = AC.checkRejection('前往 2号车检查车厢');
    assert.strictEqual(r.rejected, false);
  });

  test('克苏鲁合法题材不误伤（念咒/施法）', () => {
    const r = AC.checkRejection('翻开魔法书念咒语');
    assert.strictEqual(r.rejected, false);
  });

  test('空输入不拦截', () => {
    assert.strictEqual(AC.checkRejection('').rejected, false);
    assert.strictEqual(AC.checkRejection('   ').rejected, false);
  });

  test('maskSensitive 将命中词脱敏为 ***', () => {
    const content = '你就是个傻逼吧';
    const r = AC.checkRejection(content);
    const masked = AC.maskSensitive(content, r.matched);
    assert.ok(!masked.includes('傻逼'));
    assert.ok(masked.includes('***'));
  });
});
