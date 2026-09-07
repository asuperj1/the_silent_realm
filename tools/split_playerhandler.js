// split_playerhandler.js — 将 playerHandler.js 的背包格子辅助+常量拆到 playerItems.js
const fs = require('fs');
const src = fs.readFileSync('server/playerHandler.js', 'utf8');
const itemsStart = src.indexOf('const VALID_SLOTS');
const regStart = src.indexOf('// 商店/背包域');
if (itemsStart < 0 || regStart < 0 || regStart < itemsStart) { console.error('锚点定位失败', { itemsStart, regStart }); process.exit(1); }

const head = src.slice(0, itemsStart);            // 文件头+requires（含 itemEngine）
const itemsBlock = src.slice(itemsStart, regStart); // 常量+辅助函数
const tail = src.slice(regStart);                  // registerPlayer + module.exports

const EXPS = ['partitionFor', 'restoreItemFromTemplate', 'buildEquipInfo', 'occupancyMap', 'canPlaceAt',
  'findFreeSlot', 'dstItemsOf', 'tryMergeStack', 'moveBetween', 'placeItem', 'grantPlotItem', 'ensureGrid',
  'VALID_SLOTS', 'SLOT_LABELS', 'PART_LABEL', 'INV_PARTITIONS', 'WH_COLS', 'WH_ROWS'];

const itemsFile = `/**
 * playerItems.js — 背包格子辅助 + 分区常量（2026-08-16 从 playerHandler.js 拆分）
 * 含：分区/占格/堆叠/跨空间移动/发放物证/旧档补格。
 */
const { getItemEngine } = require('./itemEngine/ItemEngine');
const itemEngine = getItemEngine();

${itemsBlock}

module.exports = { ${EXPS.join(', ')} };
`;
fs.writeFileSync('server/playerItems.js', itemsFile, 'utf8');

const requireLine = `// ★ 拆分（2026-08-16）：背包格子辅助/常量已迁至 ./playerItems\nconst PI = require('./playerItems');\nconst { ${EXPS.join(', ')} } = PI;\n\n`;
const newHandler = head + requireLine + tail;
fs.writeFileSync('server/playerHandler.js', newHandler, 'utf8');

console.log('playerHandler.js:', newHandler.split('\n').length, '行; playerItems.js:', itemsFile.split('\n').length, '行');
