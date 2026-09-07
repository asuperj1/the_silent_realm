/**
 * add_energy_dice.js — 为 config/professions.json 全部职业添加 energyDice（战斗能量骰）
 * 依据 docs/战斗行为系统1.0.docx 第五部分：
 *   2D6：武士/诡术小丑/警官；4D6：炼金术士；3D6：侦探；其余新职业/旧职业默认 3D6
 * 用法：node tools/add_energy_dice.js
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'config', 'professions.json');
const list = JSON.parse(fs.readFileSync(file, 'utf8'));

// 文档指定骰子
const SPEC = {
  wushi: '2D6', guishuxiaochou: '2D6', jingguan: '2D6',
  lianjinshushi: '4D6', zhentan: '3D6'
};

let added = 0;
for (const p of list) {
  const dice = SPEC[p.id] || '3D6';
  if (p.energyDice === dice) continue;
  p.energyDice = dice;
  added++;
}
fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
console.log(`done: added/updated energyDice for ${added} professions, total ${list.length}`);
