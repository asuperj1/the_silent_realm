// 确保 Socket.io 已加载
if (typeof io === 'undefined') {
  document.body.innerHTML = '<div style="color:red;padding:20px;">错误：Socket.io 库未加载，请检查服务器是否启动并访问 http://localhost:3000</div>';
  throw new Error('Socket.io not loaded');
}

// 全局 socket 实例（优化连接参数：缩短超时、快速重试）
window.socket = io({
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 5000,           // 从 8000 降至 5000
  transports: ['websocket', 'polling'] // 优先 WebSocket
});
const socket = window.socket;

// 导出弹窗函数给其他模块共享
window.showAlert = showAlert;
window.showConfirm = showConfirm;
window.showToast = showToast;
// 当前用户引用，供 roomHall.js 等模块读取 uid
Object.defineProperty(window, '_currentUser', { get() { return currentUser; } });

const DEBUG = true;
function debugLog(msg, data) { if (DEBUG) console.log(`[Client] ${msg}`, data || ''); }

// ==================== DOM 引用（延迟初始化） ====================
let loadingOverlay;
let modalCreateChar, modalVote, modalGroupAction, modalInventory, modalShop, modalCopyLog, modalCreateRoom, modalJoinCode;
let charList, btnNewChar, btnLogout;
let newCharName, newCharCareer, freePointsSpan, btnCreateChar, btnCancelCreate, attrSliders;
let voteTitleInput, voteOptionsContainer, voteTimerInput, btnConfirmVote, btnCloseVoteModal, btnAddOption;
let voteBox, voteTitlebar, btnVoteMin, btnVoteClose, btnVoteClose2, btnVoteMiniRestore, voteMini, voteForm, voteInProgress, vpTitle, vpCountdown, vpOptions, vpVoters, voteTitlebarText, voteMiniText;
let groupActionTitle, groupActionDesc, groupActionMembers, btnSubmitGroupAction, btnCancelGroupAction;
let publicLog, privateLog, sceneBg, actionInput, sendAction, playerInfoCard, btnSwitchChar, btnLogoutGame;
let teamInfoToggle, teamInfoBody, teamInfoList; // ★ 队友信息折叠框
let btnChannelToggle, channelMenu, channelOptions;
let funcBtns, btnVote, btnGroupAction;
let btnCloseShop, btnCloseInventory, btnCloseCopyLog;
let btnCompleteCopy = null;

// 小队聊天框
let teamChatLog;

// 发言者头像相关
let publicSpeakerAvatar, publicSpeakerName, privateSpeakerAvatar, privateSpeakerName;
let _currentSpeaker = 'KP'; // 'KP' | 'ChenHui'
let _chatView = 'public';  // 当前左侧聊天视图：public | team | private

// 状态
let currentUser = null;
let currentCharacter = null;
let allCharacters = [];
let roomPlayers = [];
let currentChannel = null;
let copyLog = [];
let voteOptions = ['赞成', '反对', '弃权'];
let isLoggingIn = false;
let activeVoteTimer = null;
let _voteState = null;   // 当前投票进度状态 { voteId, options, colors, total, voters, tally, myVoted }
// ★ 投票选项颜色（基础前两项：绿 / 红；更多选项按序分配）
const VOTE_COLORS = ['#4ade80', '#f87171', '#60a5fa', '#fbbf24', '#c084fc', '#fb923c', '#22d3ee', '#a3e635'];
let _silentRetryCount = 0;    // ★ 静默重试计数：前2次静默，第3次才展示重试按钮
const MAX_SILENT_RETRY = 2;
let _pendingSkillModal = null; // ★ 技能树/搭配静默选择角色：'tree' | 'setup' | null
let _currentTurn = 1;          // ★ 回合制：当前回合号（服务端 turnUpdate 同步）
Object.defineProperty(window, '_currentTurn', { get() { return _currentTurn; }, set(v) { _currentTurn = v; } });
window.selectedCopy = null;

// DOM 页面引用（支持新旧页面结构）
const pageCharacters = document.getElementById('pageCharacters');
const pageGame = document.getElementById('pageGame');
const pageCopySelect = document.getElementById('pageCopySelect');
const pageRoomLobby = document.getElementById('pageRoomLobby');
const pageWarehouse = document.getElementById('pageWarehouse');   // ★ 仓库独立页
const pageItemCatalog = document.getElementById('pageItemCatalog'); // ★ 全物品图鉴（后台）
const pageCharDetail = document.getElementById('pageCharDetail');   // ★ 角色详情配置界面（P0 5 标签）
// 兼容旧 pageRoomHall 引用（如果存在）
const pageRoomHall = document.getElementById('pageRoomHall');

// ==================== 工具函数 ====================
function showPage(page) {
  if (!page) return;
  [pageCharacters, pageCopySelect, pageRoomLobby, pageGame, pageWarehouse, pageItemCatalog, pageCharDetail].forEach(p => p?.classList.remove('active'));
  // 兼容旧 pageRoomHall
  if (pageRoomHall && page !== pageRoomHall) pageRoomHall.classList.remove('active');
  page.classList.add('active');

  // ─── 全局金色粒子 & 光束管理 ───
  const globalBeams = document.getElementById('globalGoldBeams');
  const _startGlobalGold = function() {
    if (window.GoldParticles?.globalInit) {
      window.GoldParticles.globalInit('globalGoldParticles');
      window.GoldParticles.globalStart();
    }
    if (globalBeams) globalBeams.classList.add('active');
  };
  const _stopGlobalGold = function() {
    if (window.GoldParticles?.globalStop) window.GoldParticles.globalStop();
    if (globalBeams) globalBeams.classList.remove('active');
  };

  // ★ 页面切换时自动管理 roomHall 和 isometricBg 模块生命周期
  if (page === pageCopySelect) {
    // ADR-005: 进入副本选择页 → 停止全局金尘，用专用 Canvas
    _stopGlobalGold();
    if (window.IsometricBg?.init) {
      window.IsometricBg.init('isometricBgCanvas');
      window.IsometricBg.start();
    }
    if (window.ObeliskAnim?.init) { window.ObeliskAnim.init('#obelisk'); }
    if (window.ObeliskAnim?.start) { window.ObeliskAnim.start(); }
    if (window.GoldParticles?.init) {
      window.GoldParticles.init('goldParticleCanvas');
      window.GoldParticles.start();
    }
    if (window.RoomHall?.resetState) window.RoomHall.resetState();
  } else if (page === pageRoomLobby || page === pageRoomHall) {
    // 大厅页 → 停止专用金尘，启用全局金尘 & 光束
    if (window.IsometricBg?.stop) window.IsometricBg.stop();
    if (window.ObeliskAnim?.stop) window.ObeliskAnim.stop();
    if (window.GoldParticles?.stop) window.GoldParticles.stop();
    _startGlobalGold();
  } else if (page === pageCharacters) {
    // 角色选择页 → 恢复全局金尘 & 光束（用户澄清：要去掉的是按钮流光，非背景）
    if (window.IsometricBg?.stop) window.IsometricBg.stop();
    if (window.ObeliskAnim?.stop) window.ObeliskAnim.stop();
    if (window.GoldParticles?.stop) window.GoldParticles.stop();
    _startGlobalGold();
    if (window.RoomHall?.destroy) window.RoomHall.destroy();
  } else if (page === pageCharDetail) {
    // 角色详情配置界面 → 同角色选择页（全局金尘背景）
    if (window.IsometricBg?.stop) window.IsometricBg.stop();
    if (window.ObeliskAnim?.stop) window.ObeliskAnim.stop();
    if (window.GoldParticles?.stop) window.GoldParticles.stop();
    _startGlobalGold();
  } else {
    // 游戏内 → 停止所有
    if (window.IsometricBg?.stop) window.IsometricBg.stop();
    if (window.ObeliskAnim?.stop) window.ObeliskAnim.stop();
    if (window.GoldParticles?.stop) window.GoldParticles.stop();
    _stopGlobalGold();
    if (window.RoomHall?.destroy) window.RoomHall.destroy();
  }
  // 切换到登录页时触发扉页刷新（仅在退出登录后）—— 已迁移至独立 /login.html 页面
  if (page === pageCharacters) {
    // noop: pageAuth removed
  }
}
function showModal(modal, show) {
  if (!modal) return;
  if (show) modal.classList.add('active'); else modal.classList.remove('active');
}
function showLoading(show) { if (loadingOverlay) loadingOverlay.classList.toggle('hidden', !show); }

// ========== 统一头像获取工具 ==========
function getAvatarForSender(sender, senderId) {
  // NPC 专属头像
  if (sender === '陈慧' || sender === 'ChenHui') {
    return window._chenhuiPortrait || 'assets/qingfeng_scenes/废都青峰山7号车配电间.png';
  }
  // 玩家头像：按 senderId 从 localStorage 缓存查找
  if (senderId) {
    try {
      const avatars = JSON.parse(localStorage.getItem('coc_avatars') || '{}');
      if (avatars[senderId]) return avatars[senderId];
    } catch(e) {}
  }
  // 当前角色头像
  if (currentCharacter?.avatar) return currentCharacter.avatar;
  // 返回 null 表示使用默认文字头像
  return null;
}

/** 获取消息类型分类 'kp' | 'player' | 'npc' | 'system' */
function getSenderType(sender, senderId) {
  if (sender === '系统') return 'system';
  if (sender === 'KP') return 'kp';
  if (sender === '陈慧' || sender === 'ChenHui') return 'npc';
  if (senderId && senderId === socket.id) return 'player';
  if (sender && sender !== 'KP' && sender !== '系统') return 'player';
  return 'kp';
}

/** 创建消息行 DOM（含头像+昵称+气泡），可选 contentNode 替代默认文本 */
function createChatMessage(msg, sender, senderId, avatarUrl, contentNode) {
  const row = document.createElement('div');
  row.className = 'chat-msg-row';
  const type = getSenderType(sender, senderId);
  const finalAvatar = avatarUrl || getAvatarForSender(sender, senderId);

  // 头像
  const avatarEl = document.createElement(finalAvatar ? 'img' : 'div');
  if (finalAvatar) {
    avatarEl.src = finalAvatar;
    avatarEl.className = `chat-avatar chat-avatar-${type}`;
    avatarEl.onerror = function() {
      this.style.display = 'none';
      const fallback = document.createElement('div');
      fallback.className = `chat-avatar chat-avatar-${type}`;
      fallback.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:bold;';
      fallback.textContent = (sender || '?').charAt(0);
      this.parentNode.replaceChild(fallback, this);
    };
  } else {
    avatarEl.className = `chat-avatar chat-avatar-${type}`;
    avatarEl.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;';
    avatarEl.textContent = (sender || '?').charAt(0);
  }

  // 气泡
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  const nick = document.createElement('span');
  nick.className = `chat-nickname chat-nickname-${type}`;
  nick.textContent = sender || '未知';

  bubble.appendChild(nick);
  if (contentNode) {
    bubble.appendChild(contentNode);
  } else {
    const text = document.createElement('p');
    text.className = 'chat-text';
    text.textContent = msg;
    bubble.appendChild(text);
  }
  row.appendChild(avatarEl);
  row.appendChild(bubble);
  return row;
}

function appendLog(element, msg, sender = '', senderId = '', avatarUrl = null) {
  if (!element) return;
  // ★ [object Object] 拦截：过滤非字符串类型的消息
  if (typeof msg !== 'string') {
    if (msg && typeof msg === 'object') {
      const text = msg.content || msg.msg || msg.story || msg.text || '';
      if (typeof text === 'string' && text.trim()) {
        msg = text;
      } else {
        console.warn('[appendLog] 过滤非字符串消息', msg);
        return;
      }
    } else {
      console.warn('[appendLog] 非法消息类型', typeof msg);
      return;
    }
  }
  // 当 KP 在公共频道发言时，自动恢复 KP 发言者面板
  if (element === publicLog && sender === 'KP') {
    restoreKpSpeaker();
  }
  // ★ 头像昵称消息行
  const row = createChatMessage(msg, sender || '系统', senderId, avatarUrl);
  element.appendChild(row);
  element.scrollTop = element.scrollHeight;
}

// 切换发言者（KP ↔ NPC，含头像和面板标题；显示与否由 setChatView 控制）
function setSpeaker(speakerKey, name, avatarSrc) {
  if (_currentSpeaker === speakerKey) return;
  _currentSpeaker = speakerKey;

  const isNPC = speakerKey !== 'KP';
  const avatarEl = publicSpeakerAvatar;
  const nameEl = publicSpeakerName;

  if (isNPC && avatarSrc) {
    if (avatarEl) { avatarEl.src = avatarSrc; }
    if (nameEl) { nameEl.textContent = `🎭 ${name}`; }
  } else {
    if (avatarEl) { avatarEl.src = ''; }
    if (nameEl) { nameEl.textContent = '📢 KP 全局播报'; }
  }
  setChatView(_chatView);
}

// 恢复 KP 发言者
function restoreKpSpeaker() {
  if (_currentSpeaker === 'KP') return;
  _currentSpeaker = 'KP';
  if (publicSpeakerAvatar) { publicSpeakerAvatar.src = ''; }
  if (publicSpeakerName) { publicSpeakerName.textContent = '📢 KP 全局播报'; }
  setChatView(_chatView);
}
function addToCopyLog(entry) {
  copyLog.push({ time: new Date().toISOString(), ...entry });
  renderCopyLog(); // ★ 内嵌副本日志即时刷新
  persistCopyLog(); // ★ 副本刷新持久化：记录实时写入 localStorage（刷新页面保留）
}

// ==================== 副本记录持久化（刷新页面保留当前副本记录） ====================
/** 将副本日志写入 localStorage（按角色隔离，最多 300 条） */
function persistCopyLog() {
  const uid = currentCharacter?.uid;
  if (!uid) return;
  try {
    localStorage.setItem('coc_copyLog_' + uid, JSON.stringify(copyLog.slice(-300)));
  } catch (e) { /* ignore */ }
}
/** 读取该角色上次副本日志（断线/刷新恢复用） */
function loadCopyLog(uid) {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem('coc_copyLog_' + uid);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
/** 清除该角色副本日志 */
function clearCopyLog(uid) {
  if (!uid) return;
  try { localStorage.removeItem('coc_copyLog_' + uid); } catch (e) { /* ignore */ }
}

// ==================== 统一自定义弹窗（替代浏览器 alert/confirm） ====================
let _dialogResolve = null;
function _popupDialog(title, msg, buttons) {
  // 移除上一个弹窗
  const old = document.getElementById('__customDialog');
  if (old) old.remove();
  if (_dialogResolve) { _dialogResolve(null); _dialogResolve = null; }

  const overlay = document.createElement('div');
  overlay.id = '__customDialog';
  overlay.className = 'modal active';
  overlay.style.zIndex = '400';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);display:flex;justify-content:center;align-items:center;z-index:400;';
  // ★ XSS 修复：改用 DOM API + textContent 构建（title/msg/按钮文字一律按文本渲染）
  const content = document.createElement('div');
  content.className = 'modal-content';
  content.style.cssText = 'min-width:300px;max-width:420px;text-align:center;padding:24px;';
  if (title) {
    const h2 = document.createElement('h2');
    h2.textContent = title;
    content.appendChild(h2);
  }
  const p = document.createElement('p');
  p.style.cssText = 'margin:12px 0;color:var(--text-bright);font-size:14px;line-height:1.7;';
  p.textContent = msg;
  content.appendChild(p);
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  buttons.forEach((b, i) => {
    const btn = document.createElement('button');
    btn.dataset.idx = i;
    if (b.primary) btn.style.cssText = 'background:linear-gradient(180deg,var(--btn-gold-hover)0%,var(--btn-gold)100%);color:#1a1200;';
    btn.textContent = b.text;
    actions.appendChild(btn);
  });
  content.appendChild(actions);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  return new Promise(resolve => {
    _dialogResolve = resolve;
    overlay.querySelectorAll('.modal-actions button').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const chosen = buttons[idx];
        document.body.removeChild(overlay);
        _dialogResolve = null;
        resolve(chosen ? chosen.value : null);
      });
    });
  });
}
// 简单提示弹窗
function showAlert(msg) {
  return _popupDialog('', msg, [{ text: '确定', value: 'ok', primary: true }]);
}
// 确认弹窗，返回 true/false。可选传入自定义按钮文字：showConfirm(msg, '好的', '算了')
function showConfirm(msg, confirmText, cancelText) {
  return _popupDialog('', msg, [
    { text: confirmText || '确定', value: true, primary: true },
    { text: cancelText || '取消', value: false, primary: false }
  ]).then(v => v === true);
}
// 自定义 UI 提示（短暂toast）
function showToast(msg) {
  const hint = document.createElement('div');
  hint.className = 'inline-hint';
  hint.textContent = msg;
  hint.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#2d2a24;color:#c9a44b;border:1px solid #c9a44b;padding:10px 24px;z-index:9999;border-radius:6px;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,0.6);pointer-events:none;';
  document.body.appendChild(hint);
  setTimeout(() => hint.remove(), 2200);
}
// ★ 红色警示 toast（操作失败：能量不足/冷却中/已行动…）
function showToastError(msg) {
  const hint = document.createElement('div');
  hint.className = 'inline-hint error';
  hint.textContent = msg;
  hint.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#3a1418;color:#ff7a7a;border:1px solid #ff5c5c;padding:10px 24px;z-index:9999;border-radius:6px;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,0.6);pointer-events:none;';
  document.body.appendChild(hint);
  setTimeout(() => hint.remove(), 2200);
}
window.showToastError = showToastError;

