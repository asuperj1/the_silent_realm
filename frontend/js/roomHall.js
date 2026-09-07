/**
 * roomHall.js v3 — 双页流程：副本选择（等距背景）→ 房间大厅
 *
 * 页面结构：
 *   #pageCopySelect  — 环布副本卡片 + 等距瓦片动态背景
 *   #pageRoomLobby   — 房间列表 / 当前房间成员 + 操作按钮
 *
 * 按钮规则：
 *   - 未加入房间：显示创建房间、输入房间码；隐藏离开、启动
 *   - 已加入房间：隐藏创建、输入房间码、房间列表
 *     · 房主：显示启动副本 + 离开房间
 *     · 非房主：仅显示离开房间（启动按钮变灰提示）
 */
(function() {
  const socket = window.socket;
  // ★ XSS 转义工具
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const showAlert = (m) => window.showAlert ? window.showAlert(m) : alert(m);
  const showConfirm = (...args) => window.showConfirm ? window.showConfirm(...args) : Promise.resolve(confirm(args[0]));
  const showToast = (m) => { if (window.showToast) window.showToast(m); };

  // ==================== DOM 引用 ====================
  let copyCardsRing, btnBackToCharFromCopySelect;
  let lobbyCopyTitle, lobbyCopyInfo, lobbyRoomList, lobbyCurrentRoom,
      lobbyRoomCode, lobbyRoomPlayers, lobbyActions,
      btnCreateRoomLobby, btnJoinByCodeLobby, btnStartCopyLobby, btnLeaveRoomLobby,
      btnBackToCopySelect, lobbySelectedCopy, lobbyRoomCodeDisplay;
  let modalCreateRoom, modalJoinCode, createRoomCopyLabel;

  // ==================== 状态 ====================
  let _active = false;
  let _socketHandlers = [];
  let currentCopy = null;
  let currentRoomId = null;
  let isRoomHost = false;
  let hallPlayers = [];
  let allRooms = [];
  let _questModal = null, _questBody = null;

  const COPIES = [
    { name:'废都纪元800｜青峰山虚空列车', diff:'简单', exp:25, tier:'beginner' },
    { name:'渔村纪元900｜雾潮潮间渔村', diff:'普通', exp:45, tier:'beginner' },
    { name:'日之塔纪元1000｜荒野商队护送', diff:'普通', exp:45, tier:'beginner' },
    { name:'深海潮汐·拉莱耶深渊', diff:'困难', exp:75, tier:'advanced' },
    { name:'璃岛祭典·圣女殉道', diff:'困难', exp:75, tier:'advanced' },
    { name:'血肉病院·畸变禁区', diff:'困难', exp:75, tier:'advanced' },
    { name:'星穹裂隙·虚空门扉', diff:'噩梦', exp:110, tier:'final' }
  ];

  let clearedCopies = [];
  let engravingTier = 'white';

  function getVisibleCopies() {
    const visible = COPIES.filter(c => c.tier === 'beginner');
    const beginnerNames = COPIES.filter(c => c.tier === 'beginner').map(c => c.name);
    const allBeginnersCleared = beginnerNames.every(n => clearedCopies.includes(n));
    if (allBeginnersCleared) {
      visible.push(...COPIES.filter(c => c.tier === 'advanced'));
      const advancedNames = COPIES.filter(c => c.tier === 'advanced').map(c => c.name);
      const allAdvancedCleared = advancedNames.every(n => clearedCopies.includes(n));
      if (allAdvancedCleared) {
        visible.push(...COPIES.filter(c => c.tier === 'final'));
      }
    }
    return visible;
  }

  function switchPage(id) {
    const el = document.getElementById(id);
    if (el && typeof window.showPage === 'function') window.showPage(el);
  }
  function showModal(m, s) { if (m) s ? m.classList.add('active') : m.classList.remove('active'); }

  let _initialized = false;

  function init() {
    const needReRegister = _initialized && _socketHandlers.length === 0;
    if (_initialized && !needReRegister) { _active = true; refreshRoomList(); return; }
    if (_initialized && needReRegister) { _initialized = false; }

    _initialized = true;
    _active = true;

    copyCardsRing = document.getElementById('copyCardsRing');
    btnBackToCharFromCopySelect = document.getElementById('btnBackToCharFromCopySelect');
    lobbyCopyTitle = document.getElementById('lobbyCopyTitle');
    lobbyCopyInfo = document.getElementById('lobbyCopyInfo');
    lobbyRoomList = document.getElementById('lobbyRoomList');
    lobbyCurrentRoom = document.getElementById('lobbyCurrentRoom');
    lobbyRoomCode = document.getElementById('lobbyRoomCode');
    lobbyRoomCodeDisplay = document.getElementById('lobbyRoomCodeDisplay');
    lobbyRoomPlayers = document.getElementById('lobbyRoomPlayers');
    lobbyActions = document.getElementById('lobbyActions');
    btnCreateRoomLobby = document.getElementById('btnCreateRoomLobby');
    btnJoinByCodeLobby = document.getElementById('btnJoinByCodeLobby');
    btnStartCopyLobby = document.getElementById('btnStartCopyLobby');
    btnLeaveRoomLobby = document.getElementById('btnLeaveRoomLobby');
    btnBackToCopySelect = document.getElementById('btnBackToCopySelect');
    lobbySelectedCopy = document.getElementById('lobbySelectedCopy');
    modalCreateRoom = document.getElementById('modalCreateRoom');
    modalJoinCode = document.getElementById('modalJoinCode');
    createRoomCopyLabel = document.getElementById('createRoomCopyLabel');
    _questModal = document.getElementById('modalQuestBoard');
    _questBody = document.getElementById('questBoardBody');

    renderCopyCards();
    _bindRingPositioning();
    bindEvents();
    registerSocketEvents();
    refreshRoomList();
    _requestRoomStateSync();

    if (btnBackToCharFromCopySelect) {
      btnBackToCharFromCopySelect.addEventListener('click', () => {
        _active = false;
        if (currentRoomId) socket.emit('leaveRoom');
        resetState();
        switchPage('pageCharacters');
        const uid = window._currentUser?.uid || localStorage.getItem('playerUID');
        if (uid) socket.emit('getCharacterList', { uid });
      });
    }

    if (btnBackToCopySelect) {
      btnBackToCopySelect.addEventListener('click', () => {
        if (currentRoomId) {
          showAlert('请先离开房间再返回副本选择');
          return;
        }
        resetState();
        switchPage('pageCopySelect');
      });
    }

    try {
      const savedRoomId = sessionStorage.getItem('coc_hall_roomId');
      if (savedRoomId && !currentRoomId) {
        switchPage('pageRoomLobby');
      }
    } catch(e) {}
  }

  function resetState() {
    currentRoomId = null; isRoomHost = false; hallPlayers = [];
    if (lobbyCurrentRoom) lobbyCurrentRoom.classList.add('hidden');
    if (lobbyActions) lobbyActions.style.display = '';
    if (btnStartCopyLobby) { btnStartCopyLobby.style.display = 'none'; btnStartCopyLobby.classList.add('hidden'); }
    if (btnLeaveRoomLobby) { btnLeaveRoomLobby.style.display = 'none'; btnLeaveRoomLobby.classList.add('hidden'); }
    sessionStorage.removeItem('coc_hall_roomId');
  }

  function _requestRoomStateSync() {
    if (socket && socket.connected) { socket.emit('syncRoomState'); return; }
    let resolved = false;
    const timeout = setTimeout(() => { if (!resolved) { resolved = true; socket.off('connect', onConnect); } }, 3000);
    function onConnect() { if (!resolved) { resolved = true; clearTimeout(timeout); socket.emit('syncRoomState'); } }
    socket.once('connect', onConnect);
  }

  // ==================== 渲染副本卡片（环绕布局） ====================
  function renderCopyCards() {
    if (!copyCardsRing) return;
    copyCardsRing.innerHTML = '';
    const visible = getVisibleCopies();
    visible.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'copy-ring-card';
      card.style.setProperty('--card-idx', i);
      card.style.animationDelay = (i * 0.08) + 's';
      card.innerHTML = `
        <div class="copy-ring-name">${c.name}</div>
        <div class="copy-ring-meta">
          <span class="copy-ring-diff ${c.tier}">${c.diff}</span>
          <span class="copy-ring-exp">+${c.exp} 经验</span>
        </div>
      `;
      card.addEventListener('click', () => navigateToLobby(c.name));
      copyCardsRing.appendChild(card);
    });
    // 环形定位
    positionCopyCardsRing();
  }

  // ★ 环形卡片定位算法
  let _ringResizeTimer = null;
  function positionCopyCardsRing() {
    if (!copyCardsRing) return;
    const cards = copyCardsRing.querySelectorAll('.copy-ring-card');
    if (cards.length === 0) return;

    const bounds = window.IsometricBg?.getAnomalyBounds?.() || { cx: window.innerWidth / 2, cy: window.innerHeight * 0.5, width: 200, height: 200 };
    const anomalyCx = bounds.cx;
    const anomalyCy = bounds.cy;
    const anomalyW = bounds.width;

    const cardW = 200;
    const cardH = 100; // 近似高度
    const N = cards.length;

    // 椭圆半径：比方尖碑大一圈
    const radiusX = anomalyW * 0.9 + 130;
    const radiusY = anomalyW * 0.7 + 110;

    // ★ T-2: 仅下半圈弧形（角度 0°→180°，即右下→正下→左下）
    const startAngle = 0;
    const endAngle = Math.PI;
    const arcRange = endAngle - startAngle;
    const arcBottomOffset = radiusY * 0.18;

    cards.forEach((card, i) => {
      const t = N === 1 ? 0.5 : i / (N - 1); // 0..1 均匀插值
      const theta = startAngle + t * arcRange; // 0 → π
      let left = anomalyCx + radiusX * Math.cos(theta) - cardW / 2;
      let top = anomalyCy + radiusY * Math.sin(theta) + arcBottomOffset - cardH / 2;

      // 边界钳制
      const pageW = window.innerWidth;
      const pageH = window.innerHeight;
      left = Math.max(20, Math.min(pageW - cardW - 20, left));
      top = Math.max(80, Math.min(pageH - cardH - 30, top));

      card.style.left = left + 'px';
      card.style.top = top + 'px';

      // z-index: 中间卡片（正下方）最高
      const distFromCenter = Math.abs(t - 0.5);
      card.style.zIndex = Math.round(10 + (1 - distFromCenter) * 12);

      // animationDelay: 中间先出现
      card.style.animationDelay = (distFromCenter * 0.4) + 's';
    });
  }

  // ★ 监听 isometricReady + resize 重新定位（★ 幂等守卫：防 init 循环累加 resize 监听）
  let _ringBound = false;
  function _bindRingPositioning() {
    if (_ringBound) return; _ringBound = true;
    const onReady = () => positionCopyCardsRing();
    window.addEventListener('isometricReady', onReady);
    window.addEventListener('resize', () => {
      clearTimeout(_ringResizeTimer);
      _ringResizeTimer = setTimeout(positionCopyCardsRing, 120);
    });
  }

  function navigateToLobby(copyName) {
    currentCopy = copyName;
    if (lobbyCopyTitle) lobbyCopyTitle.textContent = '🏠 ' + copyName;
    if (lobbyCopyInfo) lobbyCopyInfo.textContent = '难度：' + getCopyDiff(copyName) + ' | 公开房间';
    if (lobbySelectedCopy) lobbySelectedCopy.textContent = copyName;
    _active = true;
    switchPage('pageRoomLobby');
    refreshRoomList();
    updateLobbyUI();
  }

  function getCopyDiff(name) {
    const c = COPIES.find(x => x.name === name);
    return c ? c.diff : '未知';
  }

  // ==================== 房间大厅 UI 状态 ====================
  function updateLobbyUI() {
    const inRoom = !!currentRoomId;
    if (lobbyActions) lobbyActions.style.display = inRoom ? 'none' : '';
    if (btnCreateRoomLobby) btnCreateRoomLobby.style.display = inRoom ? 'none' : '';
    if (btnJoinByCodeLobby) btnJoinByCodeLobby.style.display = inRoom ? 'none' : '';
    if (lobbyRoomList) lobbyRoomList.style.display = inRoom ? 'none' : '';
    if (lobbyCurrentRoom) lobbyCurrentRoom.classList.toggle('hidden', !inRoom);

    if (btnLeaveRoomLobby) {
      btnLeaveRoomLobby.style.display = inRoom ? 'inline-block' : 'none';
      btnLeaveRoomLobby.classList.toggle('hidden', !inRoom);
    }

    if (btnStartCopyLobby) {
      if (inRoom && isRoomHost) {
        btnStartCopyLobby.style.display = 'inline-block';
        btnStartCopyLobby.classList.remove('hidden');
        btnStartCopyLobby.disabled = false;
        btnStartCopyLobby.title = '';
        btnStartCopyLobby.textContent = '▶ 启动副本';
        btnStartCopyLobby.style.opacity = '1';
        btnStartCopyLobby.style.cursor = 'pointer';
      } else if (inRoom && !isRoomHost) {
        btnStartCopyLobby.style.display = 'inline-block';
        btnStartCopyLobby.classList.remove('hidden');
        btnStartCopyLobby.disabled = true;
        btnStartCopyLobby.title = '仅房主可启动副本';
        btnStartCopyLobby.textContent = '🔒 等待房主启动';
        btnStartCopyLobby.style.opacity = '0.5';
        btnStartCopyLobby.style.cursor = 'not-allowed';
      } else {
        btnStartCopyLobby.style.display = 'none';
        btnStartCopyLobby.classList.add('hidden');
      }
    }
  }

  // ==================== 刷新房间列表 ====================
  function refreshRoomList() {
    if (socket && socket.connected) socket.emit('getRoomList');
  }

  function renderRoomList() {
    if (!lobbyRoomList || currentRoomId) return;
    if (!currentCopy) {
      if (lobbyCopyTitle) lobbyCopyTitle.textContent = '🏠 房间大厅';
      if (lobbyCopyInfo) lobbyCopyInfo.textContent = '请先从副本选择页进入';
      lobbyRoomList.innerHTML = '<div class="empty-room">← 请先返回副本选择页面选择一个副本</div>';
      return;
    }
    if (lobbyCopyTitle) lobbyCopyTitle.textContent = '🏠 ' + currentCopy;
    if (lobbyCopyInfo) lobbyCopyInfo.textContent = '难度：' + getCopyDiff(currentCopy) + ' | 公开房间';
    const filtered = allRooms.filter(r => r.copyName === currentCopy);
    lobbyRoomList.innerHTML = '';
    if (filtered.length === 0) {
      lobbyRoomList.innerHTML = '<div class="empty-room">该副本暂无公开房间<br>请创建新房间或输入房间码加入</div>';
      return;
    }
    filtered.forEach(room => {
      const card = document.createElement('div');
      card.className = 'hall-room-card';
      // ★ XSS 修复：房间名（用户输入昵称）必须转义
      card.innerHTML = '<span class="room-name">' + esc(room.hostName) + ' 的房间</span><span class="room-meta">' + (Number(room.playerCount) || 0) + '人 | ' + (room.isPrivate ? '🔒私密' : '🌐公开') + '</span>';
      card.addEventListener('click', () => {
        if (currentRoomId) { showAlert('请先离开当前房间'); return; }
        socket.emit('joinPublicRoom', { roomId: room.id });
      });
      lobbyRoomList.appendChild(card);
    });
  }

  // ==================== 渲染房间成员 ====================
  function renderRoomMembers() {
    if (!lobbyRoomPlayers) return;
    lobbyRoomPlayers.innerHTML = '';
    if (hallPlayers.length === 0) {
      lobbyRoomPlayers.innerHTML = '<div style="color:var(--dim);padding:8px;text-align:center;">暂无成员</div>';
      return;
    }
    hallPlayers.forEach(p => {
      const row = document.createElement('div');
      row.className = 'hall-player-row';
      const avatarSrc = _getPlayerAvatar(p);
      const hasAvatar = !!avatarSrc;
      const a = p.attr || {};
      const _name = esc(p.name), _career = esc(p.career || '未知职业'), _level = esc(String(p.level || 1)), _avatar = esc(avatarSrc);
      row.innerHTML = `
        <div class="hall-player-info">
          ${hasAvatar
            ? '<img class="hall-player-avatar" src="' + _avatar + '" alt="' + _name + '" onerror="this.style.display=\'none\';">'
            : '<span class="hall-player-avatar-fallback">👤</span>'}
          <div class="hall-player-detail">
            <span class="hall-player-name">${_name}${p.socketId === socket.id ? '（你）' : ''}</span>
            <span class="hall-player-career">${_career} · Lv.${_level}</span>
          </div>
          <div class="hall-player-vitals">
            <span class="vital-hp">❤️ ${a.hp ?? 0}/${a.maxHp ?? 0}</span>
            <span class="vital-san">🧠 ${a.san ?? 0}/${a.maxSan ?? 0}</span>
          </div>
        </div>
        <div class="hall-player-attrs">
          <span class="attr-cell" title="力量">💪${a.str ?? '?'}</span>
          <span class="attr-cell" title="敏捷">🏃${a.dex ?? '?'}</span>
          <span class="attr-cell" title="体力">🛡️${a.con ?? '?'}</span>
          <span class="attr-cell" title="智力">🧠${a.int ?? a.per ?? '?'}</span>
          <span class="attr-cell" title="魅力">🎭${a.cha ?? 40}</span>
          <span class="attr-cell" title="幸运">🍀${a.lck ?? 40}</span>
        </div>
        ${isRoomHost && p.socketId !== socket.id ? '<button class="btn-kick" data-sid="' + p.socketId + '">踢出</button>' : ''}
      `;
      const kickBtn = row.querySelector('.btn-kick');
      if (kickBtn) {
        kickBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await showConfirm('确定要踢出 ' + p.name + ' 吗？');
          if (ok) socket.emit('kickPlayer', { targetSocketId: p.socketId });
        });
      }
      lobbyRoomPlayers.appendChild(row);
    });
  }

  function _getPlayerAvatar(player) {
    try {
      const avatars = JSON.parse(localStorage.getItem('coc_avatars') || '{}');
      if (player.uid && avatars[player.uid]) return avatars[player.uid];
    } catch(e) {}
    return player.avatar || null;
  }

  // ==================== 事件绑定 ====================
  function bindEvents() {
    if (btnCreateRoomLobby) {
      btnCreateRoomLobby.addEventListener('click', async () => {
        if (currentRoomId) { showAlert('你已在房间中，无法重复创建'); return; }
        if (!currentCopy) { showAlert('请先回到副本选择页面选择副本'); return; }
        if (createRoomCopyLabel) createRoomCopyLabel.textContent = '副本：' + currentCopy;
        showModal(modalCreateRoom, true);
      });
    }

    if (btnJoinByCodeLobby) {
      btnJoinByCodeLobby.addEventListener('click', () => {
        if (currentRoomId) { showAlert('请先离开当前房间'); return; }
        showModal(modalJoinCode, true);
      });
    }

    // ★ 进副本前：技能搭配（当前角色）
    const btnSkillSetup = document.getElementById('btnSkillSetupLobby');
    if (btnSkillSetup) {
      btnSkillSetup.addEventListener('click', () => {
        if (!window.getCurrentCharacter || !window.getCurrentCharacter()) {
          showAlert('请先选择调查员角色');
          return;
        }
        if (typeof window.getCurrentCharacter().skillPoints !== 'number') {
          showAlert('当前职业暂不支持技能树系统');
          return;
        }
        if (window.SkillSetup) window.SkillSetup.open();
        else showAlert('技能搭配模块未加载');
      });
    }

    // ★ 任务板（进副本前接受/提交任务）
    const btnQuestBoard = document.getElementById('btnQuestBoardLobby');
    if (btnQuestBoard) {
      btnQuestBoard.addEventListener('click', () => {
        if (window.QuestBoard) {
          window.QuestBoard.init();
          if (_questBody && !_questBody._qbBound) {
            _questBody._qbBound = true;
            window.QuestBoard.open(_questBody);
          }
          showModal(_questModal, true);
        } else {
          showAlert('任务板模块未加载');
        }
      });
    }
    if (document.getElementById('btnQuestBoardClose')) {
      document.getElementById('btnQuestBoardClose').addEventListener('click', () => showModal(_questModal, false));
    }

    if (btnStartCopyLobby) {
      btnStartCopyLobby.addEventListener('click', () => {
        if (!currentRoomId) { showAlert('请先加入房间'); return; }
        if (!isRoomHost) { showAlert('只有房主可以启动副本'); return; }
        const copyToStart = currentCopy || null;
        if (!copyToStart) { showAlert('未选择副本'); return; }
        if (!hallPlayers || hallPlayers.length < 1) { showAlert('请先确保房间内有成员'); return; }
        btnStartCopyLobby.disabled = true;
        btnStartCopyLobby.textContent = '⏳ 副本开启中…';
        btnStartCopyLobby.style.opacity = '0.7';
        // ★ 飞页过渡动画 → 然后发送 startCopy
        if (window.CopySelectTransition?.play) {
          window.CopySelectTransition.play(() => {
            socket.emit('startCopy', { copyName: copyToStart });
          });
        } else {
          socket.emit('startCopy', { copyName: copyToStart });
        }
      });
    }

    if (btnLeaveRoomLobby) {
      btnLeaveRoomLobby.addEventListener('click', async () => {
        if (!currentRoomId) return;
        const ok = await showConfirm('确定要离开房间吗？');
        if (ok) socket.emit('leaveRoom');
      });
    }

    const btnConfirm = document.getElementById('btnConfirmCreateRoom');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => {
        const isPrivate = document.getElementById('roomPrivate')?.checked || false;
        if (!currentCopy) { showAlert('请先选择副本'); return; }
        socket.emit('createRoom', { isPrivate, copyName: currentCopy });
        showModal(modalCreateRoom, false);
      });
    }
    const btnCancelC = document.getElementById('btnCancelCreateRoom');
    if (btnCancelC) btnCancelC.addEventListener('click', () => showModal(modalCreateRoom, false));

    const btnJoin = document.getElementById('btnConfirmJoinCode');
    if (btnJoin) {
      btnJoin.addEventListener('click', () => {
        const code = document.getElementById('joinCodeInput')?.value.trim();
        if (!code) { showAlert('请输入房间码'); return; }
        socket.emit('joinRoomByCode', { roomCode: code });
        showModal(modalJoinCode, false);
      });
    }
    const btnCancelJ = document.getElementById('btnCancelJoinCode');
    if (btnCancelJ) btnCancelJ.addEventListener('click', () => showModal(modalJoinCode, false));
  }

  // ==================== Socket 事件（★ 2026-08-16 拆分至 roomHallSocket.js） ====================
  function registerSocketEvents() {
    if (!socket) return;
    window.RoomHallSocket.register(socket, {
      renderRoomList, renderRoomMembers, updateLobbyUI, switchPage, resetState, refreshRoomList,
      showToast, showAlert,
      setState: (patch) => {
        if ('allRooms' in patch) allRooms = patch.allRooms;
        if ('currentRoomId' in patch) currentRoomId = patch.currentRoomId;
        if ('isRoomHost' in patch) isRoomHost = patch.isRoomHost;
        if ('hallPlayers' in patch) hallPlayers = patch.hallPlayers;
        if ('currentCopy' in patch) currentCopy = patch.currentCopy;
      },
      pushHandler: (h) => _socketHandlers.push(h),
      active: () => _active,
      getRoomId: () => currentRoomId,
      isHost: () => isRoomHost
    });
  }

  // ==================== 暴露全局接口 ====================
  window.RoomHall = {
    init() { init(); },
    show() {
      _active = true;
      if (currentRoomId) {
        switchPage('pageRoomLobby');
        updateLobbyUI();
        return;
      }
      switchPage('pageCopySelect');
    },
    resetState,
    destroy() {
      _active = false;
      if (currentRoomId) socket.emit('leaveRoom');
      resetState();
      _socketHandlers.forEach(({ event, fn }) => { socket.off(event, fn); });
      _socketHandlers = [];
    },
    setCharacterData(data) {
      clearedCopies = data.clearedCopies || [];
      engravingTier = data.engravingTier || 'white';
      renderCopyCards();
      refreshRoomList();
    },
    getCurrentCopy() { return currentCopy; }
  };

  if (socket) {
    const doInit = () => setTimeout(() => {
      if (document.getElementById('copyCardsRing')) init();
    }, 150);
    if (socket.connected) doInit();
    else socket.on('connect', doInit);
  }

})();
