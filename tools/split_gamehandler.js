// split_gamehandler.js — 将 gameHandler.js 的聊天+投票域拆到 gameVote.js
const fs = require('fs');
const src = fs.readFileSync('server/gameHandler.js', 'utf8');
const voteStart = src.indexOf('  // ========== 小队房间聊天 ==========');
const regStart = src.indexOf('\nmodule.exports');
const regClose = src.lastIndexOf('\n}', regStart); // registerGame 收尾 }（module.exports 前）
if (voteStart < 0 || regClose < 0 || regClose < voteStart) { console.error('锚点定位失败', { voteStart, regClose, regStart }); process.exit(1); }

const head = src.slice(0, voteStart);          // registerGame 主体（不含聊天投票）
const voteBlock = src.slice(voteStart, regClose); // 聊天+投票（不含 registerGame 收尾 }）
const tail = src.slice(regClose);                 // '\n}\n\nmodule.exports = { registerGame };'

// gameVote.js 组装
const voteFile = `/**
 * gameVote.js — 小队聊天 + 投票域（2026-08-16 从 gameHandler.js 拆分）
 * 3 事件：teamChat / teamVote / vote
 */
const logger = require('./logger');

function registerVote(socket, io, state) {
  const { gameRooms, getPlayerListForKp, enqueueDeepSeek,
          buildDungeonContext, buildQingfengKnowledgeContext, recordSceneSnapshot } = state;

${voteBlock}
}

module.exports = { registerVote };
`;
fs.writeFileSync('server/gameVote.js', voteFile, 'utf8');

// gameHandler.js 组装：聊天+投票 → registerVote 调用
const newHandler = head +
  '\n  // ★ 聊天+投票域（2026-08-16 拆分至 ./gameVote）\n' +
  "  require('./gameVote').registerVote(socket, io, state);\n" +
  tail;
fs.writeFileSync('server/gameHandler.js', newHandler, 'utf8');

console.log('gameHandler.js:', newHandler.split('\n').length, '行; gameVote.js:', voteFile.split('\n').length, '行');