// ==================== 初始化 DOM ====================
function initDOMReferences() {
  // pageCharacters, pageGame, pageCopySelect, pageRoomLobby, pageRoomHall 已在模块顶层用 const 初始化
  loadingOverlay = document.getElementById('loadingOverlay');
  modalCreateChar = document.getElementById('modalCreateChar');
  modalVote = document.getElementById('modalVote');
  modalGroupAction = document.getElementById('modalGroupAction');
  modalInventory = document.getElementById('modalInventory');
  modalShop = document.getElementById('modalShop');
  modalCopyLog = document.getElementById('modalCopyLog');
  modalCreateRoom = document.getElementById('modalCreateRoom');
  modalJoinCode = document.getElementById('modalJoinCode');
  charList = document.getElementById('charList');
  btnNewChar = document.getElementById('btnNewChar');
  btnLogout = document.getElementById('btnLogout');
  newCharName = document.getElementById('newCharName');
  newCharCareer = document.getElementById('newCharCareer');
  freePointsSpan = document.getElementById('freePoints');
  btnCreateChar = document.getElementById('btnCreateChar');
  btnCancelCreate = document.getElementById('btnCancelCreate');
  attrSliders = {}; // 已迁移至 noUiSlider，由 window.AttrSlider 管理
  voteTitleInput = document.getElementById('voteTitleInput');
  voteOptionsContainer = document.getElementById('voteOptionsContainer');
  voteTimerInput = document.getElementById('voteTimerInput');
  btnConfirmVote = document.getElementById('btnConfirmVote');
  btnCloseVoteModal = document.getElementById('btnCloseVoteModal');
  btnAddOption = document.getElementById('btnAddOption');
  voteBox = document.getElementById('voteBox');
  voteTitlebar = document.getElementById('voteTitlebar');
  btnVoteMin = document.getElementById('btnVoteMin');
  btnVoteClose = document.getElementById('btnVoteClose');
  btnVoteClose2 = document.getElementById('btnVoteClose2');
  btnVoteMiniRestore = document.getElementById('btnVoteMiniRestore');
  voteMini = document.getElementById('voteMini');
  voteForm = document.getElementById('voteForm');
  voteInProgress = document.getElementById('voteInProgress');
  vpTitle = document.getElementById('vpTitle');
  vpCountdown = document.getElementById('vpCountdown');
  vpOptions = document.getElementById('vpOptions');
  vpVoters = document.getElementById('vpVoters');
  voteTitlebarText = document.getElementById('voteTitlebarText');
  voteMiniText = document.getElementById('voteMiniText');
  groupActionTitle = document.getElementById('groupActionTitle');
  groupActionDesc = document.getElementById('groupActionDesc');
  groupActionMembers = document.getElementById('groupActionMembers');
  btnSubmitGroupAction = document.getElementById('btnSubmitGroupAction');
  btnCancelGroupAction = document.getElementById('btnCancelGroupAction');
  publicLog = document.getElementById('publicLog');
  privateLog = document.getElementById('privateLog');
  sceneBg = document.getElementById('sceneBg');
  actionInput = document.getElementById('actionInput');
  sendAction = document.getElementById('sendAction');
  playerInfoCard = document.getElementById('playerInfoCard');
  teamInfoToggle = document.getElementById('teamInfoToggle');
  teamInfoBody = document.getElementById('teamInfoBody');
  teamInfoList = document.getElementById('teamInfoList');
  btnSwitchChar = document.getElementById('btnSwitchChar');
  btnLogoutGame = document.getElementById('btnLogoutGame');
  btnChannelToggle = document.getElementById('btnChannelToggle');
  channelMenu = document.getElementById('channelMenu');
  channelOptions = document.querySelectorAll('.channel-option');
  funcBtns = document.querySelectorAll('.func-btn');
  btnVote = document.getElementById('btnVote');
  btnGroupAction = document.getElementById('btnGroupAction');
  btnCloseShop = document.getElementById('btnCloseShop');
  btnCloseInventory = document.getElementById('btnCloseInventory');
  btnCloseCopyLog = document.getElementById('btnCloseCopyLog');

  // 发言者头像元素
  publicSpeakerAvatar = document.getElementById('publicSpeakerAvatar');
  publicSpeakerName = document.getElementById('publicSpeakerName');
  privateSpeakerAvatar = document.getElementById('privateSpeakerAvatar');
  privateSpeakerName = document.getElementById('privateSpeakerName');

  // 小队聊天框元素（现位于左侧共用聊天框内）
  teamChatLog = document.getElementById('teamChatLog');

  // "完成副本"按钮 —— 已移至右边栏 func-panel（防重复绑定）
  if (!window._domEventsBound) {
    window._domEventsBound = true;
    btnCompleteCopy = document.getElementById('btnCompleteCopy');
    if (btnCompleteCopy) {
      btnCompleteCopy.addEventListener('click', async () => {
        const ok = await showConfirm('确认完成副本并结算？副本内获得的装备与资源将全部保留。');
        if (ok) socket.emit('completeCopy', {});
      });
    }
    // ★ P1 中途放弃：评价降档 + 寂静点数仅 10%（服务端执行惩罚）
    const btnAbandonCopy = document.getElementById('btnAbandonCopy');
    if (btnAbandonCopy) {
      btnAbandonCopy.addEventListener('click', async () => {
        const ok = await showConfirm('中途放弃副本：评价降档、寂静点数仅发放 10%、不记录通关。已拾取的装备与资源仍保留。确定放弃？');
        if (ok) socket.emit('completeCopy', { abandon: true });
      });
    }
  } else {
    btnCompleteCopy = document.getElementById('btnCompleteCopy');
  }

  // ★ 统一折叠系统（替代旧 btnSkillToggle 单独逻辑）
  initCollapsibleSections();
  // ★ 左侧共用聊天框：小队频道 / 单人回应 切换
  bindChatSwitch();
  // ★ 左下角档案坞：点档案方块弹出 切换角色/退出登录
  bindPlayerDock();
  // ★ 队友状态常驻渲染
  renderTeamInfo();
}

// ==================== 右侧栏统一折叠系统 ====================
// ★ 幂等守卫：防止断线重连重复绑定监听
let _collapsibleBound = false;
function initCollapsibleSections() {
  if (_collapsibleBound) return; _collapsibleBound = true;
  document.querySelectorAll('.collapsible-section').forEach(section => {
    const key = 'coc_collapse_' + (section.dataset.section || 'unknown');
    // 恢复记忆的折叠状态
    const stored = localStorage.getItem(key);
    if (stored === '1') section.classList.add('collapsed');

    const toggleBtn = section.querySelector('.collapse-toggle-btn');
    const header = section.querySelector('.collapsible-header');
    const clickHandler = () => {
      const isNowCollapsed = section.classList.toggle('collapsed');
      localStorage.setItem(key, isNowCollapsed ? '1' : '0');
    };
    if (toggleBtn) toggleBtn.addEventListener('click', clickHandler);
    if (header) header.addEventListener('click', (e) => {
      // 避免点到按钮时触发两次
      if (e.target.closest('.collapse-toggle-btn')) return;
      clickHandler();
    });
  });
}

// ==================== 滑块模块已抽离至 attrSlider.js ====================
// 对外 API：window.AttrSlider.init() / .openModal() / .getValues()

// ==================== 角色 ====================

// 职业数据缓存
let professionsCache = null;
let selectedCareerName = '';

/**
 * 加载职业数据（从 API 或内建回退）
 */
async function loadProfessions() {
  if (professionsCache) return professionsCache;
  try {
    const resp = await fetch('/api/professions');
    const data = await resp.json();
    if (data.success) {
      professionsCache = data.professions;
      return data.professions;
    }
  } catch (e) {
    console.warn('职业 API 未响应，使用内建数据');
  }
  // 内建回退
  professionsCache = [
    { id:'fangshi',name:'方士',tag:'常规职业',hidden:false,emoji:'🔮',color:'#7b68ee',bonus:{wil:15,per:10,con:5},passive:{name:'望气避厄',desc:'进入遗迹类副本时预警陷阱，降低畸变诅咒附着概率',icon:'👁️'},skills:[{name:'符箓镇邪',desc:'投掷封印符箓，单体禁锢畸变怪物4秒并持续神圣伤害',icon:'📜',cooldown:15,type:'control'},{name:'丹雾护佑',desc:'释放药雾，小队全员回血并清除疫病类负面状态',icon:'🌿',cooldown:20,type:'heal'}]},
    { id:'jiaodoushi',name:'角斗士',tag:'常规职业',hidden:false,emoji:'⚔️',color:'#c0392b',bonus:{str:15,con:10,dex:5},passive:{name:'浴血韧性',desc:'生命值低于40%时物理抗性显著提升，残血坦度增强',icon:'🛡️'},skills:[{name:'盾击慑敌',desc:'近战范围重击，击退群怪并强制吸引怪物仇恨',icon:'🔰',cooldown:12,type:'taunt'},{name:'双刃突刺',desc:'向前冲刺斩击，对前排单体打出高额爆发物理伤害',icon:'🗡️',cooldown:10,type:'attack'}]},
    { id:'lianjinshushi',name:'炼金术士',tag:'常规职业',hidden:false,emoji:'⚗️',color:'#27ae60',bonus:{wil:15,per:10,con:5},passive:{name:'药剂稳态',desc:'自身饮用药剂效果时长翻倍，药剂负面副作用免疫',icon:'🧪'},skills:[{name:'腐蚀酸雾',desc:'抛洒腐蚀药剂形成范围雾区，持续灼烧区域内怪物护甲',icon:'☠️',cooldown:14,type:'attack'},{name:'应急爆弹',desc:'投掷炼金爆弹，造成范围爆炸同时残留灼烧地面',icon:'🧨',cooldown:16,type:'attack'}]},
  ];
  return professionsCache;
}

function openCreateCharModal() {
  // ★ 委托给 attrSlider 模块
  window.AttrSlider.openModal();
  selectedCareerName = '';
  if (newCharCareer) newCharCareer.value = '';
  updateCareerBadge();
  updateCareerPreview(null);
  renderCareerCards();
  showModal(modalCreateChar, true);
}

/**
 * 渲染职业卡片网格（仅显示本次更新后的 13 新职业）
 */
async function renderCareerCards() {
  const professions = await loadProfessions();
  const grid = document.getElementById('careerCardGrid');
  if (!grid) return;

  // ★ 只显示带 skillTreeId 的 13 新职业
  const visibleCareers = professions.filter(p => p.skillTreeId);

  grid.innerHTML = visibleCareers.map(p => {
    const isHidden = p.hidden;
    const borderStyle = isHidden ? 'border: 2px solid #c9a03a; box-shadow: 0 0 16px rgba(201,160,58,0.35);' : '';
    const tagLabel = isHidden ? '<span class="career-tag career-tag-hidden">🔒 隐藏</span>' : '';
    const bonusText = p.bonus ? Object.entries(p.bonus).map(([k,v]) => `${k.toUpperCase()}+${v}`).join(' ') : '';
    const resLabel = p.resource ? `<span class="career-res">资源「${p.resource}」</span>` : '';

    return `
      <div class="career-card ${isHidden ? 'career-hidden' : ''}" data-career="${p.name}" data-pid="${p.id}" style="${borderStyle}">
        <div class="career-card-header">
          <span class="career-emoji">${p.emoji}</span>
          <span class="career-name" style="color:${p.color}">${p.name}</span>
          ${tagLabel}
        </div>
        <div class="career-bonus">${bonusText} ${resLabel}</div>
        <div class="career-passive">
          <span class="skill-icon">✨</span>
          <span class="skill-label">被动</span>
          <span class="skill-name">${p.passive.name}</span>
        </div>
        <div class="career-passive-desc">${p.passive.desc}</div>
      </div>
    `;
  }).join('');

  // 绑定卡片点击事件
  grid.querySelectorAll('.career-card').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.career-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedCareerName = card.dataset.career;
      if (newCharCareer) newCharCareer.value = selectedCareerName;
      updateCareerBadge();
      const prof = visibleCareers.find(x => x.name === card.dataset.career);
      updateCareerPreview(prof);
    });
  });
}

/** 更新职业立绘预览（创建弹窗右侧） */
function updateCareerPreview(prof) {
  const img = document.getElementById('careerPreviewImg');
  const ph = document.getElementById('careerPreviewPlaceholder');
  const nameEl = document.getElementById('careerPreviewName');
  const descEl = document.getElementById('careerPreviewDesc');
  if (!img) return;
  if (!prof) {
    img.style.display = 'none';
    if (ph) ph.style.display = '';
    if (nameEl) nameEl.textContent = '';
    if (descEl) descEl.textContent = '';
    return;
  }
  const src = `/assets/characters/${prof.id}.png`;
  img.onerror = () => { img.style.display = 'none'; if (ph) ph.style.display = ''; };
  img.onload = () => { img.style.display = ''; if (ph) ph.style.display = 'none'; };
  img.src = src;
  if (nameEl) nameEl.textContent = `${prof.emoji || ''} ${prof.name}`;
  if (descEl) descEl.textContent = prof.passive?.desc || '';
}

function updateCareerBadge() {
  const badge = document.getElementById('selectedCareerBadge');
  if (!badge) return;
  badge.textContent = selectedCareerName || '未选择';
  badge.style.color = selectedCareerName ? '#d4b860' : 'rgba(180,160,130,0.5)';
}

/**
 * 检查隐藏职业（环系法师）解锁条件
 * 需要：橙刻痕及以上 + 通关全部3个新手副本
 */
function canUnlockHiddenCareer() {
  const player = currentCharacter || allCharacters[0];
  if (!player) return false;
  const hasOrangeEngrave = ['orange','darkgold'].includes(player.engravingTier || 'white');
  const clearedAllNovice = (player.clearedCopies || []).filter(c =>
    ['废都纪元800｜青峰山虚空列车','渔村纪元900｜雾潮潮间渔村','日之塔纪元1000｜荒野商队护送'].includes(c)
  ).length >= 3;
  return hasOrangeEngrave && clearedAllNovice;
}

function submitCreateChar() {
  const name = newCharName?.value.trim() || '';
  if (!name) { showToast('请输入角色姓名'); return; }
  // ★ 委托给 attrSlider 模块获取值
  const attr = window.AttrSlider.getValues();
  socket.emit('createCharacter', { uid: currentUser?.uid, characterData: { name, career: newCharCareer?.value, attr } });
  showModal(modalCreateChar, false);
}
function renderCharList() {
  // ★ DOM 就绪守卫：如果 charList 尚未挂载，延迟到下一帧重试
  if (!charList) {
    console.warn('[renderCharList] charList 未就绪，延迟渲染');
    requestAnimationFrame(() => renderCharList());
    return;
  }
  // ★ 页面可见性守卫：确保 pageCharacters 已激活（修复登录后角色列表不显示）
  if (pageCharacters && !pageCharacters.classList.contains('active')) {
    requestAnimationFrame(() => renderCharList());
    return;
  }
  charList.innerHTML = '';

  // ★ 空态处理：无角色时显示引导提示（修复登录后空白问题）
  if (!allCharacters || allCharacters.length === 0) {
    charList.innerHTML = `
      <div class="empty-char-hint" style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--dim);">
        <p style="font-size:48px;margin-bottom:16px;">📜</p>
        <p style="font-size:16px;color:var(--text-bright);margin-bottom:8px;">暂无调查员档案</p>
        <p style="font-size:13px;">点击「+ 新调查员」创建你的第一位调查员</p>
      </div>`;
    return;
  }

  const isNostyle = charList.classList.contains('nostyle-list');

  allCharacters.forEach(c => {
    const card = document.createElement('div'); card.className = 'char-card';
    card.dataset.charUid = c.uid;
    const engravingTier = c.engravingTier || 'white';
    const engravingLabels = { white: '白色刻痕', orange: '橙刻痕', darkgold: '暗金刻痕' };
    const engravingLabel = engravingLabels[engravingTier] || '白色刻痕';
    const cachedAvatar = loadAvatarFromCache(c.uid);
    const avatarSrc = cachedAvatar || c.avatar || 'assets/placeholder.png';
    // ★ XSS 修复：模板插值前统一转义用户可控字段
    const _name = escapeHtml(c.name), _career = escapeHtml(c.career);
    const _level = escapeHtml(String(c.level)), _uid = escapeHtml(c.uid);
    const _engravingLabel = escapeHtml(engravingLabel), _avatarSrc = escapeHtml(avatarSrc);

    if (isNostyle) {
      // ===== 沉浸档案模式 =====
      card.innerHTML = `
        <div class="dossier-row">
          <div class="char-avatar-wrap">
            <img class="char-avatar" src="${_avatarSrc}" alt="${_name}" onerror="this.src='assets/placeholder.png'">
          </div>
          <span class="dossier-name">${_name}</span>
          <span class="dossier-meta">${_career} · Lv.${_level}</span>
          <span class="dossier-engraving engraving-badge engraving-${engravingTier}">
            <span class="engraving-diamond">◆</span>${_engravingLabel}
          </span>
          <div class="dossier-actions">
            <button class="dossier-avatar-btn" title="更换头像">📷</button>
            <button class="dossier-del" title="删除角色">删除</button>
          </div>
        </div>
      `;
      const avatarBtn = card.querySelector('.dossier-avatar-btn');
      if (avatarBtn) avatarBtn.addEventListener('click', (e) => { e.stopPropagation(); triggerAvatarUpload(c); });
      const avatarImg = card.querySelector('.char-avatar');
      if (avatarImg) avatarImg.addEventListener('click', (e) => { e.stopPropagation(); triggerAvatarUpload(c); });
      const delBtn = card.querySelector('.dossier-del');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await showConfirm(`确认删除角色「${c.name}」？此操作不可撤销。`);
          if (ok) socket.emit('deleteCharacter', { uid: currentUser?.uid, characterUid: c.uid });
        });
      }
    } else {
      // ===== 默认卡片模式（P0：仅展示，点击打开角色详情配置界面） =====
      card.innerHTML = `
        <div class="char-card-top">
          <div class="char-avatar-wrap">
            <img class="char-avatar" src="${_avatarSrc}" alt="${_name}" onerror="this.src='assets/placeholder.png'">
            <div class="avatar-hover-overlay"><span>更换头像</span></div>
          </div>
          <div class="char-name-col">
            <div class="name">${_name}</div>
            <div class="char-career">${_career} Lv.${_level}</div>
          </div>
        </div>
        <div class="engraving-badge engraving-${engravingTier}" title="${_engravingLabel}">
          <span class="engraving-diamond">◆</span>${_engravingLabel}
        </div>
      `;
      const avatarImg = card.querySelector('.char-avatar');
      if (avatarImg) avatarImg.addEventListener('click', (e) => { e.stopPropagation(); triggerAvatarUpload(c); });
      const del = document.createElement('button'); del.textContent = '×'; del.className = 'char-del-btn';
      del.addEventListener('click', async e => {
        e.stopPropagation();
        const ok = await showConfirm(`确认删除角色「${c.name}」？此操作不可撤销。`);
        if (ok) socket.emit('deleteCharacter', { uid: currentUser?.uid, characterUid: c.uid });
      });
      card.appendChild(del);
    }

    // ★ P0：点击角色卡片 → 打开角色详情配置界面（不再直接进入副本选择页）
    card.addEventListener('click', () => {
      if (window.CharDetail?.open) window.CharDetail.open(c);
      else socket.emit('selectCharacter', { characterUid: c.uid });
    });
    charList.appendChild(card);
  });
}

// nostyleList 切换
let _nostyleListEnabled = false;
function toggleNostyleList() {
  _nostyleListEnabled = !_nostyleListEnabled;
  const btn = document.getElementById('btnToggleListStyle');
  if (btn) {
    btn.classList.toggle('active', _nostyleListEnabled);
    btn.textContent = _nostyleListEnabled ? '📋 卡片模式' : '📄 沉浸档案';
  }
  if (charList) charList.classList.toggle('nostyle-list', _nostyleListEnabled);
  renderCharList();
}

