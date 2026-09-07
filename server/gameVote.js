/**
 * gameVote.js — 小队聊天 + 投票域（2026-08-16 从 gameHandler.js 拆分）
 * 3 事件：teamChat / teamVote / vote
 */
const logger = require('./logger');

function registerVote(socket, io, state) {
  const { gameRooms, getPlayerListForKp, enqueueDeepSeek,
          buildDungeonContext, buildQingfengKnowledgeContext, recordSceneSnapshot } = state;

  // ========== 小队房间聊天 ==========
  // ★ 消息内容清洗：限长 + 去控制字符（防御滥用与存储型 XSS 前提）
  function sanitizeContent(v) {
    return String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 500);
  }
  socket.on('teamChat', ({ content: rawContent }) => {
    const content = sanitizeContent(rawContent);
    if (!content) { socket.emit('error', { msg: '消息不能为空' }); return; }
    if (!socket.characterUid) {
      socket.emit('error', { msg: '请先选择角色' });
      return;
    }
    let gameRoomId = null;
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) { gameRoomId = id; break; }
    }
    if (!gameRoomId) {
      socket.emit('error', { msg: '未在游戏房间中，无法使用小队频道' });
      return;
    }
    const name = socket.character?.name || '未知';
    // 全队广播闲聊消息
    io.to(gameRoomId).emit('teamChatMsg', {
      msg: content,
      sender: name,
      senderId: socket.id,
      timestamp: Date.now()
    });
  });

  // ========== 投票（广播 + KP 响应 + 实时进度统计，王者投降风格） ==========
  function broadcastVoteUpdate(room, io, gameRoomId) {
    const st = room.activeVote;
    if (!st) return;
    const tally = st.options.map((_, i) => Object.values(st.votes).filter(v => v === i).length);
    io.to(gameRoomId).emit('voteUpdate', { voteId: st.id, options: st.options, tally, voters: st.voters.size, total: st.members.length });
  }
  function finishVote(room, io, gameRoomId) {
    const st = room.activeVote;
    if (!st) return;
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    const tally = st.options.map((_, i) => Object.values(st.votes).filter(v => v === i).length);
    const total = st.voters.size;
    let maxI = 0;
    for (let i = 1; i < tally.length; i++) if (tally[i] > tally[maxI]) maxI = i;
    const winner = total ? st.options[maxI] : null;
    const summary = `「${st.title}」${st.options.map((o, i) => `${o} ${tally[i]}票`).join('、')}${winner ? `；结果：${winner}` : '（无人投票）'}`;
    io.to(gameRoomId).emit('voteResult', { voteId: st.id, tally, total, winner, summary });
    room.activeVote = null;
  }

  socket.on('teamVote', ({ title, options, duration }) => {
    let gameRoomId = null;
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) {
        gameRoomId = id;
        break;
      }
    }
    if (!gameRoomId) return;
    const room = gameRooms.get(gameRoomId);
    if (!room) return;

    const dur = Math.max(10, Math.min(300, parseInt(duration) || 30));
    const opts = (options || []).map(o => (o && String(o).trim()) || '').filter(Boolean);
    if (opts.length < 2) return;

    // ★ 创建投票状态（实时进度统计）
    const voteId = 'vote_' + Date.now();
    const members = Array.from(room.players.keys()).filter(sid => room.players.get(sid) && !room.players.get(sid).offline);
    room.activeVote = {
      id: voteId, title, options: opts, duration: dur,
      votes: {}, voters: new Set(), members, timer: null
    };
    // 广播投票开始（所有成员显示王者投降风格进度界面）
    io.to(gameRoomId).emit('voteStart', { voteId, title, options: opts, total: members.length, duration: dur });
    io.to(gameRoomId).emit('publicMsg', {
      msg: `【投票发起】${title}，选项：${opts.join('、')}，倒计时 ${dur} 秒`,
      sender: '系统'
    });
    // 倒计时结束 → 结算
    room.activeVote.timer = setTimeout(() => finishVote(room, io, gameRoomId), dur * 1000);

    // 发送给 DeepSeek 生成剧情回应
    const playerList = getPlayerListForKp(room, io);

    // ★ 构建知识库上下文（若在青峰山副本中）
    const voteCtx = {};
    if (room.dungeonState) {
      const knowledgeCtx = buildQingfengKnowledgeContext(room.dungeonState);
      voteCtx.qingfengCarKnowledge = knowledgeCtx.carKnowledge;
      voteCtx.qingfengAdjacentKnowledge = knowledgeCtx.adjacentKnowledge;
      voteCtx.qingfengNpcActive = knowledgeCtx.npcActive;
      voteCtx.dungeonContext = buildDungeonContext(room.dungeonState, socket.character);
      voteCtx.actionTier = 'A';
    }

    enqueueDeepSeek(gameRoomId, {
      ...voteCtx,
      playerAction: `（全局行动·团队面向）小队发起了投票："${title}"，选项：${opts.join('、')}。\n【当前小队成员】${playerList}\n请以团队视角用第三人称叙述投票结果带来的场景变化。`,
      roomHistory: room.history.slice(-10)
    }, result => {
      room.history.push({ role: 'assistant', content: result.story });
      recordSceneSnapshot(room, { img: null, story: result.story, tags: result.tags || [] });
      io.to(gameRoomId).emit('aiReply', { from: 'KP', story: result.story, img: null, tags: result.tags || [] });
    }, err => {
      logger.error.error('投票DeepSeek调用失败', { error: err.message });
    });
  });

  // 成员投票：统计并广播实时进度
  socket.on('vote', ({ voteId, optionIndex }) => {
    let gameRoomId = null;
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) { gameRoomId = id; break; }
    }
    if (!gameRoomId) return;
    const room = gameRooms.get(gameRoomId);
    const st = room && room.activeVote;
    if (!st || st.id !== voteId) return;
    const idx = Math.min(st.options.length - 1, Math.max(0, parseInt(optionIndex) || 0));
    if (st.voters.has(socket.id)) return; // 已投
    st.voters.add(socket.id);
    st.votes[socket.id] = idx;
    broadcastVoteUpdate(room, io, gameRoomId);
    if (st.voters.size >= st.members.length) finishVote(room, io, gameRoomId);
  });
}

module.exports = { registerVote };
