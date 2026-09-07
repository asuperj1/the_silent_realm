// cleanup_deadcode.js — 死代码清理（2026-08-16）
// 1) 删除 battle.js（window.BattleSystem 遗留）/ deepseekApi.js（AIManager 无引用）/ src/battle/（公式死代码，全库无引用）
// 2) roomHall.js 删除 T-5 重复的 CopySelectTransition IIFE（被独立 copySelectTransition.js 覆盖）
const fs = require('fs');

// ---------- 1. 删除文件/目录 ----------
['frontend/js/battle.js', 'server/deepseekApi.js'].forEach(f => {
  if (fs.existsSync(f)) { fs.rmSync(f); console.log('删除文件:', f); }
});
if (fs.existsSync('src/battle')) { fs.rmSync('src/battle', { recursive: true, force: true }); console.log('删除目录: src/battle'); }

// ---------- 2. roomHall.js 删除 T-5 重复 IIFE ----------
const rhPath = 'frontend/js/roomHall.js';
let rh = fs.readFileSync(rhPath, 'utf8');
const t5 = rh.indexOf('  // ==================== T-5: 飞页过渡合页金流动画 ====================');
const close = rh.lastIndexOf('})();');
if (t5 > 0 && close > t5) {
  rh = rh.slice(0, t5) + '})();\n';
  fs.writeFileSync(rhPath, rh, 'utf8');
  console.log('roomHall.js 删除 T-5 重复 IIFE，新行数:', rh.split('\n').length);
} else { console.error('roomHall T-5 锚点定位失败', { t5, close }); }
console.log('死代码清理完成');