// 头像上传触发
function triggerAvatarUpload(characterData) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.png,.jpg,.jpeg';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    // 仅允许 png/jpg
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'png' && ext !== 'jpg' && ext !== 'jpeg') {
      showToast('仅支持 PNG/JPG 格式头像');
      return;
    }
    if (file.size > 512 * 1024) { showToast('头像图片不能超过512KB'); return; }
    // 压缩并转换为 base64
    const compressed = await compressAvatar(file);
    const reader = new FileReader();
    reader.onload = () => {
      const avatarData = reader.result;
      // 持久化到 localStorage（按角色 UID 存储）
      try {
        const avatars = JSON.parse(localStorage.getItem('coc_avatars') || '{}');
        avatars[characterData.uid] = avatarData;
        localStorage.setItem('coc_avatars', JSON.stringify(avatars));
      } catch (e) { console.warn('[Avatar] localStorage 存储失败', e); }
      // 更新 UI 中的头像
      updateAllAvatarInstances(characterData.uid, avatarData);
      // 发送到服务器持久化
      socket.emit('selectCharacter', { characterUid: characterData.uid });
      setTimeout(() => {
        socket.emit('updateAvatar', { avatarData: avatarData });
      }, 300);
    };
    reader.readAsDataURL(compressed);
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(() => input.remove(), 5000);
}

// 头像压缩（限制最大 200x200）
function compressAvatar(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      const maxSize = 200;
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        const ratio = Math.min(maxSize / w, maxSize / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        resolve(blob || file);
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// 更新页面上所有该角色的头像实例
function updateAllAvatarInstances(characterUid, avatarData) {
  // 更新角色卡片列表中的头像
  if (charList) {
    charList.querySelectorAll('.char-avatar').forEach(img => {
      const card = img.closest('.char-card');
      if (card && card.dataset && card.dataset.charUid === characterUid) {
        img.src = avatarData;
      }
    });
  }
  // 更新游戏内右侧栏头像
  const gameAvatar = playerInfoCard?.querySelector('.game-avatar');
  if (gameAvatar && currentCharacter && currentCharacter.uid === characterUid) {
    gameAvatar.src = avatarData;
  }
}

// 从 localStorage 加载头像缓存
function loadAvatarFromCache(characterUid) {
  try {
    const avatars = JSON.parse(localStorage.getItem('coc_avatars') || '{}');
    return avatars[characterUid] || null;
  } catch (e) { return null; }
}


// ==================== 投票（王者投降风格：可拖动/最小化/关闭 + 实时进度统计） ====================
// ==================== 投票系统（已迁移至 client-vote.js） ====================

// ==================== 集体行动 ====================
function openGroupAction() {
  showModal(modalGroupAction, true);
  if (groupActionMembers) {
    groupActionMembers.innerHTML = '';
    roomPlayers.forEach(p => { const span = document.createElement('span'); span.className='vote-member'; span.textContent = p.name; groupActionMembers.appendChild(span); });
  }
}
function submitGroupAction() {
  const title = groupActionTitle?.value.trim() || '';
  if (!title) { showToast('请输入行动名称'); return; }
  socket.emit('groupAction', { action: title, description: groupActionDesc?.value.trim() || '' });
  showModal(modalGroupAction, false);
  if (groupActionTitle) groupActionTitle.value = '';
  if (groupActionDesc) groupActionDesc.value = '';
}

// ==================== 功能弹窗 ====================
// ★ 幂等守卫：防止断线重连重复绑定按钮监听
let _funcButtonsBound = false;
function renderCopyLog() {
  const content = document.getElementById('copyLogContent');
  if (content) content.textContent = copyLog.map(e => `[${e.time}] [${e.type}] ${e.content}`).join('\n');
}
function bindFuncButtons() {
  if (_funcButtonsBound) return; _funcButtonsBound = true;
  funcBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (target === 'shop') openShopPage();
      else if (target === 'inventory') openInventoryPage();
      else if (target === 'copylog') { renderCopyLog(); showModal(modalCopyLog, true); }
    });
  });
  // 商店/背包独立页面：返回按钮 + 商店分类
  const btnShopBack = document.getElementById('btnShopBack');
  if (btnShopBack) btnShopBack.addEventListener('click', closeShopPage);
  const btnInvBack = document.getElementById('btnInvBack');
  if (btnInvBack) btnInvBack.addEventListener('click', closeInventoryPage);
  bindShopCats();
  bindInvCats();
  if (btnCloseCopyLog) btnCloseCopyLog.addEventListener('click', () => showModal(modalCopyLog, false));
}

// ==================== 商店 / 背包 独立页面跳转 ====================
function openShopPage() {
  document.getElementById('pageGame')?.classList.remove('active');
  document.getElementById('pageShop')?.classList.add('active');
  socket.emit('getShopItems');
}
function closeShopPage() {
  document.getElementById('pageShop')?.classList.remove('active');
  document.getElementById('pageGame')?.classList.add('active');
  // ★ 返回副本时刷新右栏消耗品/线索面板
  if (window.CluePanel?.refresh) window.CluePanel.refresh();
  socket.emit('getInventory');
}
function openInventoryPage() {
  document.getElementById('pageGame')?.classList.remove('active');
  document.getElementById('pageInventory')?.classList.add('active');
  socket.emit('getInventory');
}
function closeInventoryPage() {
  document.getElementById('pageInventory')?.classList.remove('active');
  document.getElementById('pageGame')?.classList.add('active');
  // ★ 返回副本时刷新右栏消耗品/线索面板
  if (window.CluePanel?.refresh) window.CluePanel.refresh();
}

// ==================== 行动指令模块（输入栏快捷指令 → 调用对应行动模块） ====================
// ★ 每条指令：cmd 为指令名，alias 为别名，desc 为面板说明，tpl 为映射到服务端的行动文本模板，arg 为参数提示
const ACTION_CMDS = [
  { cmd: '/移动', alias: ['/去', '/前往'], desc: '移动到指定车厢/位置', tpl: '前往{arg}', arg: '位置（如 3号车）' },
  { cmd: '/搜索', alias: ['/搜寻'], desc: '搜索目标区域/物品', tpl: '搜索{arg}', arg: '目标' },
  { cmd: '/检查', alias: ['/调查'], desc: '检查目标（尸体/日记/管道…）', tpl: '检查{arg}', arg: '目标' },
  { cmd: '/翻找', desc: '翻找货箱/行李堆', tpl: '翻找{arg}', arg: '目标' },
  { cmd: '/打开', desc: '打开门/箱/公文包', tpl: '打开{arg}', arg: '目标' },
  { cmd: '/观察', alias: ['/查看'], desc: '观察环境/窗外/通风口', tpl: '观察{arg}', arg: '目标' },
  { cmd: '/拾取', alias: ['/拿起'], desc: '拾取物品（撬棍/工具…）', tpl: '拾取{arg}', arg: '物品' },
  { cmd: '/使用', desc: '使用物品/道具', tpl: '使用{arg}', arg: '物品' },
  { cmd: '/对话', alias: ['/询问', '/交谈'], desc: '与目标交谈（陈慧/NPC）', tpl: '和{arg}对话', arg: '对象' },
  { cmd: '/帮助', desc: '查看全部行动指令', tpl: '', arg: '' }
];
/** 解析输入是否命中指令模块；返回 { cmd, arg, def } 或 null */
function resolveActionCmd(text) {
  const m = /^\/([^\s／]+)\s*(.*)$/.exec((text || '').trim());
  if (!m) return null;
  const head = '/' + m[1];
  const arg = (m[2] || '').trim();
  const def = ACTION_CMDS.find(c => c.cmd === head || (c.alias || []).includes(head));
  return { cmd: head, arg, def: def || null };
}
// ★ P2 KP 响应 loading 指示：发送行动后显示「KP 正在书写…」，收到 KP 回复后隐藏
function showKpLoading() {
  const el = document.getElementById('kpLoading');
  if (el) el.style.display = 'inline-block';
}
function hideKpLoading() {
  const el = document.getElementById('kpLoading');
  if (el) el.style.display = 'none';
}
/** 指令面板渲染 + 显隐（顶层函数，供 sendPlayerAction / 帮助指令调用） */
function renderCmdPanel() {
  const panel = document.getElementById('actionCmdPanel');
  if (!panel) return;
  panel.innerHTML = '<div class="cmd-panel-title">⚡ 行动指令 · 输入 /指令 快速行动</div>' +
    ACTION_CMDS.map(c => {
      const usage = c.arg ? `${c.cmd} ${c.arg}` : c.cmd;
      return `<div class="cmd-row" data-cmd="${c.cmd}"><span class="cmd-name">${c.cmd}</span><span class="cmd-usage">${escapeHtml(usage)}</span><span class="cmd-desc">${escapeHtml(c.desc)}</span></div>`;
    }).join('');
  panel.querySelectorAll('.cmd-row').forEach(row => {
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = ACTION_CMDS.find(x => x.cmd === row.dataset.cmd);
      if (!c) return;
      if (c.cmd === '/帮助') { showCmdPanel(false); return; }
      // ★ 仅填入命令本身（如 /搜索），参数由玩家自行补全，避免冗余占位
      if (actionInput) { actionInput.value = c.cmd; actionInput.focus(); }
      showCmdPanel(false);
    });
  });
}
function showCmdPanel(show) {
  const panel = document.getElementById('actionCmdPanel');
  if (!panel) return;
  if (show) renderCmdPanel();
  panel.classList.toggle('active', !!show);
}
/** 指令面板初始化绑定（幂等） */
let _cmdPanelBound = false;
function setupCmdPanel() {
  if (_cmdPanelBound) return; _cmdPanelBound = true;
  const input = actionInput;
  // ★ 全局（公共）频道发言时：点击/输入输入框 → 向上弹出指令面板
  if (input) {
    input.addEventListener('focus', () => { if (currentChannel === 'public') showCmdPanel(true); });
    input.addEventListener('input', () => { if (currentChannel === 'public') showCmdPanel(true); });
    input.addEventListener('blur', () => setTimeout(() => showCmdPanel(false), 150));
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.action-bar')) showCmdPanel(false);
  });
}

// ==================== 消息发送（频道校验 + 内联提示 + 指令模块） ====================
function sendPlayerAction() {
  const raw = actionInput?.value.trim() || '';
  if (!raw) return;
  if (!currentChannel) {
    showToast('请先选择发送频道');
    return;
  }
  if (!currentCharacter) return;
  let text = raw;
  // ★ 指令模块：输入 /指令 参数 → 解析并调用对应行动模块
  if (raw.startsWith('/')) {
    const resolved = resolveActionCmd(raw);
    if (!resolved || !resolved.def) {
      showToast('未知指令，输入 /帮助 查看可用指令');
      return;
    }
    if (resolved.def.cmd === '/帮助') { showCmdPanel(true); return; }
    if (!resolved.arg) { showToast(`用法：${resolved.def.cmd} ${resolved.def.arg}`); return; }
    text = resolved.def.tpl.replace('{arg}', resolved.arg);
  }
  if (currentChannel === 'private') socket.emit('privateAction', { content: text });
  else if (currentChannel === 'team') socket.emit('teamChat', { content: text });
  else socket.emit('playerAction', { content: text });
  addToCopyLog({ type:'action', content: text, channel: currentChannel });
  if (actionInput) actionInput.value = '';
  // ★ P2：发送行动（公共/私密）后显示 KP 书写 loading，收到回复后由事件处理器隐藏
  if (currentChannel !== 'team') showKpLoading();
}
// 频道菜单
// ★ 幂等守卫：防止断线重连重复绑定 document 级点击监听
let _channelDropdownBound = false;
function setupChannelDropdown() {
  if (_channelDropdownBound) return; _channelDropdownBound = true;
  if (btnChannelToggle) {
    btnChannelToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      channelMenu?.classList.toggle('active');
    });
  }
  channelOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      currentChannel = opt.dataset.channel;
      const labels = { private: '🔮 单人', public: '📢 公共', team: '💬 小队' };
      if (btnChannelToggle) btnChannelToggle.textContent = labels[currentChannel] || '📡 频道';
      channelMenu?.classList.remove('active');
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.channel-dropdown')) channelMenu?.classList.remove('active');
  });
}
// 进入副本时重置频道和输入框
function resetInputState() {
  if (actionInput) actionInput.value = '';
  // ★ 默认选中公共频道：聚焦输入框即弹出行动指令面板（命令提示），符合玩家发言习惯
  currentChannel = 'public';
  if (btnChannelToggle) btnChannelToggle.textContent = '📢 公共';
}

// ==================== 新手引导（首次进入副本分步教程） ====================
let _tutorialActive = false;
// ★ 清除所有教程高亮（.tutorial-highlight 的 z-index 2001 会盖住所有弹窗遮罩；中途刷新/异常退出后必须兜底清除）
function clearTutorialHighlight() {
  document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
}
window.clearTutorialHighlight = clearTutorialHighlight;   // ★ 暴露全局：弹窗打开/异常时可手动兜底清理
function showTutorial() {
  if (_tutorialActive) return;
  try {
    if (localStorage.getItem('coc_tutorial_done')) {
      clearTutorialHighlight();   // ★ 兜底：教程已完成但高亮残留（如中途刷新）→ 立即清除，防骰子/罗盘盖住弹窗
      return;
    }
  } catch (e) { /* ignore */ }
  _tutorialActive = true;
  const STEPS = [
    { title: '🎲 掷骰探索', desc: '每次探索行动会掷一颗骰子，点数 = 你本回合的操作次数上限。左下角就是骰子面板，行动时自动滚动。', target: '#dicePanel' },
    { title: '🧭 回合值罗盘', desc: '每次行动会消耗回合值（0.25~1）。罗盘指针随之累计，满 1.5 将强制结束本回合；也可随时点下方「结束回合」。', target: '#compassPanel' },
    { title: '⌨️ 行动输入栏', desc: '在这里描述你的行动（如「翻找货箱」），或输入 / 打开指令面板快速行动。先选频道：📢公共=全队可见，💬小队=队友可见。', target: '.action-bar' },
    { title: '⚔ 战斗 HUD', desc: '遇敌进入战斗：用技能 / 普攻打怪物，能量决定可行动次数。行动完点「结束行动」，全队结束行动后进入怪物回合。', target: '#lolHud' }
  ];
  let overlay = document.getElementById('tutorialOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'tutorialOverlay';
    overlay.className = 'tutorial-overlay';
    document.body.appendChild(overlay);
  }
  let step = 0;
  function render() {
    const s = STEPS[step];
    overlay.innerHTML = `
      <div class="tutorial-step-card">
        <div class="tutorial-title">${s.title}</div>
        <div class="tutorial-desc">${s.desc}</div>
        <div class="tutorial-progress">${step + 1} / ${STEPS.length}</div>
        <div class="tutorial-nav">
          <button class="tutorial-btn" id="tutSkip">跳过</button>
          <button class="tutorial-btn" id="tutPrev" ${step === 0 ? 'disabled' : ''}>上一步</button>
          <button class="tutorial-btn primary" id="tutNext">${step === STEPS.length - 1 ? '开始探索' : '下一步'}</button>
        </div>
      </div>`;
    document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
    const target = document.querySelector(s.target);
    if (target) target.classList.add('tutorial-highlight');
    const skip = document.getElementById('tutSkip');
    const prev = document.getElementById('tutPrev');
    const next = document.getElementById('tutNext');
    if (skip) skip.onclick = finish;
    if (prev) prev.onclick = () => { if (step > 0) { step--; render(); } };
    if (next) next.onclick = () => { if (step < STEPS.length - 1) { step++; render(); } else finish(); };
  }
  function finish() {
    try { localStorage.setItem('coc_tutorial_done', '1'); } catch (e) { /* ignore */ }
    clearTutorialHighlight();
    if (overlay) overlay.style.display = 'none';
    _tutorialActive = false;
  }
  overlay.style.display = 'flex';
  render();
}

// ==================== 左侧共用聊天框（小队频道 / 单人回应 切换） ====================
/** 切换左侧共用聊天框显示视图（公共 / 小队 / 单人 三频道） */
function setChatView(view) {
  _chatView = view;
  const toggle = document.getElementById('chatSwitchToggle');
  const publicLogEl = document.getElementById('publicLog');
  const privateLogEl = document.getElementById('privateLog');
  const teamChatLogEl = document.getElementById('teamChatLog');
  const pubName = document.getElementById('publicSpeakerName');
  const pubAvatar = document.getElementById('publicSpeakerAvatar');
  const privName = document.getElementById('privateSpeakerName');
  const privAvatar = document.getElementById('privateSpeakerAvatar');

  // 频道对应日志显示
  if (publicLogEl) publicLogEl.style.display = (view === 'public') ? '' : 'none';
  if (privateLogEl) privateLogEl.style.display = (view === 'private') ? '' : 'none';
  if (teamChatLogEl) teamChatLogEl.style.display = (view === 'team') ? '' : 'none';

  // 标题说话者：仅显示当前频道对应者（头像有 src 才显示）
  const showPub = view === 'public';
  const showPriv = view === 'private';
  if (pubName) pubName.style.display = showPub ? '' : 'none';
  if (pubAvatar) pubAvatar.style.display = (showPub && pubAvatar.getAttribute('src')) ? 'inline-block' : 'none';
  if (privName) privName.style.display = showPriv ? '' : 'none';
  if (privAvatar) privAvatar.style.display = (showPriv && privAvatar.getAttribute('src')) ? 'inline-block' : 'none';

  // 按钮文字
  const labels = { public: '📢 公共频道', private: '🔮 单人回应', team: '💬 小队频道' };
  if (toggle) toggle.textContent = labels[view] || '💬 小队频道';
}

/** 绑定左侧共用聊天框下拉切换 */
function bindChatSwitch() {
  const toggle = document.getElementById('chatSwitchToggle');
  const menu = document.getElementById('chatSwitchMenu');
  if (!toggle || !menu || toggle.dataset.bound) return;
  toggle.dataset.bound = '1';
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('active');
  });
  document.querySelectorAll('.chat-switch-option').forEach(opt => {
    opt.addEventListener('click', () => {
      setChatView(opt.dataset.view);
      menu.classList.remove('active');
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.chat-switch-dropdown')) menu.classList.remove('active');
  });
  // 默认显示公共频道（进入副本初始频道）
  setChatView('public');
}

// 进入副本时清空三方聊天记录，并默认显示公共频道
function resetChatForCopy() {
  if (publicLog) publicLog.innerHTML = '';
  if (privateLog) privateLog.innerHTML = '';
  if (teamChatLog) teamChatLog.innerHTML = '';
  // 恢复公共/小队频道占位提示
  if (publicLog) {
    const h = document.createElement('p');
    h.className = 'team-chat-hint';
    h.textContent = '— KP 全局播报 —';
    publicLog.appendChild(h);
  }
  if (teamChatLog) {
    const h = document.createElement('p');
    h.className = 'team-chat-hint';
    h.textContent = '— 和队友商量战术、交换线索 —';
    teamChatLog.appendChild(h);
  }
  setChatView('public');
}

// ==================== 左下角档案坞（点档案方块弹出 切换角色/退出登录） ====================
function bindPlayerDock() {
  const trigger = document.getElementById('playerDockTrigger');
  const popup = document.getElementById('playerDockPopup');
  if (!trigger || !popup || trigger.dataset.bound) return;
  trigger.dataset.bound = '1';
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.classList.toggle('active');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.player-dock')) popup.classList.remove('active');
  });
}

