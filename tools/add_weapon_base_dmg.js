/**
 * add_weapon_base_dmg.js — 为现有武器配置注入 baseDmg/ap/hits（v2.1 §6.2/§6.4）
 * 运行：node tools/add_weapon_base_dmg.js
 */
const fs = require('fs');
const path = require('path');

// 武器 itemId → { baseDmg, ap, hits }
const MAP = {
  'G-023': { baseDmg: 50, ap: 4, hits: 1 },   // 左轮手枪 blue ranged
  'G-024': { baseDmg: 24, ap: 3, hits: 1 },   // 猎刀 green melee
  'QFSE001': { baseDmg: 26, ap: 3, hits: 1 }, // 列车撬棍 green melee
  'QFSE002': { baseDmg: 18, ap: 3, hits: 1 }, // 生锈拆解刀 white melee
  'QFSE003': { baseDmg: 34, ap: 4, hits: 2 }, // 简易手枪 green ranged
  'QFSE004': { baseDmg: 55, ap: 4, hits: 1 }, // 双管霰弹枪 blue ranged
  'QFSE013': { baseDmg: 72, ap: 3, hits: 1 }  // 修格斯核心残片 black melee
};

const files = [
  path.join(__dirname, '..', 'config', 'items', 'global_items.json'),
  path.join(__dirname, '..', 'config', 'items', 'dungeons', 'qingfengshan.json')
];

let changed = 0;
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const list = Array.isArray(data) ? data : (data.items || []);
  let dirty = false;
  for (const item of list) {
    if (!item || item.slot !== 'weapon') continue;
    const v = MAP[item.itemId];
    if (!v) continue;
    item.baseDmg = v.baseDmg;
    item.ap = v.ap;
    item.hits = v.hits;
    changed++;
    dirty = true;
  }
  if (dirty) fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
}
console.log(`已为 ${changed} 把武器注入 baseDmg/ap/hits`);
