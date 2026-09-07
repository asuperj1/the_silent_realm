/**
 * hallHandler.js — 大厅 / 房间域（T-5 拆分产物）
 * 7 事件：getRoomList / createRoom / joinPublicRoom / joinRoomByCode / leaveRoom / kickPlayer / syncRoomState
 * 依赖 state.js 共享状态（hallRooms / playerHallMap / gameRooms）与共享 helper。
 */

const logger = require('./logger');

// 大厅/房间域（7 事件）
function registerHall(socket, io, state) {
  const { hallRooms, playerHallMap, gameRooms, getPublicRoomSummaries,
          removePlayerFromHall, generateRoomId, generateRoomCode } = state;

  socket.on('getRoomList', () => {
    socket.emit('roomList', { rooms: getPublicRoomSummaries() });
  });

  // 创建房间
  socket.on('createRoom', ({ isPrivate, copyName }) => {
    if (!socket.character) return socket.emit('error', { msg: '未选择角色' });
    // 检查是否已在其他房间
    if (playerHallMap.has(socket.id)) {
      socket.emit('error', { msg: '你已经在一个房间中，无法创建新房间。' });
      return;
    }
    const roomId = generateRoomId();
    const room = {
      id: roomId,
      hostId: socket.id,
      players: new Map(),
      isPrivate: isPrivate || false,
      roomCode: isPrivate ? generateRoomCode() : null,
      copyName: copyName || null
    };
    room.players.set(socket.id, {
      socketId: socket.id,
      uid: socket.characterUid,
      name: socket.character.name,
      career: socket.character.career,
      level: socket.character.level,
      attr: socket.character.attr
    });
    hallRooms.set(roomId, room);
    socket.join(roomId);
    playerHallMap.set(socket.id, roomId); // 标记身处房间

    socket.emit('roomJoined', {
      roomId,
      players: Array.from(room.players.values()),
      hostId: room.hostId,
      roomCode: room.roomCode,
      copyName: room.copyName // ★ 携带副本名，修复房间显示和副本启动问题
    });

    if (!isPrivate) io.emit('roomList', { rooms: getPublicRoomSummaries() });
    logger.user.info('房间创建', { roomId, isPrivate });
  });

  // 加入公开房间
  socket.on('joinPublicRoom', ({ roomId }) => {
    if (!socket.character) return socket.emit('error', { msg: '未选择角色' });
    if (playerHallMap.has(socket.id)) {
      socket.emit('error', { msg: '你已经在一个房间中，请先离开当前房间。' });
      return;
    }
    const room = hallRooms.get(roomId);
    if (!room) return socket.emit('error', { msg: '房间不存在' });
    if (room.isPrivate) return socket.emit('error', { msg: '私密房间需要邀请码' });
    if (room.players.size >= 5) return socket.emit('error', { msg: '房间已满' });

    room.players.set(socket.id, {
      socketId: socket.id,
      uid: socket.characterUid,
      name: socket.character.name,
      career: socket.character.career,
      level: socket.character.level,
      attr: socket.character.attr
    });
    socket.join(roomId);
    playerHallMap.set(socket.id, roomId); // 标记身处房间

    socket.emit('roomJoined', {
      roomId,
      players: Array.from(room.players.values()),
      hostId: room.hostId,
      roomCode: room.roomCode,
      copyName: room.copyName // ★ 携带副本名
    });

    io.to(roomId).emit('roomPlayersUpdate', {
      players: Array.from(room.players.values()),
      hostId: room.hostId
    });

    io.emit('roomList', { rooms: getPublicRoomSummaries() });
  });

  // 通过邀请码加入
  socket.on('joinRoomByCode', ({ roomCode }) => {
    if (!socket.character) return socket.emit('error', { msg: '未选择角色' });
    if (playerHallMap.has(socket.id)) {
      socket.emit('error', { msg: '你已经在一个房间中，请先离开当前房间。' });
      return;
    }
    let targetRoom = null;
    for (const [id, room] of hallRooms) {
      if (room.roomCode === roomCode) {
        targetRoom = room;
        break;
      }
    }
    if (!targetRoom) return socket.emit('error', { msg: '房间码无效' });
    if (targetRoom.players.size >= 5) return socket.emit('error', { msg: '房间已满' });

    targetRoom.players.set(socket.id, {
      socketId: socket.id,
      uid: socket.characterUid,
      name: socket.character.name,
      career: socket.character.career,
      level: socket.character.level,
      attr: socket.character.attr
    });
    socket.join(targetRoom.id);
    playerHallMap.set(socket.id, targetRoom.id); // 标记身处房间

    socket.emit('roomJoined', {
      roomId: targetRoom.id,
      players: Array.from(targetRoom.players.values()),
      hostId: targetRoom.hostId,
      roomCode: targetRoom.roomCode,
      copyName: targetRoom.copyName // ★ 携带副本名
    });

    io.to(targetRoom.id).emit('roomPlayersUpdate', {
      players: Array.from(targetRoom.players.values()),
      hostId: targetRoom.hostId
    });
  });

  // 离开房间（主动退出）
  socket.on('leaveRoom', () => {
    if (!playerHallMap.has(socket.id)) return; // 本身就不在房间
    removePlayerFromHall(socket, io, '主动离开');
    socket.emit('leftRoom'); // 通知客户端清除状态
  });

  // 房主踢人
  socket.on('kickPlayer', ({ targetSocketId }) => {
    const hallRoomId = playerHallMap.get(socket.id);
    if (!hallRoomId) return;
    const room = hallRooms.get(hallRoomId);
    if (!room || room.hostId !== socket.id) return;
    if (!room.players.has(targetSocketId)) return socket.emit('error', { msg: '玩家不在房间' });

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('kickedFromRoom');
      targetSocket.leave(hallRoomId);
      playerHallMap.delete(targetSocketId);
    }
    room.players.delete(targetSocketId);
    io.to(hallRoomId).emit('roomPlayersUpdate', {
      players: Array.from(room.players.values()),
      hostId: room.hostId
    });
  });

  // ========== ★ 房间状态同步（前后台一致性校验） ==========
  socket.on('syncRoomState', () => {
    // 检查是否在大厅房间中
    const hallRoomId = playerHallMap.get(socket.id);
    if (hallRoomId) {
      const room = hallRooms.get(hallRoomId);
      if (room) {
        socket.emit('roomStateSync', {
          inRoom: true,
          roomId: hallRoomId,
          players: Array.from(room.players.values()),
          hostId: room.hostId,
          roomCode: room.roomCode,
          copyName: room.copyName
        });
        return;
      } else {
        // 映射残留，清理
        playerHallMap.delete(socket.id);
      }
    }
    // 检查是否在游戏房间中
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) {
        socket.emit('roomStateSync', {
          inGame: true,
          gameRoomId: id,
          copyName: room.copyState?.name
        });
        return;
      }
    }
    // 不在任何房间
    socket.emit('roomStateSync', { inRoom: false, inGame: false });
  });
}

module.exports = { registerHall };