/** 将消息追加到小队聊天框（头像昵称升级版）
 *  @param {string} msg - 消息内容
 *  @param {string} sender - 发送者昵称
 *  @param {string} senderId - 发送者 socketId
 *  @param {string} type - 'player' | 'system'
 */
function appendTeamChat(msg, sender, senderId, type) {
  if (!teamChatLog) return;
  // 清除占位提示
  const hint = teamChatLog.querySelector('.team-chat-hint');
  if (hint) hint.remove();

  if (type === 'system') {
    const row = createChatMessage(msg, '系统', null, null);
    teamChatLog.appendChild(row);
  } else {
    const isSelf = senderId && socket.id === senderId;
    const displayName = isSelf ? (currentCharacter?.name || '你') : sender;
    const avatarUrl = isSelf ? (currentCharacter?.avatar || null) : getAvatarForSender(sender, senderId);
    const row = createChatMessage(msg, displayName, senderId, avatarUrl);
    teamChatLog.appendChild(row);
  }
  teamChatLog.scrollTop = teamChatLog.scrollHeight;
}

/** 简易 HTML 转义 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==================== UI 渲染 ====================
function updatePlayerInfo() {
  if (!playerInfoCard || !currentCharacter) return;
  const c = currentCharacter;
  const engravingTier = c.engravingTier || 'white';
  const engravingLabels = { white: '白色刻痕', orange: '橙刻痕', darkgold: '暗金刻痕' };
  const engravingLabel = engravingLabels[engravingTier] || '白色刻痕';
  // 优先使用 localStorage 缓存的头像
  const cachedAvatar = loadAvatarFromCache(c.uid);
  const avatarSrc = cachedAvatar || c.avatar || 'assets/placeholder.png';
  // ★ XSS 修复
  const _name = escapeHtml(c.name), _career = escapeHtml(c.career);
  const _level = escapeHtml(String(c.level)), _engravingLabel = escapeHtml(engravingLabel), _avatarSrc = escapeHtml(avatarSrc);
  playerInfoCard.innerHTML = `
    <div class="game-avatar-row">
      <div class="game-avatar-container">
        <img class="game-avatar" src="${_avatarSrc}" alt="${_name}" onerror="this.src='assets/placeholder.png'" title="点击更换头像">
        <button class="game-avatar-upload-btn">更换头像</button>
      </div>
      <div class="game-dock-info">
        <strong title="${_name}">${_name}</strong>
        <span class="game-dock-career">(${_career}) Lv.${_level}</span>
        <div class="engraving-badge engraving-${engravingTier}" title="${_engravingLabel}">
          <span class="engraving-diamond">◆</span>${_engravingLabel}
        </div>
      </div>
    </div>
    ❤️HP ${c.attr.hp}/${c.attr.maxHp}  🧠SAN ${c.attr.san}/${c.attr.maxSan}<br>💪力量 ${c.attr.str} 🏃敏捷 ${c.attr.dex} 🛡体力 ${c.attr.con} 🧠智力 ${c.attr.int ?? c.attr.per} 🎭魅力 ${c.attr.cha ?? 40} 🍀幸运 ${c.attr.lck ?? 40}
  `;
  // 头像点击上传
  const gAvatar = playerInfoCard.querySelector('.game-avatar');
  if (gAvatar) {
    gAvatar.addEventListener('click', () => triggerAvatarUpload(c));
  }
  // 悬浮按钮点击上传
  const gUploadBtn = playerInfoCard.querySelector('.game-avatar-upload-btn');
  if (gUploadBtn) {
    gUploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerAvatarUpload(c);
    });
  }
  // ★ LOL 血条/能量条同步
  renderLolStatus();
}
// ★ 队友信息折叠框：渲染每个队友的 HP/SAN（进度条）+ 五维属性，默认折叠
// ★ 战斗时显示每位队友的回合状态（阵亡/离线/行动中/已行动/待行动）
function _pctOf(v, max) {
  const n = Number(v), m = Number(max);
  if (!isFinite(n) || !isFinite(m) || m <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((n / m) * 100)));
}
// ★ 根据最新 battleStatus 计算队友回合状态徽标
// ★ 尖塔式：全队共享回合 → 每位玩家只有"待行动/已行动"两态（无单一"行动中"）
function _teammateTurnBadge(p) {
  const bs = window.__battleStatus;
  if (!bs || !bs.started || bs.over) return '';
  // ★ 单位匹配：优先 sid；队友断线重连（新 socketId）后观察者缓存未刷新 → 按名字兜底匹配
  const units = bs.units || [];
  const unit = units.find(u => u.sid === p.socketId) || units.find(u => u.name === p.name);
  if (!unit) return '';
  if (unit.dead) return '<span class="tim-turn dead">💀 阵亡</span>';
  // ★ 离线以房间玩家信息为准（roomUpdate 即时送达）；仅当房间未带 offline 标记时才回退战斗单位标记
  if (p && p.offline) return '<span class="tim-turn offline">📴 离线</span>';
  if (unit.offline && !(p && p.offline === false)) return '<span class="tim-turn offline">📴 离线</span>';
  // ★ 队伍回合（玩家行动阶段）：已行动 / 待行动
  if (bs.phase === 'player') {
    if (unit.acted) return '<span class="tim-turn done">✅ 已行动</span>';
    return '<span class="tim-turn wait">⏳ 待行动</span>';
  }
  // 怪物回合：统一展示待行动
  return '<span class="tim-turn wait">⏳ 待行动</span>';
}
// ★ 队友头像：优先职业立绘（assets/characters/{id}.png），加载失败回退职业 emoji
function _teammateAvatarHtml(p) {
  const career = (p && p.career) || '';
  const pro = (professionsCache || []).find(x => x.name === career || x.id === career);
  const emoji = (pro && pro.emoji) || '🎭';
  if (pro && pro.id) {
    return `<span class="tim-avatar"><img src="/assets/characters/${encodeURIComponent(pro.id)}.png" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display=''"><i class="tim-avatar-emoji" style="display:none">${emoji}</i></span>`;
  }
  return `<span class="tim-avatar"><i class="tim-avatar-emoji">${emoji}</i></span>`;
}
function renderTeamInfo() {
  if (!teamInfoList) return;
  // ★ 队友状态框不显示自己（自身信息见「调查员档案」）
  const teammates = (roomPlayers || []).filter(p => p.socketId !== socket.id);
  if (teammates.length === 0) {
    teamInfoList.innerHTML = '<div class="team-info-empty">暂无队友数据，进入副本后自动同步</div>';
    return;
  }
  teamInfoList.innerHTML = '';
  teammates.forEach(p => {
    // ★ 序号徽标：与地图坐标系队伍序号一致（roomPlayers 顺序 → ①-⑧）
    const seqIdx = (roomPlayers || []).findIndex(rp => rp.socketId === p.socketId);
    const seq = '①②③④⑤⑥⑦⑧'[(seqIdx >= 0 ? seqIdx : 0) % 8];
    const a = p.attr || {};
    const hp = a.hp ?? '?', maxHp = a.maxHp ?? '?';
    const san = a.san ?? '?', maxSan = a.maxSan ?? '?';
    const turnBadge = _teammateTurnBadge(p);   // ★ 队友回合状态
    const avatarHtml = _teammateAvatarHtml(p); // ★ 队友头像
    const card = document.createElement('div');
    card.className = 'team-info-member';
    card.innerHTML = `
      <div class="tim-head">
        <span class="tim-seq">${seq}</span>
        ${avatarHtml}
        <span class="tim-name">${escapeHtml(p.name)}</span>
        <span class="tim-career">${escapeHtml(p.career || '未知职业')} · Lv.${escapeHtml(String(p.level || 1))}</span>
        ${turnBadge}
      </div>
      <div class="tim-bars">
        <div class="tim-bar hp">
          <span class="tim-bar-label">❤️ HP</span>
          <div class="tim-bar-track"><div class="tim-bar-fill" style="width:${_pctOf(hp, maxHp)}%"></div></div>
          <span class="tim-bar-val">${hp}/${maxHp}</span>
        </div>
        <div class="tim-bar san">
          <span class="tim-bar-label">🧠 SAN</span>
          <div class="tim-bar-track"><div class="tim-bar-fill" style="width:${_pctOf(san, maxSan)}%"></div></div>
          <span class="tim-bar-val">${san}/${maxSan}</span>
        </div>
      </div>
      <div class="tim-attrs">
        <span class="attr-cell" title="力量">💪${a.str ?? '?'}</span>
        <span class="attr-cell" title="敏捷">🏃${a.dex ?? '?'}</span>
        <span class="attr-cell" title="体力">🛡️${a.con ?? '?'}</span>
        <span class="attr-cell" title="智力">🧠${a.int ?? a.per ?? '?'}</span>
        <span class="attr-cell" title="魅力">🎭${a.cha ?? 40}</span>
        <span class="attr-cell" title="幸运">🍀${a.lck ?? 40}</span>
      </div>`;
    teamInfoList.appendChild(card);
  });
}
// ★ 战斗状态同步钩子（client-hud 在 battleStart/battleTurn/battleEvent 时调用）→ 刷新队伍栏回合状态
window.__battleStatusSetter = function (st) {
  window.__battleStatus = st || null;
  renderTeamInfo();
};

// ★ 绑定队友信息框折叠交互（默认折叠，点击展开时即时渲染）
function bindTeamInfoToggle() {
  if (!teamInfoToggle || teamInfoToggle.dataset.bound) return;
  teamInfoToggle.dataset.bound = '1';
  teamInfoToggle.addEventListener('click', () => {
    const open = teamInfoBody.style.display !== 'none';
    teamInfoBody.style.display = open ? 'none' : 'block';
    const arrow = document.getElementById('teamInfoArrow');
    if (arrow) arrow.textContent = open ? '▸' : '▾';
    if (!open) renderTeamInfo();
  });
}
async function renderSkills() {
  const hud = document.getElementById('lolHud');
  if (!hud) return;
  const career = currentCharacter?.career;
  if (!career) {
    _setLolSkillIcon('lolSkillIconPassive', null, '❓');
    _setLolSkillIcon('lolSkillIcon1', null, '?');
    _setLolSkillIcon('lolSkillIcon2', null, '?');
    _setLolSkillIcon('lolSkillIcon3', null, '?');
    _setLolSkillIcon('lolSkillIcon4', null, '?');
    renderLolEquip();
    renderLolStatus();
    return;
  }

  const professions = await loadProfessions();
  const prof = professions.find(p => p.name === career);

  // 职业头像 + 等级（LOL 风格）：新职业用职业立绘，旧职业用玩家头像/emoji
  const avatarEl = document.getElementById('lolChampionAvatar');
  if (avatarEl) {
    if (prof?.skillTreeId) {
      // ★ 副本 HUD 头像 = 所选职业立绘
      avatarEl.innerHTML = `<img src="/assets/characters/${prof.id}.png" onerror="this.style.display='none';this.nextElementSibling.style.display=''"><span class="lol-avatar-emoji" style="display:none">${prof?.emoji || '🎭'}</span>`;
    } else {
      const cachedAvatar = loadAvatarFromCache(currentCharacter.uid);
      const src = cachedAvatar || currentCharacter.avatar;
      if (src) {
        avatarEl.innerHTML = `<img src="${src}" onerror="this.style.display='none';this.nextElementSibling.style.display=''"><span class="lol-avatar-emoji" style="display:none">${prof?.emoji || '🎭'}</span>`;
      } else {
        avatarEl.innerHTML = `<span class="lol-avatar-emoji">${prof?.emoji || '🎭'}</span>`;
      }
    }
  }
  const lvlEl = document.getElementById('lolChampionLevel');
  if (lvlEl) lvlEl.textContent = currentCharacter.level || 1;

  // 技能图标路径（character_skill.json）
  let skillIcons = null;
  try {
    const resp = await fetch('/api/character-skill-icons');
    if (resp.ok) {
      const data = await resp.json();
      if (data.success) skillIcons = data.skillIcons[prof?.id] || null;
    }
  } catch (e) { /* emoji 兜底 */ }

  // ★ 新职业（技能树）：按出战配置 equippedSkills 渲染 + 真实图标
  const isNewCareer = typeof currentCharacter.skillPoints === 'number';
  if (isNewCareer && prof?.skillTreeId) {
    let iconMap = null;
    try {
      const resp = await fetch('/api/skill-icons-map');
      if (resp.ok) { const d = await resp.json(); if (d.success) iconMap = d.map[prof.skillTreeId] || null; }
    } catch (e) {}
    const equipped = (currentCharacter.equippedSkills || []).slice(0, 4);
    const keys = ['Q', 'W', 'E', 'R'];
    // 被动（常驻）
    _renderLolSkill('lolSkillIconPassive', 'lolSkillPassive', prof?.passive, null, true, 'P');
    for (let i = 0; i < 4; i++) {
      const name = equipped[i];
      const fromProf = prof.skills?.find(s => s.name === name);
      const skillData = fromProf || { name: name || undefined, desc: '出战技能', icon: '✦', cooldown: 12 };
      if (!name) { _renderLolSkill('lolSkillIcon' + (i + 1), 'lolSkill' + (i + 1), null, null, false, keys[i]); continue; }
      _renderLolSkill('lolSkillIcon' + (i + 1), 'lolSkill' + (i + 1), skillData,
        iconMap && iconMap[name] ? { iconPath: iconMap[name] } : null, false, keys[i]);
    }
    renderLolEquip();
    renderLolStatus();
    return;
  }

  // 被动 / 主动1-4（5 技能格；超出职业技能的格子显示为未解锁）
  _renderLolSkill('lolSkillIconPassive', 'lolSkillPassive', prof?.passive, skillIcons?.passive, true, 'P');
  _renderLolSkill('lolSkillIcon1', 'lolSkill1', prof?.skills?.[0], skillIcons?.skill1, false, 'Q');
  _renderLolSkill('lolSkillIcon2', 'lolSkill2', prof?.skills?.[1], skillIcons?.skill2, false, 'W');
  _renderLolSkill('lolSkillIcon3', 'lolSkill3', prof?.skills?.[2], skillIcons?.skill3, false, 'E');
  _renderLolSkill('lolSkillIcon4', 'lolSkill4', prof?.skills?.[3], skillIcons?.skill4, false, 'R');

  // ★ 普攻键（装备格右侧）：战斗内 = battleAction 普攻（可指定目标）；非战斗锁定
  const atk = document.getElementById('lolAttack');
  if (atk) {
    atk.title = '普攻（战斗内点击攻击，可指定目标）';
    atk.onclick = () => {
      if (!_lolBattleActive) { if (window.showToast) window.showToast('⚔ 进入战斗后才能普攻'); return; }
      emitBattleAttack();
    };
  }

  renderLolEquip();
  renderLolStatus();
}

/**
 * ★ 战斗信息栏(LOL HUD) 屏幕自适应算法
 * 根据中间栏实际宽度动态计算缩放系数，设置 --lol-scale CSS 变量，
 * 使技能格/装备槽/普攻/能量槽/血条/头像等全部随屏幕大小自适应（小屏不溢出、大屏不浪费）。
 */
function layoutLolHud() {
  const hud = document.getElementById('lolHud');
  if (!hud) return;
  const col = hud.closest('.center-col') || hud.parentElement;
  const w = (col && col.clientWidth > 0) ? col.clientWidth : (window.innerWidth - 320);
  let scale = 1;
  if (w < 520) scale = 0.55;
  else if (w < 600) scale = 0.62;
  else if (w < 700) scale = 0.72;
  else if (w < 820) scale = 0.82;
  else if (w < 940) scale = 0.9;
  else if (w < 1080) scale = 0.96;
  else scale = 1;
  hud.style.setProperty('--lol-scale', String(scale));
}
// ★ 屏幕尺寸变化时实时重算战斗栏缩放
window.addEventListener('resize', () => { try { layoutLolHud(); } catch (e) {} });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { layoutLolHud(); } catch (e) {} });
else setTimeout(() => { try { layoutLolHud(); } catch (e) {} }, 0);

/** 生成 12 个装备槽方框 */
/** LOL 装备栏：渲染 6 槽已装备物品（图片 + 品质边框），随装备变化重建；★ 支持拖入装备 + hover 浮窗 */
function renderLolEquip() {
  const box = document.getElementById('lolEquip');
  if (!box) return;
  const c = currentCharacter;
  const equip = (c && c.equip) || {};
  const inv = (c && c.inventory) || [];
  box.innerHTML = '';
  INV_SLOT_DEFS.forEach(def => {
    const val = equip[def.key] || '';
    // ★ 已装备物品：背包 → _equipCache → 最小装备对象（hover 始终显示装备属性）
    const eqItem = val ? (inv.find(x => (x.itemName || x.name) === val) || _equipCache[def.key] || null) : null;
    const tipItem = eqItem || (val ? { itemName: val, itemId: EQUIP_ITEM_IDS[val], type: 'equipment', quality: 'white', desc: `当前穿戴：${val}`, slot: def.key } : null);
    const itemId = tipItem ? tipItem.itemId : null;
    const qColor = tipItem && tipItem.quality ? MC_QUALITY_COLOR[tipItem.quality] : null;
    const s = document.createElement('div');
    s.className = 'lol-equip-slot' + (val ? ' filled' : '');
    s.title = val ? `${def.label}: ${val}` : `${def.label} · 空`;
    s.innerHTML = itemId
      ? `<img src="/assets/items/${itemId}.png" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="le-emoji" style="display:none">${def.icon}</span>`
      : (val ? def.icon : '');
    // ★ 品质外发光（框外冒品质色光）
    if (qColor) { s.style.borderColor = qColor + 'aa'; s.style.boxShadow = `0 0 8px ${qColor}66, inset 0 0 5px ${qColor}33`; }
    // ★ hover 金色浮窗
    if (tipItem) attachItemTooltip(s, tipItem);
    else attachGoldTooltip(s, () => `<div class="gt-head"><span class="gt-icon" style="font-size:20px">${def.icon}</span><div class="gt-title"><div class="gt-name">${def.label}</div><div class="gt-badges"><span class="gt-t">装备槽</span></div></div></div><div class="gt-desc">从右侧快捷栏拖入对应装备即可穿戴</div>`);
    // ★ 拖入装备（接受背包/快捷栏/右栏 text/plain uid，含 __remove__ 前缀剥离）
    s.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; s.classList.add('drop-hover'); });
    s.addEventListener('dragleave', () => s.classList.remove('drop-hover'));
    s.addEventListener('drop', (e) => {
      e.preventDefault();
      s.classList.remove('drop-hover');
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;
      const uid = raw.startsWith('__remove__') ? raw.slice('__remove__'.length) : raw;
      if (!uid) return;
      // ★ 缓存已装备物品（背包移除后仍可渲染图片/浮窗）
      const it = inv.find(x => (x.uid || x.id) === uid);
      if (it) { _equipCache[def.key] = it; persistEquipCache(); }
      socket.emit('equipItem', { itemId: uid, slot: def.key });
      if (window.showToast) window.showToast(`已尝试装备到「${def.label}」`);
    });
    box.appendChild(s);
  });
}

