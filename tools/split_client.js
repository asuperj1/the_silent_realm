/**
 * split_client.js — 一次性拆分 client.js（3875 行）的高内聚块到独立文件
 * 运行：node tools/split_client.js
 * 产出：
 *   frontend/js/client-vote.js  —— 投票系统（原 897-1055 行）
 *   frontend/js/client-shop.js  —— 商店/背包/物品/快捷栏/详情/tooltip（原 2225-2825 行）
 *   frontend/js/client.js       —— 两段替换为迁移注释
 * 依赖说明：两个新文件必须放在 client.js 之后加载（它们引用 client.js 顶层的 socket/公共工具）；
 *           client.js 仅在运行时回调中调用新文件函数（此时已加载）→ 顺序安全。
 */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'frontend', 'js', 'client.js');
const lines = fs.readFileSync(file, 'utf8').split('\n');
// 1-indexed 区间 → 0-indexed slice
const B = { start: 897, end: 1055 }; // 投票
const A = { start: 2225, end: 2825 }; // 商店/背包
const bStart = B.start - 1, bEnd = B.end - 1;
const aStart = A.start - 1, aEnd = A.end - 1;
const blockB = lines.slice(bStart, bEnd + 1).join('\n');
const blockA = lines.slice(aStart, aEnd + 1).join('\n');

const out = lines.slice();
// 先删靠后的 A，再删靠前的 B（索引互不影响）
out.splice(aStart, aEnd - aStart + 1, '// ==================== 商店 / 背包 / 物品 / 快捷栏 / 详情 / tooltip（已迁移至 client-shop.js） ====================');
out.splice(bStart, bEnd - bStart + 1, '// ==================== 投票系统（已迁移至 client-vote.js） ====================');

const voteHeader = `/**
 * client-vote.js — 投票系统（2026-08-23 从 client.js 拆分）
 * 依赖：client.js 先加载（socket / 公共 UI 工具）
 */
`;
const shopHeader = `/**
 * client-shop.js — 商店 / 背包 / 物品 / 快捷栏 / 物品详情 / gold tooltip（2026-08-23 从 client.js 拆分）
 * 依赖：client.js 先加载（socket / currentCharacter / 公共 UI 工具）
 */
`;
fs.writeFileSync(path.join(__dirname, '..', 'frontend', 'js', 'client-vote.js'), voteHeader + blockB + '\n', 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'frontend', 'js', 'client-shop.js'), shopHeader + blockA + '\n', 'utf8');
fs.writeFileSync(file, out.join('\n'), 'utf8');
console.log('[split] 完成');
console.log('[split] client-vote.js 行数:', voteHeader.split('\n').length + blockB.split('\n').length);
console.log('[split] client-shop.js 行数:', shopHeader.split('\n').length + blockA.split('\n').length);
console.log('[split] client.js 剩余行数:', out.length);
