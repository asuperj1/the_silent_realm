/**
 * roomHallSocket.js — 房间大厅 socket 事件注册（2026-08-16 从 roomHall.js 拆分）
 * 通过 ctx 注入回调与状态 setter，DOM 动态获取（与 roomHall 闭包 let 等价）。
 * ctx = { renderRoomList, renderRoomMembers, updateLobbyUI, switchPage, resetState,
 *         refreshRoomList, showToast, showAlert, setState, pushHandler }
 */
window.RoomHallSocket = (function () {
  function register(socket, ctx) {
    if (!socket || !ctx) return;
    const _on = (event, fn) => { ctx.pushHandler({ event, fn }); socket.on(event, fn); };
    const $ = (id) => document.getElementById(id);

    _on('roomList', ({ rooms }) => {
      ctx.setState({ allRooms: rooms || [] });
      ctx.renderRoomList();
    });

    _on('roomJoined', ({ roomId, players, hostId, roomCode, copyName }) => {
      ctx.setState({
        currentRoomId: roomId,
        isRoomHost: (hostId === socket.id),
        hallPlayers: players || []
      });
      if (copyName) {
        ctx.setState({ currentCopy: copyName });
        if ($('lobbyCopyInfo')) $('lobbyCopyInfo').textContent = '📋 副本：' + copyName;
        if ($('lobbyCopyTitle')) $('lobbyCopyTitle').textContent = '🏠 ' + copyName;
        if ($('lobbySelectedCopy')) $('lobbySelectedCopy').textContent = copyName;
      }
      if (roomCode) {
        if ($('lobbyRoomCode')) $('lobbyRoomCode').textContent = roomCode;
        if ($('lobbyRoomCodeDisplay')) $('lobbyRoomCodeDisplay').style.display = '';
      } else {
        if ($('lobbyRoomCode')) $('lobbyRoomCode').textContent = '公开房间';
      }
      try { sessionStorage.setItem('coc_hall_roomId', roomId); } catch (e) {}
      ctx.renderRoomMembers();
      if ($('lobbyCurrentRoom')) $('lobbyCurrentRoom').classList.remove('hidden');
      ctx.updateLobbyUI();
      ctx.switchPage('pageRoomLobby');
    });

    _on('roomPlayersUpdate', ({ players, hostId }) => {
      ctx.setState({ isRoomHost: (hostId === socket.id), hallPlayers: players || [] });
      ctx.renderRoomMembers();
      ctx.updateLobbyUI();
    });

    _on('roomStateSync', (state) => {
      if (state.inRoom) {
        ctx.setState({
          currentRoomId: state.roomId,
          isRoomHost: (state.hostId === socket.id),
          hallPlayers: state.players || []
        });
        if (state.roomCode) {
          if ($('lobbyRoomCode')) $('lobbyRoomCode').textContent = state.roomCode;
        } else {
          if ($('lobbyRoomCode')) $('lobbyRoomCode').textContent = '公开房间';
        }
        if (state.copyName) {
          ctx.setState({ currentCopy: state.copyName });
          if ($('lobbyCopyInfo')) $('lobbyCopyInfo').textContent = '📋 副本：' + state.copyName;
          if ($('lobbyCopyTitle')) $('lobbyCopyTitle').textContent = '🏠 ' + state.copyName;
          if ($('lobbySelectedCopy')) $('lobbySelectedCopy').textContent = state.copyName;
        }
        ctx.renderRoomMembers();
        if ($('lobbyCurrentRoom')) $('lobbyCurrentRoom').classList.remove('hidden');
        if ($('lobbyRoomList')) $('lobbyRoomList').style.display = 'none';
        ctx.updateLobbyUI();
        ctx.switchPage('pageRoomLobby');
        try { sessionStorage.setItem('coc_hall_roomId', state.roomId); } catch (e) {}
        ctx.showToast('已同步房间状态');
      } else {
        sessionStorage.removeItem('coc_hall_roomId');
      }
    });

    _on('kickedFromRoom', () => {
      ctx.showAlert('你已被移出房间'); ctx.resetState(); ctx.updateLobbyUI(); ctx.refreshRoomList();
    });
    _on('leftRoom', () => {
      if ($('lobbyRoomList')) $('lobbyRoomList').style.display = '';
      ctx.resetState(); ctx.updateLobbyUI(); ctx.refreshRoomList();
      ctx.showToast('已离开房间');
    });
    _on('roomDissolved', () => {
      ctx.showAlert('房间已解散');
      if ($('lobbyRoomList')) $('lobbyRoomList').style.display = '';
      ctx.resetState(); ctx.updateLobbyUI(); ctx.refreshRoomList();
    });
    _on('copySettlement', () => {
      ctx.resetState();
      const uid = window._currentUser?.uid || localStorage.getItem('playerUID');
      if (uid) socket.emit('getCharacterList', { uid });
    });
    _on('copyStart', ({ copyName }) => {
      if (!ctx.active() && !ctx.getRoomId()) return;
      ctx.switchPage('pageGame');
      const publicLog = document.getElementById('publicLog');
      if (publicLog && typeof window.appendLog === 'function') {
        window.appendLog(publicLog, '副本【' + copyName + '】已开启', 'KP');
      }
    });
    _on('error', ({ msg }) => {
      ctx.showToast(msg);
      if (msg && (msg.includes('已经在') || msg.includes('房间'))) socket.emit('syncRoomState');
      if (msg && (msg.includes('副本') || msg.includes('启动') || msg.includes('调查员'))) {
        if ($('btnStartCopyLobby') && ctx.isHost()) {
          const btn = $('btnStartCopyLobby');
          btn.disabled = false;
          btn.textContent = '▶ 启动副本';
          btn.style.opacity = '1';
        }
      }
    });
  }
  return { register };
})();