/** 设置 LOL 技能格图标 */
function _setLolSkillIcon(cellId, iconPath, fallbackEmoji) {
  const cell = document.getElementById(cellId);
  if (!cell) return;
  cell.innerHTML = '';
  if (iconPath) {
    const img = document.createElement('img');
    img.src = iconPath;
    img.alt = '';
    img.onerror = () => { img.remove(); if (fallbackEmoji) cell.textContent = fallbackEmoji; };
    cell.appendChild(img);
  } else {
    if (fallbackEmoji) cell.textContent = fallbackEmoji;
  }
}

/** 渲染单个 LOL 技能格（被动 / 主动） */
function _renderLolSkill(cellId, slotId, skillData, iconCfg, isPassive, key) {
  const cell = document.getElementById(cellId);
  const slot = document.getElementById(slotId);
  if (!cell || !slot) return;
  slot.dataset.cdTurns = 0;
  slot.dataset.lastUsedTurn = 0;
  slot.classList.remove('cooldown', 'locked');
  // ★ 渲染时同步战斗锁定状态（被动永不锁定，主动非战斗锁定）
  slot.classList.toggle('battle-lock', !_lolBattleActive && !isPassive);
  if (!skillData) {
    _setLolSkillIcon(cellId, null, '?');
    slot.title = '未解锁';
    attachGoldTooltip(slot, () => '<div class="gt-empty">技能未解锁</div>');
    slot.classList.add('locked');
    return;
  }
  const iconPath = iconCfg?.iconPath;
  _setLolSkillIcon(cellId, iconPath, skillData.icon);
  // ★ 回合制 CD：cooldown(秒) / 5 → 回合数（10s→2回合、15s→3…）
  const cdTurns = Math.max(1, Math.round((parseInt(skillData.cooldown || 10, 10) || 10) / 5));
  slot.title = `${skillData.name}\n${skillData.desc}\n冷却 ${cdTurns} 回合`;
  // ★ hover 金色浮窗：技能信息 + 战斗模式下伤害/治疗估算
  attachGoldTooltip(slot, () => buildSkillTooltipHtml(skillData, isPassive, key));
  if (isPassive) {
    slot.classList.add('passive');
    slot.onclick = () => { if (window.showToast) window.showToast('被动技能自动生效'); };
    return;
  }
  // 主动技能：非战斗 = 副本技能 useSkill；战斗内 = 杀戮尖塔2式技能 battleAction（单体可指定目标）
  slot.onclick = () => {
    if (slot.classList.contains('cooldown')) return;
    if (!_lolBattleActive) {
      socket.emit('useSkill', { skillName: skillData.name });
      startSkillCdTurns(slot, cellId, cdTurns);
      return;
    }
    emitBattleSkill(skillData.name);
  };
}

/** 回合制技能 CD：记录使用回合，随 turnUpdate 刷新剩余回合 */
function startSkillCdTurns(slot, cellId, cdTurns) {
  if (!slot) return;
  if (slot._cdTimer) clearInterval(slot._cdTimer);
  slot._cdTimer = null;
  slot.dataset.cdTurns = parseInt(cdTurns || 1, 10);
  slot.dataset.usedTurn = _currentTurn || 1;
  slot.classList.add('cooldown');
  refreshSkillCds();
}

/** 根据当前回合刷新所有技能格 CD 显示（剩余回合数） */
function refreshSkillCds() {
  const turn = _currentTurn || 1;
  document.querySelectorAll('#lolHud .lol-skill[data-skill^="active"]').forEach(slot => {
    const cdTurns = parseInt(slot.dataset.cdTurns || '0', 10);
    const usedTurn = parseInt(slot.dataset.usedTurn || '0', 10);
    if (cdTurns <= 0 || usedTurn <= 0) return;
    const remain = cdTurns - (turn - usedTurn);
    const m = slot.id.match(/\d+/);
    const cdEl = m ? document.getElementById('lolSkillCd' + m[0]) : null;
    if (remain > 0) {
      slot.classList.add('cooldown');
      if (cdEl) cdEl.textContent = remain;
    } else {
      slot.classList.remove('cooldown');
      if (cdEl) cdEl.textContent = '';
      slot.dataset.cdTurns = 0;
      slot.dataset.usedTurn = 0;
    }
  });
}

/** 回合推进：更新回合显示 + 刷新技能 CD（服务端 turnUpdate 触发） */
function onTurnUpdate(turn) {
  _currentTurn = turn || 1;
  const el = document.getElementById('lolTurn');
  if (el) el.textContent = '回合 ' + _currentTurn;
  refreshSkillCds();
}

// ==================== 战斗信息实时计算（物攻/法攻/物防/法防/穿透/格挡/护盾） ====================
// 职业 → 定位（决定倍率模板；同时支持中文名与职业 id，兼容 professions 未加载场景）
const CAREER_ROLE = {
  fangshi: '法师', lianjinshushi: '法师', guanxingzhe: '法师', huanfashi: '法师', zhentan: '法师',
  jiaodoushi: '战士', wushi: '战士', haidao: '战士', baifuzhang: '战士',
  qishi: '坦克', jingguan: '坦克',
  qiangshou: '刺客', guishuxiaochou: '刺客',
  '方士': '法师', '炼金术师': '法师', '观星者': '法师', '环法师': '法师', '侦探': '法师',
  '角斗士': '战士', '武士': '战士', '海盗': '战士', '百夫长': '战士',
  '骑士': '坦克', '警官': '坦克',
  '枪手': '刺客', '诡术小丑': '刺客'
};
// 定位倍率模板：物攻/法攻/物防/法防/穿透/格挡/护盾
const ROLE_RATIO = {
  '坦克': { physAtk: 0.55, magAtk: 0.35, physDef: 1.0, magDef: 0.85, pierce: 0.15, block: 0.55, shield: 0.6 },
  '战士': { physAtk: 0.85, magAtk: 0.30, physDef: 0.75, magDef: 0.55, pierce: 0.40, block: 0.45, shield: 0.35 },
  '刺客': { physAtk: 1.10, magAtk: 0.35, physDef: 0.40, magDef: 0.45, pierce: 0.70, block: 0.25, shield: 0.30 },
  '法师': { physAtk: 0.30, magAtk: 1.10, physDef: 0.35, magDef: 0.85, pierce: 0.25, block: 0.20, shield: 0.55 }
};
// 职业基础值（各战斗数值的固定底数）
const BATTLE_BASE = { physAtk: 8, magAtk: 8, physDef: 6, magDef: 6, pierce: 0, block: 0, shield: 0 };
function careerRoleOf(career) {
  if (!career) return '战士';
  const pro = (window._professions || []).find(p => p.name === career || p.id === career);
  const id = pro ? pro.id : career;
  return CAREER_ROLE[id] || CAREER_ROLE[career] || '战士';
}
/** 战斗数值 = 职业基础值 + 属性 × 职业倍率（法术主属性 = (感知+意志)/2，替换物理栏的力量） */
function getCombatStats() {
  const c = currentCharacter;
  if (!c || !c.attr) return null;
  const a = c.attr;
  const str = a.str || 0, dex = a.dex || 0, con = a.con || 0, per = a.per || 0, wil = a.wil || 0;
  const r = ROLE_RATIO[careerRoleOf(c.career)];
  const spell = (per + wil) / 2;
  return {
    physAtk: BATTLE_BASE.physAtk + str * r.physAtk,
    magAtk: BATTLE_BASE.magAtk + spell * r.magAtk,
    physDef: BATTLE_BASE.physDef + con * r.physDef,
    magDef: BATTLE_BASE.magDef + spell * r.magDef,
    pierce: BATTLE_BASE.pierce + str * r.pierce,
    block: BATTLE_BASE.block + dex * r.block,
    shield: BATTLE_BASE.shield + wil * r.shield
  };
}
let _battleRolesCache = null;
function loadBattleRoles() {
  if (_battleRolesCache) return Promise.resolve(_battleRolesCache);
  return fetch('/api/battle-roles').then(r => r.json())
    .then(d => { _battleRolesCache = d; return d; })
    .catch(() => ({}));
}
function renderCombatStats() {
  const s = getCombatStats();
  if (!s) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('ccPhysAtk', Math.round(s.physAtk)); set('ccMagAtk', Math.round(s.magAtk));
  set('ccPhysDef', Math.round(s.physDef)); set('ccMagDef', Math.round(s.magDef));
  set('ccPierce', Math.round(s.pierce)); set('ccBlock', Math.round(s.block)); set('ccShield', Math.round(s.shield));
  // ★ 战斗机制数值：吸血/连击/招架/暴击（职业被动 + 装备词条）；伤害修正为引擎固定常量
  const c = currentCharacter || {};
  const sbLoader = window.__loadSkillBattle || (() => Promise.resolve({}));
  Promise.all([sbLoader(), loadProfessions(), loadBattleRoles()]).then(function (res) {
    const sb = res[0] || {}, proList = res[1] || [], roles = res[2] || {};
    const pro = proList.find(p => p.name === c.career || p.id === c.career);
    const pid = pro ? pro.id : c.career;
    const rc = roles[pid] || roles[c.career] || {};
    // ★ 吸血：职业战斗被动 + 装备被动词条（lifesteal）
    const sbPass = sb[pid] && sb[pid].passive;
    const ls = ((sbPass && sbPass.effect && sbPass.effect.lifesteal) || 0) + equipLifesteal(c);
    set('ccLifesteal', ls ? ls + '%' : '—');
    // ★ 连击（百夫长五段战姿）/ 招架架势（武士）/ 暴击回资源（诡术小丑）
    const trig = rc.passive && rc.passive.trigger;
    if (trig && trig.onCombo) set('ccCombo', (trig.maxCombo || 5) + '段·+8%/段');
    else set('ccCombo', '—');
    if (trig && trig.threshold) set('ccParry', '阈值' + trig.threshold);
    else set('ccParry', '—');
    if (rc.resourceRule && rc.resourceRule.gainOnCrit) set('ccCrit', '回' + rc.resourceRule.gainOnCrit);
    else set('ccCrit', '—');
  });
}

// ★ 从角色已装备物品词条提取机制数值（吸血 lifesteal 等）
function equipLifesteal(c) {
  let ls = 0;
  try {
    const eq = (c && c.equip) || {};
    const inv = (c && c.inventory) || [];
    Object.keys(eq).forEach(slot => {
      const name = eq[slot];
      if (!name) return;
      const item = inv.find(i => (i.name === name) || (i.itemName === name) || (i.itemId === name));
      const effs = (item && item.effects) || [];
      effs.forEach(e => {
        const eff = e.effect || e;
        if (eff.lifesteal) ls += eff.lifesteal;
      });
    });
  } catch (e) { /* ignore */ }
  return ls;
}

// ==================== 能量池（非战斗 0/0，战斗随掷骰填充，颜色随职业） ====================
let _lolBattleActive = false;   // 是否处于战斗
let _battleEnergy = 0;          // 当前能量（掷骰点数）
let _battleEnergyMax = 0;       // 能量上限（能量骰最大，如 3D6=18）
// 职业 → 能量液体颜色（同时支持中文名与职业 id）
const CAREER_ENERGY_COLOR = {
  fangshi: '#a78bfa', lianjinshushi: '#34d399', guanxingzhe: '#fbbf24', huanfashi: '#60a5fa',
  zhentan: '#f9a8d4', jiaodoushi: '#f87171', wushi: '#fb923c', haidao: '#22d3ee',
  baifuzhang: '#a3e635', qishi: '#facc15', jingguan: '#38bdf8', qiangshou: '#f472b6',
  guishuxiaochou: '#c084fc',
  '方士': '#a78bfa', '炼金术师': '#34d399', '观星者': '#fbbf24', '环法师': '#60a5fa',
  '侦探': '#f9a8d4', '角斗士': '#f87171', '武士': '#fb923c', '海盗': '#22d3ee',
  '百夫长': '#a3e635', '骑士': '#facc15', '警官': '#38bdf8', '枪手': '#f472b6',
  '诡术小丑': '#c084fc'
};
function careerEnergyColor(career) {
  if (!career) return '#a78bfa';
  const pro = (window._professions || []).find(p => p.name === career || p.id === career);
  const id = pro ? pro.id : career;
  return CAREER_ENERGY_COLOR[id] || CAREER_ENERGY_COLOR[career] || '#a78bfa';
}
function renderEnergyPool() {
  const orb = document.getElementById('lolEnergy');
  const fill = document.getElementById('lolEnergyFill');
  const text = document.getElementById('lolEnergyText');
  if (!orb) return;
  orb.style.setProperty('--energy-color', careerEnergyColor(currentCharacter && currentCharacter.career));
  if (!_lolBattleActive) {
    // 非战斗：纯黑液体 0/0
    if (fill) fill.style.height = '0%';
    if (text) text.textContent = '0/0';
    orb.title = '能量池（进入战斗后随掷骰填充）';
  } else {
    const max = _battleEnergyMax || 1;
    const e = Math.max(0, Math.min(max, _battleEnergy || 0));
    if (fill) fill.style.height = (max ? (e / max) * 100 : 0) + '%';
    if (text) text.textContent = e + '/' + max;
    orb.title = '能量 ' + e + '/' + max;
  }
}
/** 战斗模式切换：锁定/解锁技能与普攻，能量池 0/0 或随战斗更新 */
function setLolBattleMode(active) {
  _lolBattleActive = !!active;
  if (!_lolBattleActive) { _battleEnergy = 0; _battleEnergyMax = 0; }
  // ★ 被动始终不锁定；主动技能/普攻非战斗锁定
  document.querySelectorAll('#lolHud .lol-skill').forEach(s => {
    const isPassive = s.classList.contains('passive');
    s.classList.toggle('battle-lock', !_lolBattleActive && !isPassive);
  });
  const atk = document.getElementById('lolAttack');
  if (atk) atk.classList.toggle('battle-lock', !_lolBattleActive);
  renderEnergyPool();
}
// ★ 初始非战斗状态：锁定技能/普攻、能量池 0/0
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setLolBattleMode(false));
else setLolBattleMode(false);

