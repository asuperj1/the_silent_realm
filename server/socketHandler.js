// socketHandler.js — connection 装配层（T-5 拆分后）
// 仅负责：connection 生命周期日志 + 5 个领域 handler 按序装配 + disconnect 收尾。
// 所有业务事件、共享状态已迁入 state.js 与各 domain handler，行为零变化。
const logger = require('./logger');
const state = require('./state');
const authHandler = require('./authHandler');
const hallHandler = require('./hallHandler');
const playerHandler = require('./playerHandler');
const gameHandler = require('./gameHandler');
const battleHandler = require('./battleHandler');
const workshopHandler = require('./workshopHandler');
// ★ 商店模块（档案大厅）：拍卖(24h)/寄售(固定价) 玩家间市场（原 tradeSystem 已由 marketSystem 取代）
const tradeSystem = require('./marketSystem');
const skillTreeHandler = require('./skillTree');
const questSystem = require('./questSystem');
// ★ 改进①：事件记录订阅者（副本 eventLog 记录，随持久化落盘）
const eventRecorder = require('./eventRecorder');
// ★ 副本刷新持久化：房间磁盘落盘 / 还原
const roomPersistence = require('./roomPersistence');

// ==================== 注册事件 ====================
function registerSocketEvents(io) {
  // ★ 事件驱动：幂等启动事件记录订阅（观察者，只读消费事件）
  eventRecorder.ensureStarted();

  // ★ 副本断线恢复：定期清理长期无人恢复的副本房间（10 分钟宽限）
  if (!global.__cocResumeSweeperStarted) {
    global.__cocResumeSweeperStarted = true;
    setInterval(() => {
      const now = Date.now();
      for (const [id, room] of state.gameRooms) {
        if (!room.players || room.players.size === 0) {
          // ★ 持久化：删除前落盘（后续刷新仍可从磁盘还原）
          try { roomPersistence.saveRoom(room); } catch (e) { /* ignore */ }
          state.gameRooms.delete(id);
          continue;
        }
        const allOffline = Array.from(room.players.values()).every(p => p.offline);
        if (allOffline && (now - (room.lastActivity || now)) > 10 * 60 * 1000) {
          // ★ 持久化：删除前落盘兜底（对局记录不丢，等待刷新还原）
          try { roomPersistence.saveRoom(room); } catch (e) { /* ignore */ }
          state.gameRooms.delete(id);
          logger.user.info('副本房间超时清理（已落盘，可刷新恢复）', { roomId: id });
        }
      }
      // ★ 副本刷新持久化：周期性全量落盘（history / eventLog / dungeonState 实时同步）
      try { roomPersistence.flushAll(state.gameRooms); } catch (e) { /* ignore */ }
      // ★ 清理过期磁盘房间（>24h 历史会话残留，防止 findRoomByUid 恢复到陈旧对局）
      try { roomPersistence.sweepStale(); } catch (e) { /* ignore */ }
    }, 60000);
  }

  io.on('connection', (socket) => {
    logger.user.info('新连接', { socketId: socket.id });

    // 按序装配各领域事件（32 事件全部接线）
    authHandler.registerAuth(socket, io, state);
    hallHandler.registerHall(socket, io, state);
    gameHandler.registerGame(socket, io, state);
    battleHandler.registerBattle(socket, io, state);
    playerHandler.registerPlayer(socket, io, state);
    workshopHandler.registerWorkshop(socket, io, state);
    tradeSystem.registerTrade(socket, io, state);
    skillTreeHandler.registerSkillTree(socket, io, state);
    questSystem.registerQuestSystem(socket, io, state);

    // ========== 断线处理（生命周期，保留在装配层） ==========
    socket.on('disconnect', () => {
      state.removePlayerFromHall(socket, io, '断线');
      let gameRoomId = null;
      for (const [id, room] of state.gameRooms) {
        if (room.players.has(socket.id)) {
          gameRoomId = id;
          break;
        }
      }
      if (gameRoomId) {
        const gameRoom = state.gameRooms.get(gameRoomId);
        if (gameRoom) {
          // ★ 断线持久化：保留玩家槽位并标记离线，等待刷新/重连恢复副本
          const player = gameRoom.players.get(socket.id);
          if (player) {
            player.offline = true;
            player.lastSeen = Date.now();
          }
          gameRoom.lastActivity = Date.now();
          io.to(gameRoomId).emit('roomUpdate', { players: Array.from(gameRoom.players.values()) });
          // ★ 改进④ 卡死防护：离线成员在战斗中 → 标记战斗单位离线；若恰为其回合则自动跳过
          try {
            const battleEngine = require('./battleEngine');
            const offRes = battleEngine.battlePlayerOffline(gameRoomId, socket.id);
            // ★ 修复：全员离线时暂停战斗（不驱动），等待玩家刷新/重连恢复；
            //   仅当仍有在线玩家才驱动（否则离线成员被无限跳过 → 怪物磨死玩家死循环）
            if (offRes && offRes.advanced && battleEngine.battleHasOnlinePlayer(gameRoomId)) {
              const BC = require('./battleCore');
              BC.driveBattle(gameRoom, io, gameRoomId, gameRoom.dungeonState);
            }
          } catch (e) { /* ignore */ }
          // ★ 改进①：断线事件（供其他系统订阅，如战斗跳过/记录）
          try {
            state.eventBus.emit(state.EVENTS.PLAYER_DISCONNECTED, { actor: socket.id, data: { roomId: gameRoomId } });
          } catch (e) { /* ignore */ }
          // ★ 副本刷新持久化：断线即落盘（刷新 / 服务器重启后仍可 resumeGame）
          try { roomPersistence.saveRoom(gameRoom); } catch (e) { /* ignore */ }
          // 不再立即删除房间：交由超时清理（见 registerSocketEvents 顶部定时器）
        }
      }
      logger.user.info('玩家离线', { socketId: socket.id });
    });
  });
}

module.exports = { registerSocketEvents };
