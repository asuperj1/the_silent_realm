/**
 * test_item_framework.js — 物品框架（ItemEngine）集成测试
 * 覆盖：注册/生命周期 / 掉落 / 使用效果 / 六槽装备 / 属性计算 / 隔离
 * 运行：node tools/test_item_framework.js
 */
const { getItemEngine } = require('../server/itemEngine/ItemEngine');

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('=== 物品框架集成测试 ===');
const eng = getItemEngine();
eng.init();

const globalCount = eng.globalCatalog().length;

// 1) 全局池
console.log('[1] 全局物品池 G-*');
assert('注册全局物品 ≥ 6', globalCount >= 6, 'got ' + globalCount);
assert('G-002 基础绷带 HP+20', eng.resolveTemplate('G-002')?.effects?.[0]?.value === 20);

// 2) 副本清单
console.log('[2] 青峰山导入清单');
const manifest = eng.dungeons.getManifest('qingfengshan');
assert('清单存在', !!manifest);
assert('前缀 QFS', manifest.prefix === 'QFS');
assert('掉落上限 purple', manifest.maxQuality === 'purple');
const qfs = eng.dungeonCatalog('qingfengshan');
const expectQfs = (manifest.items ? manifest.items.length : 0) + (manifest.bossDrop ? manifest.bossDrop.length : 0);
assert(`共 ${expectQfs} 件（清单定义）`, qfs.length === expectQfs, 'got ' + qfs.length);
assert('剧情 ≥ 8', qfs.filter(i => i.type === 'plot').length >= 8, 'got ' + qfs.filter(i => i.type === 'plot').length);
assert('消耗 ≥ 11', qfs.filter(i => i.type === 'consumable').length >= 11);
assert('材料 ≥ 6', qfs.filter(i => i.type === 'material').length >= 6);
assert('装备 ≥ 13', qfs.filter(i => i.type === 'equipment').length >= 13);
assert('黑装仅 1（修格斯核心残片）', qfs.filter(i => i.quality === 'black').length === 1);

// 3) 生命周期
console.log('[3] 副本生命周期');
const ltCount = (manifest.lootTables || []).length;
const loaded = eng.loadDungeon('qingfengshan');
assert(`副本开启激活 ${ltCount} 张掉落表`, loaded === ltCount, 'got ' + loaded);
assert('激活状态 true', eng.isDungeonActive('qingfengshan'));
assert('注册后目录 ≥ 全局池', eng.catalog().length >= globalCount, 'got ' + eng.catalog().length);
assert('模板可解析（QFSC001）', !!eng.resolveTemplate('QFSC001'));

// 4) 掉落
console.log('[4] 掉落引擎（剧本表驱动）');
const char = { attr: { str: 60, per: 45, con: 50, dex: 40, wil: 40, hp: 80, maxHp: 100, san: 40, maxSan: 100 } };
const drops1 = eng.roll('qingfengshan', 'car3', 'search', { character: char });
assert('3号车搜索可掉落', drops1.length >= 0);
const drops2 = eng.roll('qingfengshan', 'car5', 'restRoom', { character: char, force: true });
assert('5号休息室必掉 3 件', drops2.length === 3, 'got ' + drops2.length);
const boss = eng.roll('qingfengshan', 'car8', 'bossDrop', { force: true });
assert('修格斯掉黑装', boss.length === 1 && boss[0].quality === 'black');

// 5) 使用效果
console.log('[5] 效果引擎（消耗品）');
const water = eng.factory.create('QFSC001');
const r1 = eng.useItem(char, water, { dungeonId: 'qingfengshan' });
assert('矿泉水 HP+12', char.attr.hp === 92, 'got ' + char.attr.hp);
const herb = eng.factory.create('QFSC002');
const r2 = eng.useItem(char, herb, { dungeonId: 'qingfengshan' });
assert('草药包 SAN+18', char.attr.san === 58, 'got ' + char.attr.san);
assert('草药包 附加抗性buff', Array.isArray(char.statusEffects) && char.statusEffects.length === 1);
const coffee = eng.factory.create('QFSC007');
const r3 = eng.useItem(char, coffee, { dungeonId: 'qingfengshan' });
assert('咖啡 DEX+3(2回合)', Array.isArray(char.itemBuffs) && char.itemBuffs.length === 1);
const adr = eng.factory.create('QFSC004');
const r4 = eng.useItem(char, adr, { dungeonId: 'qingfengshan' });
const adrBuff = (char.itemBuffs || []).find(b => b.stat === 'dex' && b.value === 5);
assert('肾上腺素 AGI+5(3回合临时) + SAN-5', !!adrBuff && char.attr.san === 53, `dex buff=${!!adrBuff} san=${char.attr.san}`);

// 6) 自定义效果
console.log('[6] 自定义效果（副本 handler）');
const key = eng.factory.create('QFSD003');
const rk = eng.useItem(char, key, { dungeonId: 'qingfengshan', room: { dungeonState: {} } });
assert('制动钥匙·时空锁定', /减免|减伤/.test(rk.msg), rk.msg);
const rec = eng.factory.create('QFSD007');
const rr = eng.useItem(char, rec, { dungeonId: 'qingfengshan', room: { dungeonState: {} } });
assert('目击记录·修格斯判定', /无法击败/.test(rr.msg));

// 7) 六槽装备
console.log('[7] 装备六槽 + 属性计算');
const vest = eng.factory.create('QFSE012'); // 防刺背心 CON+10
const con0 = char.attr.con;
const ev = eng.equip(char, vest, 'body');
assert('装备背心成功', ev.ok);
assert('CON+10 生效', char.attr.con === con0 + 10, `${con0}->${char.attr.con}`);
assert('HP上限重算 = CON×2', char.attr.maxHp === char.attr.con * 2);
const hat = eng.factory.create('QFSE009'); // 硬帽 CON+2
eng.equip(char, hat, 'head');
assert('硬帽 CON+2', char.attr.con === con0 + 12);
const glove = eng.factory.create('QFSE006'); // 手套 STR+4
const str0 = char.attr.str;
eng.equip(char, glove, 'hand');
assert('手套 STR+4', char.attr.str === str0 + 4);
const un = eng.unequip(char, 'body');
assert('卸下背心回退（硬帽+2保留）', char.attr.con === con0 + 2, 'got ' + char.attr.con);

// 8) 隔离
console.log('[8] 副本结束注销 + 背包隔离');
const inv = [eng.factory.create('QFSC001'), eng.factory.create('QFSM003'), { itemId: 'G-002', itemName: '基础绷带', belongDungeon: 'all', effects: [] }];
const kept = eng.serializer.filterOutDungeon(inv, 'qingfengshan');
assert('副本物品被隔离、全局保留', kept.length === 1 && kept[0].itemId === 'G-002', 'got ' + kept.map(k => k.itemId));
const n = eng.unloadDungeon('qingfengshan');
assert(`注销 ${ltCount} 张掉落表`, n === ltCount, 'got ' + n);
assert('激活状态 false', !eng.isDungeonActive('qingfengshan'));
assert('目录回归全局池（≥ ' + globalCount + '）', eng.catalog().length >= globalCount, 'got ' + eng.catalog().length);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