// ==================== 战斗目标选择（杀戮尖塔2式：多怪时点击怪物指定目标） ====================
let _targetMode = null; // { type:'attack' } 或 { type:'skill', skillId }
function beginTargetMode(pending) {
  _targetMode = pending;
  if (window.BattleScene && window.BattleScene.setTargetMode) window.BattleScene.setTargetMode(true);
  if (window.showToast) window.showToast('🎯 已进入选目标：点击怪物头像');
}
function cancelTargetMode() {
  _targetMode = null;
  if (window.BattleScene && window.BattleScene.setTargetMode) window.BattleScene.setTargetMode(false);
}
/** 战斗普攻：仅 1 只怪直接打，多怪进入选目标；★ 能量不足本地预判不发请求 */
function emitBattleAttack() {
  if (_lolBattleActive && (_battleEnergy || 0) < 2) {
    if (window.showToastError) window.showToastError('⚠ 能量不足（普攻需 2）');
    else if (window.showToast) window.showToast('⚠ 能量不足（普攻需 2）');
    return;
  }
  const alive = (window.BattleScene && window.BattleScene.monsterCount) ? window.BattleScene.monsterCount() : 1;
  if (alive <= 1) { cancelTargetMode(); socket.emit('battleAction', { action: 'attack' }); }
  else beginTargetMode({ type: 'attack' });
}
/** 战斗技能：群攻(target=all)或仅 1 只怪直接放，单体多怪进入选目标；★ 能量不足本地预判不发请求 */
function emitBattleSkill(skillId) {
  const loader = window.__loadSkillBattle || (() => Promise.resolve({}));
  Promise.all([loader(), loadProfessions()]).then((res) => {
    const sb = res[0] || {};
    const proList = res[1] || [];
    const c = currentCharacter || {};
    const pro = proList.find(p => p.name === c.career || p.id === c.career);
    const pid = pro ? pro.id : c.career;
    const sk = (sb[pid] && sb[pid].skills && sb[pid].skills[skillId]) || null;
    // ★ 能量预判：技能 AP 不足则本地提示，不发请求
    if (_lolBattleActive && sk && sk.ap) {
      const need = parseInt(sk.ap, 10) || 0;
      if ((_battleEnergy || 0) < need) {
        if (window.showToastError) window.showToastError('⚠ 能量不足（技能需 ' + need + '）');
        else if (window.showToast) window.showToast('⚠ 能量不足（技能需 ' + need + '）');
        return;
      }
    }
    const isAll = sk && sk.target === 'all';
    const alive = (window.BattleScene && window.BattleScene.monsterCount) ? window.BattleScene.monsterCount() : 1;
    if (isAll || alive <= 1) { cancelTargetMode(); socket.emit('battleAction', { action: 'skill', skillId }); }
    else beginTargetMode({ type: 'skill', skillId });
  }).catch(() => { cancelTargetMode(); socket.emit('battleAction', { action: 'skill', skillId }); });
}
/** 特殊资源技能（不耗 AP）：效果需对敌人（debuff）且多怪时选目标 */
function emitBattleResourceSkill() {
  const needTarget = !!window.__battleResSkillNeedTarget;
  const alive = (window.BattleScene && window.BattleScene.monsterCount) ? window.BattleScene.monsterCount() : 1;
  if (!needTarget || alive <= 1) { cancelTargetMode(); socket.emit('battleAction', { action: 'resourceSkill' }); }
  else beginTargetMode({ type: 'resourceSkill' });
}
/** 装填（枪手：消耗1AP回子弹，无需选目标） */
function emitBattleReload() {
  cancelTargetMode();
  socket.emit('battleAction', { action: 'reload' });
}
/** 标记弱点（侦探：消耗2探知标记目标易伤+1，需选目标） */
function emitBattleMarkWeak() {
  const alive = (window.BattleScene && window.BattleScene.monsterCount) ? window.BattleScene.monsterCount() : 1;
  if (alive <= 1) { cancelTargetMode(); socket.emit('battleAction', { action: 'markWeak' }); }
  else beginTargetMode({ type: 'markWeak' });
}
/** 选目标模式：点击怪物 → 发出带 target 的 battleAction */
function bindTargetClick() {
  const mo = document.getElementById('battleMonsters');
  if (!mo) return;
  mo.addEventListener('click', (e) => {
    if (!_targetMode) return;
    const unit = e.target.closest('.battle-monster');
    if (!unit || unit.classList.contains('dead')) return;
    const idx = parseInt(unit.dataset.monsterIdx, 10);
    const pm = _targetMode;
    cancelTargetMode();
    if (pm.type === 'attack') socket.emit('battleAction', { action: 'attack', target: idx });
    else if (pm.type === 'skill') socket.emit('battleAction', { action: 'skill', skillId: pm.skillId, target: idx });
    else if (pm.type === 'resourceSkill') socket.emit('battleAction', { action: 'resourceSkill', target: idx });
    else if (pm.type === 'markWeak') socket.emit('battleAction', { action: 'markWeak', target: idx });
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTargetClick);
else bindTargetClick();

/** LOL 血条 / 能量条更新 */
function renderLolStatus() {
  const c = currentCharacter;
  if (!c || !c.attr) return;
  renderCombatStats();
  const hp = c.attr.hp ?? 0, maxHp = c.attr.maxHp || 1;
  const san = c.attr.san ?? 0, maxSan = c.attr.maxSan || 1;
  const hpFill = document.getElementById('lolHpFill');
  if (hpFill) hpFill.style.width = Math.max(0, Math.min(100, (hp / maxHp) * 100)) + '%';
  const hpText = document.getElementById('lolHpText');
  if (hpText) hpText.textContent = `${hp}/${maxHp}`;
  const sanFill = document.getElementById('lolSanFill');
  if (sanFill) sanFill.style.width = Math.max(0, Math.min(100, (san / maxSan) * 100)) + '%';
  // ★ SAN 条颜色随损耗：满值淡紫 / 中等损耗暗紫 / 濒临疯狂深紫近黑
  const sanRatio = maxSan ? san / maxSan : 0;
  if (sanFill) {
    let grad;
    if (sanRatio >= 0.8) grad = 'linear-gradient(180deg, #f3e8ff 0%, #c4b5fd 55%, #a78bfa 100%)';
    else if (sanRatio >= 0.45) grad = 'linear-gradient(180deg, #b39dff 0%, #7c3aed 55%, #5b21b6 100%)';
    else grad = 'linear-gradient(180deg, #4c1d95 0%, #2e1065 60%, #160b33 100%)';
    sanFill.style.background = grad;
  }
  const sanText = document.getElementById('lolSanText');
  if (sanText) sanText.textContent = `${san}/${maxSan}`;

  // ★ P0 SAN 档位化：60-80 清醒 / 30-59 恍惚 / 12-29 错乱 / 0-11 异化（绝对阈值，对齐 maxSan=80）
  const sanTag = document.getElementById('lolSanTag');
  if (sanTag) {
    let tier = '', tierCls = '';
    if (san >= 60) { tier = '清醒'; tierCls = 'san-tier-clear'; }
    else if (san >= 30) { tier = '恍惚'; tierCls = 'san-tier-hazy'; }
    else if (san >= 12) { tier = '错乱'; tierCls = 'san-tier-deranged'; }
    else { tier = '异化'; tierCls = 'san-tier-alien'; }
    sanTag.textContent = tier;
    sanTag.className = 'lol-san-tag ' + tierCls;
  }

  // ★ 能量池：非战斗 0/0，战斗随掷骰填充（液体颜色随职业）
  renderEnergyPool();
}

/** 副本回合冷却更新：将秒数CD转为回合显示 */
function updateDungeonSkillCooldowns(currentTurn) {
  const state = window._dungeonState;
  if (!state) return;

  [1, 2, 3, 4].forEach(idx => {
    const slot = document.getElementById(`lolSkill${idx}`);
    const cdEl = document.getElementById(`lolSkillCd${idx}`);
    if (!slot) return;
    const cdTurns = parseInt(slot.dataset.cdTurns || 0);
    const lastUsedTurn = parseInt(slot.dataset.lastUsedTurn || 0);
    if (cdTurns > 0 && lastUsedTurn > 0) {
      const remainingTurns = cdTurns - (currentTurn - lastUsedTurn);
      if (remainingTurns > 0) {
        if (cdEl) cdEl.textContent = remainingTurns;
        slot.classList.add('cooldown');
        return;
      }
    }
    if (cdEl) cdEl.textContent = '';
    slot.classList.remove('cooldown');
  });
}

// 暴露给外部模块（battle.js 等）
window.updateDungeonSkillCooldowns = updateDungeonSkillCooldowns;

// ★ 暴露当前角色/队友给独立面板模块（cluePanel 等）
window.getCurrentCharacter = () => currentCharacter;
window.getRoomPlayers = () => roomPlayers;

/** 设置技能图标格子：优先加载 PNG，失败则回退 emoji */
function _setSkillIcon(cell, iconPath, fallbackEmoji) {
  if (!cell) return;
  const fallbackEl = cell.querySelector('.skill-icon-fallback');
  // 清除旧内容（保留 cd-mask 和 cd-overlay）
  const oldImg = cell.querySelector('img');
  if (oldImg) oldImg.remove();

  if (iconPath) {
    const img = document.createElement('img');
    img.src = iconPath;
    img.alt = '';
    img.onerror = () => {
      img.remove();
      if (fallbackEl) fallbackEl.style.display = '';
    };
    img.onload = () => {
      if (fallbackEl) fallbackEl.style.display = 'none';
    };
    cell.insertBefore(img, cell.firstChild);
  }
  if (fallbackEl) {
    fallbackEl.textContent = fallbackEmoji || '';
    fallbackEl.style.display = iconPath ? '' : '';
  }
}

/** 渲染单个主动技能行 */
function _renderActiveSkill(rowId, iconCellId, nameId, descId, cdBadgeId, cdOverlayId, skillData, iconCfg) {
  const row = document.getElementById(rowId);
  const iconCell = document.getElementById(iconCellId);
  const nameEl = document.getElementById(nameId);
  const descEl = document.getElementById(descId);
  const cdBadge = document.getElementById(cdBadgeId);
  const cdOverlay = document.getElementById(cdOverlayId);

  if (!row || !skillData) {
    if (row) row.style.display = 'none';
    return;
  }
  row.style.display = '';
  row.className = 'skill-row skill-row-active';

  const iconPath = iconCfg?.iconPath;
  if (iconCell) {
    const fallbackEl = iconCell.querySelector('.skill-icon-fallback');
    // 清除旧图片
    const oldImg = iconCell.querySelector('img');
    if (oldImg) oldImg.remove();

    if (iconPath) {
      const img = document.createElement('img');
      img.src = iconPath;
      img.alt = '';
      img.onerror = () => {
        img.remove();
        if (fallbackEl) fallbackEl.style.display = '';
      };
      img.onload = () => {
        if (fallbackEl) fallbackEl.style.display = 'none';
      };
      iconCell.insertBefore(img, iconCell.firstChild);
    }
    if (fallbackEl) {
      fallbackEl.textContent = skillData.icon || '';
      fallbackEl.style.display = iconPath ? '' : '';
    }
  }

  if (nameEl) nameEl.textContent = skillData.name;
  if (descEl) descEl.textContent = skillData.desc;
  if (cdBadge) cdBadge.textContent = 'CD ' + skillData.cooldown + 's';
  if (cdOverlay) cdOverlay.textContent = '';

  // 绑定点击事件
  row.onclick = () => {
    if (row.classList.contains('skill-row-cooldown')) return;
    socket.emit('useSkill', { skillName: skillData.name });
  };
}

// ==================== 商店渲染 ====================
// ==================== 商店（LOL 风格独立页面） ====================
// ==================== 商店 / 背包 / 物品 / 快捷栏 / 详情 / tooltip（已迁移至 client-shop.js） ====================
// ==================== 事件绑定 ====================
function bindAllEvents() {
  // 认证事件已迁移至独立 /login.html 页面

  setupChannelDropdown();
  setupCmdPanel(); // ★ 行动指令面板（全局频道聚焦输入框时向上弹出）

  if (btnNewChar) btnNewChar.addEventListener('click', openCreateCharModal);
  // ★ 后台账号：全物品图鉴入口
  const btnItemCatalog = document.getElementById('btnItemCatalog');
  if (btnItemCatalog) btnItemCatalog.addEventListener('click', () => { if (window.ItemCatalog?.open) window.ItemCatalog.open(); });
  // ★ 管理员：地图标点模式入口（仅 debug_admin 可见/可用）
  const btnMapEditor = document.getElementById('btnMapEditor');
  if (btnMapEditor) btnMapEditor.addEventListener('click', () => {
    const u = (currentUser && currentUser.username) || '';
    if (u !== 'debug_admin') { if (window.showToast) window.showToast('仅管理员账号可用'); return; }
    window.open('mapEditor.html?user=' + encodeURIComponent(u), '_blank');
  });
  if (btnCancelCreate) btnCancelCreate.addEventListener('click', () => showModal(modalCreateChar, false));
  if (btnCreateChar) btnCreateChar.addEventListener('click', submitCreateChar);
  if (btnLogout) btnLogout.addEventListener('click', () => { currentUser=null; allCharacters=[]; clearSessionCache(); });

  // nostyleList 切换按钮
  const btnToggleListStyle = document.getElementById('btnToggleListStyle');
  if (btnToggleListStyle) btnToggleListStyle.addEventListener('click', toggleNostyleList);

  // 投票事件：绑定取消按钮 + 标题栏拖动 + 最小化/恢复
  if (btnAddOption) btnAddOption.addEventListener('click', () => { voteOptions.push('新选项'); renderVoteOptions(); });
  if (btnConfirmVote) btnConfirmVote.addEventListener('click', submitVote);
  if (btnCloseVoteModal) btnCloseVoteModal.addEventListener('click', cancelVote);
  if (btnVote) btnVote.addEventListener('click', openVoteModal);
  if (btnVoteMin) btnVoteMin.addEventListener('click', minimizeVote);
  if (btnVoteClose) btnVoteClose.addEventListener('click', cancelVote);
  if (btnVoteClose2) btnVoteClose2.addEventListener('click', cancelVote);
  if (btnVoteMiniRestore) btnVoteMiniRestore.addEventListener('click', restoreVote);
  enableVoteDrag();

  if (btnGroupAction) btnGroupAction.addEventListener('click', openGroupAction);
  if (btnSubmitGroupAction) btnSubmitGroupAction.addEventListener('click', submitGroupAction);
  if (btnCancelGroupAction) btnCancelGroupAction.addEventListener('click', () => showModal(modalGroupAction, false));

  bindFuncButtons();
  if (sendAction) sendAction.addEventListener('click', sendPlayerAction);
  if (actionInput) actionInput.addEventListener('keypress', e => { if (e.key==='Enter') sendPlayerAction(); });

  if (btnSwitchChar) btnSwitchChar.addEventListener('click', () => { localStorage.removeItem('coc_resume_characterUid'); showPage(pageCharacters); socket.emit('getCharacterList', { uid: currentUser?.uid }); });
  if (btnLogoutGame) btnLogoutGame.addEventListener('click', () => { currentCharacter=null; currentUser=null; clearSessionCache(); });

  // ★ 滑块模块独立初始化
  if (window.AttrSlider) window.AttrSlider.init();

  // ★ 加载重试按钮：重置上下文 + 清空旧队列 + 快速重连
  const btnRetryLoading = document.getElementById('btnRetryLoading');
  if (btnRetryLoading) {
    btnRetryLoading.addEventListener('click', () => {
      const token = localStorage.getItem('token') || localStorage.getItem('coc_token');
      if (!token) { window.location.replace('/'); return; }

      // 重置连接上下文
      _hideLoadingError();
      _clearLoadingTimeout();
      isLoggingIn = false;
      _reconnectAttempts = 0;
      _silentRetryCount = 0;  // ★ 手动重试时重置静默计数

      // 快速重连策略
      if (socket.connected) {
        // 已连接 → 直接重发 autoLogin
        showLoading(true);
        _startLoadingTimeout();
        isLoggingIn = true;
        socket.emit('autoLogin', { token });
      } else {
        // 未连接 → 断开旧连接 + 重新连接
        socket.disconnect();
        showLoading(true);
        _startLoadingTimeout();
        socket.connect();
        // 连接成功后自动发送（由 connect 事件处理）
      }
    });
  }
}

// ==================== Socket 事件 ====================
// ★ Socket 心跳 + 断线持久化
let _heartbeatTimer = null;
let _reconnectAttempts = 0;
const MAX_RECONNECT = 5;

function startHeartbeat() {
  stopHeartbeat();
  _heartbeatTimer = setInterval(() => {
    if (socket.connected) socket.emit('ping');
  }, 3000);
}
function stopHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

/** 保存对局快照到 localStorage */
function saveGameSession() {
  if (currentCharacter) {
    const snap = {
      page: (pageGame && pageGame.classList && !pageGame.classList.contains('hidden')) ? 'game' : null,
      currentCar: window._dungeonState?.currentCar || null,
      turn: window._dungeonState?.turn || _currentTurn || null,
      san: currentCharacter.san || currentCharacter.attr?.san,
      hp: currentCharacter.hp || currentCharacter.attr?.hp,
      lightSources: window._dungeonState?.lightSources,
      chenHuiRescued: window._dungeonState?.chenHui?.rescued,
      lastSceneImg: window._lastSceneImg || null,
      exclusiveMap: window._exclusiveMap || null
    };
    try { localStorage.setItem('coc_gameState', JSON.stringify(snap)); } catch(e) {}
    persistCopyLog(); // ★ 副本刷新持久化：断线时同步记录
  }
}

/** 清除本地会话缓存 + 强制跳转扉页 → 登录页 */
function clearSessionCache() {
  // 使用统一退出登录工具
  if (window.doLogout) { window.doLogout(); return; }
  // 回退：手动清除 + 标记退出回流场景 → 跳转扉页
  localStorage.removeItem('token');
  localStorage.removeItem('coc_token');
  localStorage.removeItem('coc_username');
  localStorage.removeItem('coc_roomId');
  localStorage.removeItem('coc_gameState');
  localStorage.removeItem('coc_resume_characterUid');
  // ★ 副本记录持久化：退出登录清除全部角色副本日志
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('coc_copyLog_') === 0) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
  localStorage.setItem('coc_cover_scene', 'logout_return'); // ★ 标记退出回流
  _reconnectAttempts = 0;
  window.location.replace('/'); // 跳转扉页，由扉页自动引导至登录页
}

socket.on('connect', () => {
  debugLog('✅ 已连接到服务器', socket.id);
  initDOMReferences();
  bindAllEvents();
  startHeartbeat();
  _reconnectAttempts = 0;
  _silentRetryCount = 0;    // ★ 连接成功，重置静默重试计数

  // ★ 认证已迁移至独立 /login.html 页面，此处仅处理 token 自动登录
  // ★ 兼容双键：优先读 'token'，回退读 'coc_token'（旧登录页使用 coc_token 键）
  const token = localStorage.getItem('token') || localStorage.getItem('coc_token');
  if (!token) {
    // 无 token → 跳转扉页（由扉页引导至登录页）
    debugLog('无有效 token，跳转扉页');
    window.location.replace('/');
    return;
  }

  // ★ 并行预校验：HTTP 健康检查 + 自动登录同步发起
  showLoading(true);
  // ★ 更新加载文案 (L5)
  const textEl = document.getElementById('loadingText');
  if (textEl) textEl.textContent = '正在进入寂静之地…';
  _startLoadingTimeout();

  // HTTP 健康预检（与服务端 socket 连接并行，互不阻塞）
  fetch('/api/health')
    .then(res => res.json())
    .then(data => {
      if (data.status === 'ok') {
        debugLog('🟢 HTTP 健康检查通过', data.uptime + 's uptime');
        // 健康检查提前通过 → 更新文案，但不重启超时（autoLogin 已发出）
        if (textEl) textEl.textContent = '验证身份中…';
      }
    })
    .catch(() => {
      debugLog('⚠️ HTTP 健康检查失败，继续等待 socket 认证');
    });

  // 立即进行自动登录（无需延迟）
  if (socket.connected) {
    isLoggingIn = true;
    socket.emit('autoLogin', { token });
  }
});

// ★ 加载超时兜底（前2次静默重连，第3次才展示重试按钮）
let _loadingTimeoutId = null;
const LOADING_TIMEOUT_MS = 2000; // ★ 从3s降至2s，加速超时反馈
function _startLoadingTimeout() {
  _clearLoadingTimeout();
  _loadingTimeoutId = setTimeout(() => {
    if (!loadingOverlay || loadingOverlay.classList.contains('hidden')) return;

    _silentRetryCount++;
    debugLog(`⏰ 加载超时 (${_silentRetryCount}/${MAX_SILENT_RETRY + 1})`);

    if (_silentRetryCount <= MAX_SILENT_RETRY) {
      // ★ 静默重试：不断开连接，仅重发认证请求
      const token = localStorage.getItem('token') || localStorage.getItem('coc_token');
      if (token && socket.connected) {
        const textEl = document.getElementById('loadingText');
        if (textEl) textEl.textContent = `正在连接 (${_silentRetryCount}/${MAX_SILENT_RETRY})…`;
        isLoggingIn = true;
        socket.emit('autoLogin', { token });
      } else if (!socket.connected) {
        // 连接已断开 → 静默重连
        const textEl = document.getElementById('loadingText');
        if (textEl) textEl.textContent = `正在重连 (${_silentRetryCount}/${MAX_SILENT_RETRY})…`;
        socket.connect();
      }
      _startLoadingTimeout(); // 重启下一轮超时
      return;
    }

    // ★ 静默重试耗尽 → 分级提示展示重试按钮
    const wasEverConnected = socket.id !== undefined;
    if (!wasEverConnected) {
      _showLoadingError('服务未就绪，请稍后重试');
    } else if (socket.connected) {
      _showLoadingError('服务响应超时，正在重试…');
    } else {
      _showLoadingError('网络连接中断，请检查网络后重试');
    }
  }, LOADING_TIMEOUT_MS);
}
function _clearLoadingTimeout() {
  if (_loadingTimeoutId) { clearTimeout(_loadingTimeoutId); _loadingTimeoutId = null; }
}
function _showLoadingError(msg) {
  if (!loadingOverlay) return;
  _clearLoadingTimeout();
  isLoggingIn = false;
  const spinner = loadingOverlay.querySelector('.loading-spinner');
  const textEl = document.getElementById('loadingText');
  const retryEl = document.getElementById('loadingRetry');
  const errorMsg = document.getElementById('loadingErrorMsg');
  if (spinner) spinner.style.display = 'none';
  if (textEl) textEl.style.display = 'none';
  if (errorMsg) errorMsg.textContent = msg || '连接异常，请重试';
  if (retryEl) retryEl.style.display = '';
  loadingOverlay.classList.remove('hidden');
}
function _hideLoadingError() {
  const spinner = loadingOverlay?.querySelector('.loading-spinner');
  const textEl = document.getElementById('loadingText');
  const retryEl = document.getElementById('loadingRetry');
  if (spinner) spinner.style.display = '';
  if (textEl) textEl.style.display = '';
  if (retryEl) retryEl.style.display = 'none';
}

// ★ 断线重连：读取缓存 roomId 尝试重返对局
socket.on('reconnect_attempt', () => {
  _reconnectAttempts++;
  debugLog(`🔄 重连尝试 ${_reconnectAttempts}/${MAX_RECONNECT}`);
  // ★ 更新加载提示文案
  const textEl = document.getElementById('loadingText');
  if (textEl) textEl.textContent = `正在重新连接 (${_reconnectAttempts}/${MAX_RECONNECT})…`;
  if (_reconnectAttempts > MAX_RECONNECT) {
    socket.close();
    const textEl2 = document.getElementById('loadingText');
    if (textEl2) textEl2.textContent = '连接失败';
    _showLoadingError('多次重连失败，请检查网络后手动重试');
  }
});

socket.on('connect_error', (err) => {
  console.warn('[Socket] 连接错误', err.message);
  // ★ 四级分类：ECONNREFUSED → 超时 → XHR → 兜底
  let hint = '正在连接寂静之地…';
  const errMsg = err.message.toLowerCase();
  if (errMsg.includes('econnrefused') || errMsg.includes('refused')) {
    hint = '服务端口未开放，请确认服务器已启动';
  } else if (errMsg.includes('timeout')) {
    hint = '网络延迟较高，请耐心等待…';
  } else if (errMsg.includes('xhr') || errMsg.includes('polling')) {
    hint = '服务未就绪，正在重试…';
  }
  const textEl = document.getElementById('loadingText');
  if (textEl) textEl.textContent = hint;
  // 连接失败时也启动兜底
  if (loadingOverlay && !loadingOverlay.classList.contains('hidden') && !_loadingTimeoutId) {
    _startLoadingTimeout();
  }
});

// ★ 断线时保存对局状态，加载阶段断线给出明确提示
socket.on('disconnect', () => {
  const wasLoading = loadingOverlay && !loadingOverlay.classList.contains('hidden');
  isLoggingIn = false;
  stopHeartbeat();
  saveGameSession();

  if (wasLoading && !currentUser) {
    // 初始加载阶段断线 → 展示重试界面而非静默隐藏
    _showLoadingError('与服务器断开连接，请检查网络后重试');
  } else {
    showLoading(false);
    _clearLoadingTimeout();
  }
  debugLog('🔌 已断开连接，已保存对局快照');
});

socket.on('authSuccess', ({ username, uid, token }) => {
  _clearLoadingTimeout();
  _hideLoadingError();
  // ★ 双键存储：兼容所有页面读取
  localStorage.setItem('token', token);
  localStorage.setItem('coc_token', token);
  currentUser = { username, uid };
  isLoggingIn = false;
  _silentRetryCount = 0;    // ★ 认证成功，重置静默重试计数
  // ★ 物品图鉴入口（所有账号可见）
  const catBtn = document.getElementById('btnItemCatalog');
  if (catBtn) catBtn.style.display = '';
  // ★ 地图标点模式入口（仅管理员 debug_admin 可见）
  const mapBtn = document.getElementById('btnMapEditor');
  if (mapBtn) mapBtn.style.display = (username === 'debug_admin') ? '' : 'none';
  // ★ DOM 就绪守卫：确保 initDOMReferences 已完成（幂等调用）
  if (!pageCharacters || !charList) {
    initDOMReferences();
  }
  // ★ 延迟一帧请求角色列表，确保 DOM 完全挂载
  showLoading(false);
  // ★ 断线持久化：若本地有待恢复角色，尝试恢复上次副本对局
  const resumeUid = localStorage.getItem('coc_resume_characterUid');
  if (resumeUid) {
    window._isResume = true; // ★ 标记恢复模式：copyStart 时还原副本记录（本地副本日志）
    socket.emit('resumeGame', { characterUid: resumeUid });
    return; // 去向由 resumeGameResult / resumePlayer 决定
  }
  showPage(pageCharacters);
  requestAnimationFrame(() => {
    socket.emit('getCharacterList', { uid });
  });
});
socket.on('authError', ({ msg }) => {
  _clearLoadingTimeout();
  _silentRetryCount = 0;
  // ★ 令牌失效 / 过期 分类提示
  const lowerMsg = (msg || '').toLowerCase();
  if (lowerMsg.includes('token') || lowerMsg.includes('令牌') || lowerMsg.includes('过期') || lowerMsg.includes('expired')) {
    showAlert('登录凭证已失效，请重新登录');
  } else if (lowerMsg.includes('未选择') || lowerMsg.includes('角色')) {
    showAlert(msg || '认证失败');
  } else {
    showAlert(msg || '认证失败');
  }
  isLoggingIn = false; showLoading(false);
  // ★ 认证失败跳转扉页 → 登录页，双键清除
  localStorage.removeItem('token');
  localStorage.removeItem('coc_token');
  window.location.replace('/');
});

socket.on('characterList', ({ characters }) => { allCharacters = characters; renderCharList(); });
socket.on('characterCreated', () => { socket.emit('getCharacterList', { uid: currentUser?.uid }); });
socket.on('characterSelected', ({ character, players, clearedCopies, engravingTier }) => {
  currentCharacter = character; roomPlayers = players;
  updatePlayerInfo(); renderTeamInfo(); renderSkills();
  // ★ 静默选择角色（技能树/属性分配/角色详情）：不跳页，直接在当前页打开
  if (_pendingSkillModal) {
    const which = _pendingSkillModal;
    _pendingSkillModal = null;
    if (which === 'detail') { if (window.CharDetail?.onCharacterSelected) window.CharDetail.onCharacterSelected(character); return; }
    if (which === 'tree') window.SkillTree.open();
    else if (which === 'attr') window.AttrAllocate.open();
    else if (which === 'equip') window.Warehouse.open();
    else window.SkillSetup.open();
    return;
  }
  // 选择角色后进入副本选择页（等距背景 + 副本词条环绕）
  if (pageCopySelect) {
    showPage(pageCopySelect);
  } else {
    showPage(pageRoomHall); // 兼容旧版
  }
  if (window.RoomHall?.init) window.RoomHall.init();
  // 传递通关数据给组队大厅
  if (window.RoomHall?.setCharacterData) {
    window.RoomHall.setCharacterData({ clearedCopies: clearedCopies || character.clearedCopies || [], engravingTier: engravingTier || character.engravingTier || 'white' });
  }
});
// ★ 断线恢复结果：无对局可恢复则回落到角色选择页
socket.on('resumeGameResult', ({ resumed }) => {
  if (resumed) return;
  window._isResume = false;
  localStorage.removeItem('coc_resume_characterUid');
  if (!currentUser) return;
  showPage(pageCharacters);
  requestAnimationFrame(() => socket.emit('getCharacterList', { uid: currentUser.uid }));
});

// ★ 断线恢复：还原角色与队友，刷新 LOL HUD / 档案 / 队伍
socket.on('resumePlayer', ({ character, players }) => {
  if (!character) return;
  currentCharacter = character;
  roomPlayers = players || [];
  // 还原地图底图与场景图（copyStart 已触发 mapMarkers/bgSwitcher 监听器）
  const mapBg = document.getElementById('cityMapBg');
  if (mapBg && window._exclusiveMap) mapBg.src = window._exclusiveMap;
  if (sceneBg && window._lastSceneImg && !sceneBg.src) sceneBg.src = window._lastSceneImg;
  resetChatForCopy();
  updatePlayerInfo();
  renderTeamInfo();
  renderSkills();
  renderLolStatus();
  if (window.renderLolEquip) renderLolEquip();
  if (window.MapCoordinateSystem?.init) window.MapCoordinateSystem.init();
  // ★ 青峰山地图系统：断线恢复时重新同步（copyStart 已随之触发）
  if (window.QingfengMap?.sync) {
    window.QingfengMap.sync({ copyName: window._dungeonName || window._dungeonState?.dungeonId, exclusiveMap: window._exclusiveMap, dungeonState: window._dungeonState, players });
  }
  debugLog('✅ 副本对局已恢复', { name: character.name, players: roomPlayers.length });
});
socket.on('avatarUpdated', ({ avatar }) => {
  if (currentCharacter) {
    currentCharacter.avatar = avatar;
    // 同步保存到 localStorage
    try {
      const avatars = JSON.parse(localStorage.getItem('coc_avatars') || '{}');
      avatars[currentCharacter.uid] = avatar;
      localStorage.setItem('coc_avatars', JSON.stringify(avatars));
    } catch (e) { /* ignore */ }
  }
  updatePlayerInfo();
  // 同步更新角色列表
  socket.emit('getCharacterList', { uid: currentUser?.uid });
});
socket.on('roomUpdate', ({ players }) => {
  roomPlayers = players;
  if (window.QingfengMap?.refreshPlayers) window.QingfengMap.refreshPlayers(players);
  // ★ 战斗场景模块：同步玩家立绘
  if (window.BattleScene?.setPlayers) window.BattleScene.setPlayers(players);
  // ★ 同步自身 HP/SAN（服务端为唯一事实来源，进入副本时已刷新满）
  const self = (players || []).find(p => p.socketId === socket.id);
  if (self && self.attr && currentCharacter) {
    Object.assign(currentCharacter.attr, self.attr);
    updatePlayerInfo(); renderLolStatus();
  }
  renderTeamInfo();
});
// ★ 副本内队友数据同步（大厅/战斗 handler 均会下发）
socket.on('roomPlayersUpdate', ({ players }) => {
  roomPlayers = players || [];
  if (window.QingfengMap?.refreshPlayers) window.QingfengMap.refreshPlayers(players || []);
  if (window.BattleScene?.setPlayers) window.BattleScene.setPlayers(players || []);
  renderTeamInfo();
});
socket.on('aiReply', ({ from, story, img }) => {
  hideKpLoading(); // ★ P2：KP 回复到达，隐藏书写 loading
  if (window.Sfx && window.Sfx.kp) window.Sfx.kp(); // ★ P2 音效：KP 播报提示
  // ★ 公共频道：故事化叙述（KP 回复按主叙述/风险收益/可选方向分段渲染）
  appendKpSections(publicLog, story, from || 'KP');
  // ★ 单人频道由 privateMsg 事件独立推送，此处不再重复（避免双频道同一消息出现两次）
  if (img && sceneBg && !sceneBg.src) sceneBg.src = img;
});
// ★ KP 回复分段格式化：将【风险/收益】与【可选方向】分隔为独立段落
socket.on('publicMsg', ({ msg, sender, senderId }) => {
  if (sender === 'KP') {
    hideKpLoading(); // ★ P2：KP 回复到达，隐藏书写 loading
    if (window.Sfx && window.Sfx.kp) window.Sfx.kp();
    appendKpSections(publicLog, msg, sender, senderId);
  } else {
    const formatted = formatKpMessage(msg, sender);
    appendLog(publicLog, formatted, sender, senderId);
  }
  addToCopyLog({ type:'publicMsg', content: `[${sender}] ${msg}` });
});
// ★ 私密频道：支持头像 + KP 分段格式化 + 双通道数值预测
socket.on('privateMsg', ({ msg, sender, senderId, avatar }) => {
  // 私密频道面板标题更新（显示与否由 setChatView 控制）
  if (avatar && privateSpeakerAvatar) privateSpeakerAvatar.src = avatar;
  if (sender === '陈慧' && privateSpeakerName) {
    privateSpeakerName.textContent = '🎭 陈慧';
  } else if (sender === 'KP' && privateSpeakerName) {
    privateSpeakerName.textContent = '🔮 KP 单人回应';
    hideKpLoading(); // ★ P2：KP 回复到达，隐藏书写 loading
    if (window.Sfx && window.Sfx.kp) window.Sfx.kp(); // ★ P2 音效：KP 播报提示
  }
  // ★ KP 回复分段渲染：主叙述/风险收益/可选方向独立段落
  // ★ 单人细化表格检测：管道符表格用 DOM API 安全渲染（零 innerHTML）
  if (sender === 'KP' && typeof msg === 'string' && /^\|.*\|$/m.test(msg)) {
    const { textPart, tableEl } = parseKpTableMessage(formatKpMessage(msg, sender));
    if (textPart) appendKpSections(privateLog, textPart, sender, senderId, avatar);
    if (tableEl) {
      const row = createChatMessage('', sender, senderId, avatar, tableEl);
      privateLog.appendChild(row);
      privateLog.scrollTop = privateLog.scrollHeight;
    }
  } else if (sender === 'KP') {
    appendKpSections(privateLog, formatKpMessage(msg, sender), sender, senderId, avatar);
  } else {
    appendLog(privateLog, formatKpMessage(msg, sender), sender, senderId, avatar);
  }
});

// ★ P0: 可交互选项表格（含"选择"按钮）
socket.on('statOptions', ({ options, rawTable }) => {
  if (!options || !Array.isArray(options) || options.length === 0) {
    // ★ 降级：优先按 DOM 表格渲染（与 privateMsg 的管道符表格渲染保持一致），非表格则纯文本
    if (rawTable) {
      const { textPart, tableEl } = parseKpTableMessage(String(rawTable));
      if (textPart) appendLog(privateLog, textPart, 'KP');
      if (tableEl) {
        const row = createChatMessage('', 'KP', null, null, tableEl);
        privateLog.appendChild(row);
        privateLog.scrollTop = privateLog.scrollHeight;
      }
    }
    return;
  }
  const tableEl = buildStatOptionsTable(options);
  if (tableEl) {
    const row = createChatMessage('', 'KP', null, null, tableEl);
    privateLog.appendChild(row);
    privateLog.scrollTop = privateLog.scrollHeight;
  }
});

// ★ P0: 角色属性更新（选项选择后服务器推送）
socket.on('characterUpdate', ({ uid, attr, hp, san }) => {
  // 更新 socket.character（当前角色引用）
  if (currentCharacter && attr) {
    currentCharacter.attr = { ...currentCharacter.attr, ...attr };
    if (hp !== undefined) currentCharacter.attr.hp = hp;
    if (san !== undefined) currentCharacter.attr.san = san;
    updatePlayerInfo(); // 刷新角色信息面板
  }
});

// ★ KP 消息格式化：将【判定】【结果】【建议】【行动】【状态】等结构化标签按段落分隔
function formatKpMessage(msg, sender) {
  if (sender !== 'KP' || typeof msg !== 'string') return msg;
  // 已有双换行的保留原格式
  if (msg.includes('\n\n')) return msg;
  // 在结构化标签前插入换行
  return msg
    .replace(/【判定】/g, '\n\n【判定】')
    .replace(/【结果】/g, '\n\n【结果】')
    .replace(/【建议】/g, '\n\n【建议】')
    .replace(/【行动】/g, '\n\n【行动】')
    .replace(/【状态】/g, '\n\n【状态】')
    .replace(/【风险】/g, '\n\n【风险】')
    .replace(/【收益】/g, '\n\n【收益】')
    .replace(/【风险[/\u6536\u76ca]收益】/g, '\n\n【风险/收益】')
    .replace(/【可选方向】/g, '\n\n【可选方向】')
    .replace(/^\n\n/, ''); // 去掉开头的空行
}

// ★ KP 回复分段：将主叙述、【风险/收益】、【可选方向】拆分为独立段落（缺省标签归入主叙述）
function parseKpSections(story) {
  if (typeof story !== 'string' || !story) return null;
  const RISK = '【风险/收益】', CHOICE = '【可选方向】';
  const riskIdx = story.indexOf(RISK);
  const choiceIdx = story.indexOf(CHOICE);
  if (riskIdx < 0 && choiceIdx < 0) return null;
  const first = [riskIdx, choiceIdx].filter(i => i >= 0).reduce((a, b) => Math.min(a, b));
  const main = story.slice(0, first).trim();
  const risk = riskIdx >= 0
    ? story.slice(riskIdx + RISK.length, choiceIdx > riskIdx ? choiceIdx : story.length).trim()
    : '';
  const choice = choiceIdx >= 0 ? story.slice(choiceIdx + CHOICE.length).trim() : '';
  return { main, risk, choice };
}
// ★ KP 回复分段渲染：主叙述 + 独立样式的【风险/收益】与【可选方向】段
function appendKpSections(logEl, story, sender, senderId, avatarUrl) {
  const sec = parseKpSections(story);
  if (!sec) { appendLog(logEl, story, sender, senderId, avatarUrl); return; }
  const box = document.createElement('div');
  box.className = 'kp-reply-block';
  const main = document.createElement('div');
  main.className = 'kp-main';
  main.textContent = sec.main || story;
  box.appendChild(main);
  if (sec.risk) {
    const r = document.createElement('div');
    r.className = 'kp-risk';
    r.innerHTML = '<span class="kp-sec-title">⚖️ 风险 / 收益</span>';
    const rb = document.createElement('div');
    rb.className = 'kp-sec-body';
    rb.textContent = sec.risk;
    r.appendChild(rb);
    box.appendChild(r);
  }
  if (sec.choice) {
    const c = document.createElement('div');
    c.className = 'kp-choice';
    c.innerHTML = '<span class="kp-sec-title">🧭 可选方向</span>';
    const cb = document.createElement('div');
    cb.className = 'kp-sec-body';
    cb.textContent = sec.choice;
    c.appendChild(cb);
    box.appendChild(c);
  }
  const row = createChatMessage('', sender || 'KP', senderId, avatarUrl, box);
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
}

// ★ 解析 KP 单人细化消息：分离文本与 Markdown 表格，构建 DOM table（纯 textContent，零 XSS）
function parseKpTableMessage(msg) {
  const lines = msg.split('\n');
  const textLines = [];
  const tableLines = [];
  let pastTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!pastTable && trimmed.startsWith('|') && trimmed.endsWith('|')) {
      tableLines.push(trimmed);
    } else if (tableLines.length > 0) {
      pastTable = true;
      if (trimmed) textLines.push(trimmed);
    } else {
      if (trimmed) textLines.push(trimmed);
    }
  }

  const textPart = textLines.join('\n').trim() || null;
  let tableEl = null;
  if (tableLines.length >= 2) {
    tableEl = buildDomTable(tableLines);
  }
  return { textPart, tableEl };
}

