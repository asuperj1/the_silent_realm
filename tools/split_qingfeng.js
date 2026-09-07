// split_qingfeng.js — 将 qingfengTrain.js 的结局结算拆到 qingfengEnding.js
const fs = require('fs');
const src = fs.readFileSync('server/qingfengTrain.js', 'utf8');
const endStart = src.indexOf('// ==================== 结局结算');
const expStart = src.indexOf('// ==================== 模块导出');
if (endStart < 0 || expStart < 0 || expStart < endStart) { console.error('锚点定位失败', { endStart, expStart }); process.exit(1); }

const head = src.slice(0, endStart);          // 结局结算之前（含 calculatePoisonDamage）
const endingBlock = src.slice(endStart, expStart); // calculateEnding + getEndingRewards
const tail = src.slice(expStart);             // 模块导出

const endingFile = `/**
 * qingfengEnding.js — 青峰山结局结算（2026-08-16 从 qingfengTrain.js 拆分）
 * calculateEnding / getEndingRewards（纯函数，仅依赖 state）
 */
${endingBlock}

module.exports = { calculateEnding, getEndingRewards };
`;
fs.writeFileSync('server/qingfengEnding.js', endingFile, 'utf8');

const newTrain = head +
  '\n// ★ 结局结算（2026-08-16 拆分至 ./qingfengEnding）\n' +
  "const { calculateEnding, getEndingRewards } = require('./qingfengEnding');\n\n" +
  tail;
fs.writeFileSync('server/qingfengTrain.js', newTrain, 'utf8');

console.log('qingfengTrain.js:', newTrain.split('\n').length, '行; qingfengEnding.js:', endingFile.split('\n').length, '行');