function buildDomTable(lines) {
  if (lines.length < 2) return null;
  const parseRow = (line) =>
    line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

  const headers = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);

  const table = document.createElement('table');
  table.className = 'kp-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  if (rows.length > 0) {
    const tbody = document.createElement('tbody');
    rows.forEach(cells => {
      const tr = document.createElement('tr');
      cells.forEach(c => {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }
  return table;
}

// ★ P0: 构建可交互选项表格（含"选择"按钮）
function buildStatOptionsTable(options) {
  if (!options || !options.length) return null;

  const wrapper = document.createElement('div');
  wrapper.className = 'stat-options-wrapper';

  const table = document.createElement('table');
  table.className = 'kp-table stat-options-table';

  // 表头
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['行动名称', '鉴定要求', '成功数值变化', '失败数值变化', '回合值', '选择'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // 数据行
  const tbody = document.createElement('tbody');
  options.forEach((opt, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'stat-option-row';

    const tdName = document.createElement('td');
    tdName.textContent = opt.name;
    tr.appendChild(tdName);

    const tdCheck = document.createElement('td');
    tdCheck.textContent = opt.checkAttr && opt.threshold
      ? `${opt.checkAttr} ${opt.threshold}`
      : '无需鉴定';
    tdCheck.style.fontFamily = 'Consolas, monospace';
    tdCheck.style.fontSize = '12px';
    tr.appendChild(tdCheck);

    const tdSuccess = document.createElement('td');
    tdSuccess.textContent = _formatDelta(opt.successDelta) || '-';
    tdSuccess.style.color = '#66bb6a';
    tr.appendChild(tdSuccess);

    const tdFail = document.createElement('td');
    tdFail.textContent = _formatDelta(opt.failDelta) || '-';
    tdFail.style.color = '#ef5350';
    tr.appendChild(tdFail);

    // ★ 回合值列
    const tdCost = document.createElement('td');
    tdCost.textContent = (opt.cost || 0.5) + ' 🎲';
    tdCost.style.color = '#ffd54f';
    tdCost.style.fontFamily = 'Consolas, monospace';
    tdCost.style.fontSize = '12px';
    tr.appendChild(tdCost);

    // "选择"按钮
    const tdBtn = document.createElement('td');
    const btn = document.createElement('button');
    btn.textContent = '选择';
    btn.className = 'btn-stat-choose';
    btn.dataset.optionIndex = idx;
    btn.addEventListener('click', function() {
      // 禁用所有按钮防止重复点击
      const allBtns = tbody.querySelectorAll('.btn-stat-choose');
      allBtns.forEach(b => { b.disabled = true; b.textContent = '已选择'; b.style.opacity = '0.5'; });
      btn.textContent = '执行中...';
      btn.style.opacity = '0.7';
      socket.emit('chooseStatOption', { optionIndex: idx });
    });
    tdBtn.appendChild(btn);
    tr.appendChild(tdBtn);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  // 提示文字
  const hint = document.createElement('p');
  hint.className = 'stat-options-hint';
  hint.textContent = '👆 点击上方"选择"按钮确认你的行动，数值将自动结算。';
  hint.style.cssText = 'color:#888;font-size:11px;margin:6px 0 0;text-align:center;';

  wrapper.appendChild(table);
  wrapper.appendChild(hint);
  return wrapper;
}

// 格式化 delta 对象为可读字符串
function _formatDelta(delta) {
  if (!delta || Object.keys(delta).length === 0) return '';
  const parts = [];
  const labelMap = { str:'力量', dex:'敏捷', con:'体力', int:'智力', per:'智力', cha:'魅力', lck:'幸运', wil:'意志', hp:'HP', san:'SAN', maxHp:'最大HP', maxSan:'最大SAN' };
  for (const [key, val] of Object.entries(delta)) {
    const sign = val >= 0 ? '+' : '';
    parts.push(`${labelMap[key] || key} ${sign}${val}`);
  }
  return parts.join(', ');
}

// 小队聊天消息
socket.on('teamChatMsg', ({ msg, sender, senderId }) => {
  appendTeamChat(msg, sender, senderId, 'player');
});

// 商店/背包数据
socket.on('shopData', ({ items, points }) => {
  renderShop(items, points);
  // ★ 同步当前角色诡秘点数（供背包页/能量条读取）
  if (currentCharacter && typeof points === 'number') currentCharacter.mysteryPoint = points;
});
// ★ 商店购买结果（成功/失败提示）
socket.on('shopPurchase', ({ msg, ok }) => {
  if (window.showToast) showToast((ok ? '✔ ' : '✖ ') + (msg || '购买结果'));
  if (ok && window.Warehouse?.refresh) window.Warehouse.refresh();
});
// ★ 副本掉落（KP 对话中获得道具）→ 提示 + 刷新格子背包
socket.on('itemLoot', ({ msg, items, warehouse }) => {
  if (window.showToast) showToast('🎁 ' + (msg || '获得道具'));
  if (currentCharacter) { currentCharacter.inventory = items || currentCharacter.inventory; currentCharacter.warehouse = warehouse || currentCharacter.warehouse; }
  if (window.Warehouse?.refresh) window.Warehouse.refresh();
  if (window.CluePanel?.refresh) window.CluePanel.refresh();
  const p = document.getElementById('pageInventory');
  if (p && p.classList.contains('active')) renderInventory(currentCharacter.inventory);
});
socket.on('inventoryData', ({ items, warehouse, hotbar, equipInfo }) => {
  // ★ 以服务端为准同步当前角色背包/仓库/快捷栏（供右栏消耗品/线索面板读取）
  if (currentCharacter) { currentCharacter.inventory = items || []; currentCharacter.warehouse = warehouse || []; }
  if (Array.isArray(hotbar)) { mcHotbar = hotbar.slice(0, 8); if (currentCharacter) currentCharacter.hotbar = mcHotbar; }
  // ★ 同步装备完整信息到缓存（装备栏渲染品质/图标/浮窗）
  if (equipInfo) { _equipCache = {}; for (const [slot, info] of Object.entries(equipInfo)) _equipCache[slot] = info; persistEquipCache(); }
  renderInventory(items);
});
// ★ 装备/卸下结果 → 刷新副本背包分区 + 右栏 + LOL 装备栏
socket.on('equipChanged', (data) => {
  if (currentCharacter) {
    currentCharacter.equip = data.equip || {};
    currentCharacter.inventory = data.items || currentCharacter.inventory;
    currentCharacter.warehouse = data.warehouse || currentCharacter.warehouse;
  }
  // ★ 用服务端返回的装备完整信息（含品质/图标/描述）重建缓存，装备栏渲染准确
  if (data.equipInfo) {
    _equipCache = {};
    for (const [slot, info] of Object.entries(data.equipInfo)) _equipCache[slot] = info;
  } else {
    // 兼容旧返回：清理已卸下槽位
    const eq = data.equip || {};
    for (const slot of Object.keys(_equipCache)) {
      if (!eq[slot]) delete _equipCache[slot];
    }
  }
  persistEquipCache();
  if (window.CluePanel?.refresh) window.CluePanel.refresh();
  renderLolEquip(); // ★ 副本界面 LOL 装备栏同步显示
  const p = document.getElementById('pageInventory');
  if (p && p.classList.contains('active')) renderInventory(currentCharacter.inventory);
});
// ★ 物品框架：使用消耗品结果（效果引擎），同步 HP/SAN + 堆叠
socket.on('itemUsed', ({ msg, items, attr }) => {
  if (currentCharacter) {
    currentCharacter.inventory = items || [];
    if (attr) currentCharacter.attr = { ...currentCharacter.attr, ...attr };
  }
  if (window.showToast) showToast('✔ ' + (msg || '使用成功'));
  renderInventory(items);
  if (window.CluePanel?.refresh) window.CluePanel.refresh();
});

// 进入副本时清空输入框和频道
socket.on('copyStart', ({ copyName, sceneSwitchEnable, dungeonState, exclusiveMap, chenhuiPortrait, worldTag, era, lastScene, turn }) => {
  resetInputState();
  resetChatForCopy();
  // ★ 记录是否处于断线/刷新恢复模式（避免恢复时重复追加"副本开启"条目）
  const wasResume = !!window._isResume;
  // ★ 副本记录持久化：断线/刷新恢复（_isResume）→ 还原上次副本日志；新副本 → 清空
  if (window._isResume) {
    // 恢复模式下 currentCharacter 尚未赋值（resumePlayer 稍后设置），用本地待恢复 uid 兜底
    const uid = currentCharacter?.uid || localStorage.getItem('coc_resume_characterUid');
    const saved = loadCopyLog(uid);
    copyLog = (saved && saved.length) ? saved : [];
    window._isResume = false;
  } else {
    copyLog = [];
    if (currentCharacter?.uid) clearCopyLog(currentCharacter.uid);
  }
  if (window.renderCopyLog) window.renderCopyLog();
  showPage(pageGame);
  // ★ 新副本/断线恢复初始化战斗场景模块（常驻：背景=当前空间像素图 + 左侧玩家；右侧仅在战斗中有怪时显示）
  if (window.BattleScene) {
    const ds = dungeonState || {};
    const initCar = ds.currentCar || null;
    const combat = ds.activeCombat;
    const initMon = (combat && Array.isArray(combat.enemies) && combat.enemies.length) ? combat.enemies : null;
    if (initCar) window.BattleScene.enter(initCar, initMon, roomPlayers);
    else window.BattleScene.clearEnemies();
  }
  // ★ 仅新副本追加"副本开启"日志（恢复模式已从 localStorage 还原完整记录，避免重复）
  if (!wasResume) addToCopyLog({ type:'copy', content: `副本开启: ${copyName}` });
  // ★ 回合机制：副本开始回合=1（断线恢复时用服务端回合号）
  _currentTurn = turn || 1;
  const _turnEl = document.getElementById('lolTurn');
  if (_turnEl) _turnEl.textContent = '回合 ' + _currentTurn;
  refreshSkillCds();
  // ★ 记录待恢复角色（断线/刷新后据此恢复对局；退出登录即清除）
  if (currentCharacter?.uid) {
    localStorage.setItem('coc_resume_characterUid', currentCharacter.uid);
  }
  // ★ 断线恢复时还原场景图
  if (lastScene) window._lastSceneImg = lastScene.img || null;
  if (lastScene?.img && sceneBg && !sceneBg.src) sceneBg.src = lastScene.img;
  // ★ 初始化二维地图坐标系（叠加在地图上方，方便标注点位；切换场景时移动队伍序号）
  if (window.MapCoordinateSystem?.init) window.MapCoordinateSystem.init();
  // 副本专属状态（青峰山等）
  if (dungeonState) {
    window._dungeonState = dungeonState;
    window._sceneSwitchEnable = sceneSwitchEnable ?? true;
    window._worldTag = worldTag || '';
    window._era = era || 0;
    debugLog('副本状态已初始化', { sceneSwitchEnable, dungeonState, worldTag, era });
  } else {
    window._dungeonState = null;
    window._sceneSwitchEnable = true;
    window._worldTag = '';
    window._era = 0;
  }
  // 副本专属地图 & NPC 肖像
  if (exclusiveMap) {
    window._exclusiveMap = exclusiveMap;
    // 由 mapMarkers.js 的 copyStart 监听器加载底图
  }
  if (chenhuiPortrait) {
    window._chenhuiPortrait = chenhuiPortrait;
    debugLog('陈辉肖像已加载', chenhuiPortrait);
  }
  // ★ 青峰山地图系统：场景图/小地图/大地图联动（由本 handler 显式驱动，避免 socket 事件竞态）
  if (window.QingfengMap?.sync) {
    window.QingfengMap.sync({ copyName, exclusiveMap, dungeonState, players: roomPlayers });
  }
  // ★ 战斗信息栏：进入副本后按实际中间栏宽度自适应缩放
  try { layoutLolHud(); } catch (e) {}
  // ★ 新手引导：首次进入副本（非恢复模式）延迟弹出分步教程
  if (!wasResume) setTimeout(() => showTutorial(), 900);
});

// 副本开场白（KP 专属独白，进入副本时自动推送）
socket.on('dungeonOpening', ({ monologue }) => {
  if (monologue && typeof monologue === 'string') {
    appendLog(publicLog, monologue, 'KP');
  }
});

// 副本广播消息（青峰山入场等）
socket.on('dungeonBroadcast', ({ messages }) => {
  if (messages && Array.isArray(messages)) {
    messages.forEach(m => {
      // ★ 提取纯文本：m 可能是字符串或包含 content 字段的对象
      const text = (typeof m === 'string') ? m : (m.content || m.msg || '');
      if (text && typeof text === 'string') appendLog(publicLog, text, 'KP');
    });
  }
});

// 副本状态同步
socket.on('dungeonStateUpdate', (state) => {
  window._dungeonState = { ...window._dungeonState, ...state };
  debugLog('副本状态更新', state);
  // 回合冷却：技能栏同步副本回合数
  if (state.turn !== undefined) {
    updateDungeonSkillCooldowns(state.turn);
  }
});

// 副本动作结果（服务端已按 target 分流叙述性消息，此处仅处理 UI 状态）
socket.on('dungeonActionResult', ({ action, payload, result, target, actorSocketId }) => {
  const isMyAction = actorSocketId === socket.id;

  // ★ 遇怪动作 → 切换遇怪场景图（青峰山地图系统）
  if ((action === 'fight_spawn' || action === 'shoggoth_encounter') && window.QingfengMap) {
    window.QingfengMap.onMonster(true);
  }
  // ★ 战斗结束（全部击退 / 修格斯驱退）→ 恢复遇怪图 + 清空右侧怪物（保留背景与左侧玩家）
  if (((action === 'fight_spawn' && result && result.remainingCount === 0) ||
       (action === 'shoggoth_defeat' && result && result.cleared))) {
    if (window.QingfengMap) window.QingfengMap.onMonster(false);
    if (window.BattleScene) window.BattleScene.clearEnemies();
  }

  if (result && result.error) {
    showToast(result.error);
    return;
  }

  if (result && result.ending) {
    addToCopyLog({ type:'dungeon', content: `结局：${result.ending.grade} | 经验+${result.rewards?.exp || 0}` });
  }

  // 公开行动结果 → 公共日志简要记录
  if (target === 'public' && result && result.msg) {
    // 公开行动叙述由 publicMsg 事件送达，此处不重复追加
  }

  // 私人行动 → 叙述由 privateMsg 送达；此处仅处理陈慧头像切换
  if (target === 'private' && isMyAction) {
    if (action === 'chenhui_interact' && result && result.success) {
      const portrait = window._chenhuiPortrait || 'assets/qingfeng_scenes/废都青峰山7号车配电间.png';
      setSpeaker('ChenHui', '陈慧', portrait);
      // 同步更新私密频道面板标题（显示与否由 setChatView 控制）
      if (privateSpeakerAvatar) privateSpeakerAvatar.src = portrait;
      if (privateSpeakerName) privateSpeakerName.textContent = '🎭 陈慧';
    }
  }

  // 副本状态变化提示
  if (result && result.moved) {
    // ★ 空间移动（单人独立空间）：仅移动者本人切换自己的场景图/小地图；
    //   进入有怪物空间（result.combat）→ 自动切换遇怪场景图
    if (window.QingfengMap && actorSocketId === socket.id) {
      window.QingfengMap.onCarChanged(result.moved, result.combat ? { monster: true } : {});
    }
    // ★ 战斗场景模块（常驻）：进入新空间更新背景（对应像素图）+ 左侧玩家；有怪显示右侧怪物，无怪右侧空
    if (window.BattleScene && actorSocketId === socket.id) {
      if (result.combat) {
        // ★ 新战斗引擎：怪物/意图/格挡由 battleStart/battleTurn 的 updateStatus 驱动；
        //   移动时仅更新背景与车号，避免用原始 enemies 覆盖完整战斗状态
        window.BattleScene.setCarId(result.moved);
      } else {
        window.BattleScene.enter(result.moved, null);
      }
      // ★ 双保险：显式同步模糊铺底层（场景图与战斗背景）
      if (window.BattleScene.syncBlurNow) window.BattleScene.syncBlurNow();
    }
    const carNames = {
      car_1_cab: '1号·驾驶室', car_2_economy: '2号·二等座', car_2_power: '2号·配电间',
      car_3_luggage: '3号·行李厢', car_4_dining: '4号·餐车', car_5_sleeper: '5号·卧铺',
      car_5_diningroom: '5号·餐车餐室', car_6_mail: '6号·货物厢', car_7_service: '7号·乘务设备厢',
      car_7_power: '7号·配电间', car_8_cabin: '8号·尾厢'
    };
    const carLabel = carNames[result.moved] || result.moved;
    const mover = (roomPlayers || []).find(p => p.socketId === actorSocketId);
    const moverName = mover ? mover.name : '某玩家';
    appendLog(publicLog, `🚃 ${moverName} 移动到【${carLabel}】`, '系统');
    // 8号车厢毒雾区提示
    if (result.moved === 'car_8_cabin') {
      if (isMyAction) {
        appendLog(privateLog, '⚠️ 进入毒雾区域——虚空列车信息干扰严重，私密频道暂时不可用。', 'KP');
      }
    } else {
      // 离开8号车厢后私密频道恢复
      if (isMyAction) {
        appendLog(privateLog, '📡 脱离干扰区，私密频道已恢复正常。', 'KP');
      }
    }
  }

  if (result && result.poisonDmg > 0 && isMyAction) {
    appendLog(privateLog, `☠️ 毒雾侵蚀：你受到了 ${result.poisonDmg} 点伤害。`, 'KP');
  }
});

// ★ 回合机制：服务端每次玩家行动推进回合，同步回合显示 + 技能 CD 回合刷新
socket.on('turnUpdate', ({ turn }) => {
  onTurnUpdate(turn || 1);
});

socket.on('copySettlement', (data) => {
  // ★ 副本结束，清除断线恢复标记（本局已结算）
  localStorage.removeItem('coc_resume_characterUid');
  if (window.Settlement?.show) window.Settlement.show(data);
  else showAlert(`副本结算：${data.grade}\n经验：${data.expGained}\n自由属性点：${data.freeAttributePoints}`);
});
socket.on('pointsApplied', async () => {
  await showAlert('属性分配成功！');
  socket.emit('getCharacterList', { uid: currentUser?.uid });
  showPage(pageCharacters);
});
socket.on('error', ({ msg }) => showToast(msg));
// ★ 战斗操作失败（能量不足/冷却中/已行动…）：服务端只反馈给操作者本人
socket.on('battleError', ({ msg }) => { if (window.showToastError) window.showToastError('⚠ ' + msg); else showToast('⚠ ' + msg); });

// ★ 自动登录统一由 connect 事件处理，此处不再重复触发
// ==================== 战斗行为系统1.0：行动 HUD（探索回合条 + 战斗操作条） ====================
