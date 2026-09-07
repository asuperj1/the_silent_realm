/**
 * mapMarkers.js — 城市地图玩家标记管理
 *
 * 职责：
 * 1. 维护各玩家在羊皮纸地图上的 emoji 位置标记
 * 2. 标记坐标使用百分比（x%, y%），随地图等比缩放
 * 3. 进入地下副本时自动隐藏所有标记
 * 4. 同区域多玩家时 emoji 堆叠偏移
 *
 * 依赖：window.socket, 全局 roomPlayers
 */

(function() {
  'use strict';

  const EMOTE_MARKERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

  // 预定义的地图点位（百分比坐标）
  const MAP_LOCATIONS = {
    'town_square':    { x: 50, y: 55, label: '城镇广场' },
    'library':        { x: 28, y: 35, label: '图书馆' },
    'docks':          { x: 72, y: 70, label: '码头区' },
    'forest_edge':    { x: 15, y: 25, label: '森林边缘' },
    'old_manor':      { x: 60, y: 30, label: '废弃庄园' },
    'church':         { x: 42, y: 48, label: '老教堂' },
    'market':         { x: 55, y: 60, label: '集市' },
    'cemetery':       { x: 35, y: 75, label: '墓园' },
    'coast_road':     { x: 80, y: 42, label: '滨海公路' },
    'underground':    { x: 50, y: 85, label: '地下入口' }
  };

  let mapMarkLayer = null;
  let cityMapBg = null;
  let markersVisible = true;
  let playerPositions = {}; // socketId -> { locationId, playerName, markerIndex }

  function getLayer() {
    if (!mapMarkLayer) {
      mapMarkLayer = document.getElementById('mapMarkLayer');
      cityMapBg = document.getElementById('cityMapBg');
    }
    return mapMarkLayer;
  }

  /**
   * 渲染所有标记到叠加层
   */
  function renderMarkers() {
    const layer = getLayer();
    if (!layer) return;
    layer.innerHTML = '';

    if (!markersVisible) return;

    // 统计每个地点的玩家数，用于堆叠偏移
    const locPlayers = {};
    for (const [sid, pos] of Object.entries(playerPositions)) {
      const locId = pos.locationId;
      if (!locPlayers[locId]) locPlayers[locId] = [];
      locPlayers[locId].push({ sid, ...pos });
    }

    // 渲染
    for (const [locId, players] of Object.entries(locPlayers)) {
      const loc = MAP_LOCATIONS[locId];
      if (!loc) continue;

      players.forEach((p, idx) => {
        const marker = document.createElement('span');
        marker.className = 'map-player-marker';
        if (players.length > 1) {
          marker.classList.add(`stack-${Math.min(idx, 4)}`);
        }
        marker.style.left = loc.x + '%';
        marker.style.top = loc.y + '%';
        marker.textContent = EMOTE_MARKERS[p.markerIndex % EMOTE_MARKERS.length] || '📍';
        marker.title = `${p.playerName} — ${loc.label}`;
        marker.dataset.sid = p.sid;
        marker.dataset.locId = locId;
        layer.appendChild(marker);
      });
    }
  }

  /**
   * 设置玩家在地图上的位置
   * @param {string} socketId - 玩家 socket ID
   * @param {string} locationId - 地图点位 ID（如 'town_square'）
   * @param {string} playerName - 玩家名称
   * @param {number} markerIndex - emoji 序号（0→①, 1→②...）
   */
  function setPlayerPosition(socketId, locationId, playerName, markerIndex) {
    if (!MAP_LOCATIONS[locationId]) {
      console.warn('[MapMarkers] 未知点位:', locationId);
      return;
    }
    playerPositions[socketId] = {
      locationId,
      playerName: playerName || '调查员',
      markerIndex: markerIndex || Object.keys(playerPositions).length
    };
    renderMarkers();
  }

  /**
   * 从地图移除玩家标记
   */
  function removePlayer(socketId) {
    delete playerPositions[socketId];
    renderMarkers();
  }

  /**
   * 进入副本：隐藏所有标记
   */
  function hideAll() {
    markersVisible = false;
    renderMarkers();
  }

  /**
   * 回到地面：显示所有标记
   */
  function showAll() {
    markersVisible = true;
    renderMarkers();
  }

  /**
   * 清空所有玩家标记
   */
  function clearAll() {
    playerPositions = {};
    markersVisible = true;
    renderMarkers();
  }

  // ========== Socket 事件绑定 ==========
  function bindEvents() {
    const socket = window.socket;
    if (!socket) { setTimeout(bindEvents, 500); return; }

    // 进入副本 → 隐藏标记 + 切换地图底图（优先使用服务端下发的专属地图）
    socket.on('copyStart', (data) => {
      hideAll();
      if (cityMapBg && data && data.copyName) {
        const mapPath = data.exclusiveMap || window._exclusiveMap;
        if (mapPath) {
          cityMapBg.src = mapPath;
        }
      }
    });

    // 返回大厅 / 离开房间 → 恢复默认羊皮纸地图
    socket.on('roomJoined', (data) => {
      if (cityMapBg && data && !data.copyState) {
        cityMapBg.src = '/assets/city-map-parchment.svg';
      }
    });

    // 副本结算 → 恢复标记
    socket.on('copySettlement', () => {
      setTimeout(() => showAll(), 1500);
    });

    // 房间更新时自动同步玩家标记
    const syncPlayers = (players) => {
      // 清除不在房间的玩家
      const activeSids = new Set((players || []).map(p => p.socketId));
      for (const sid of Object.keys(playerPositions)) {
        if (!activeSids.has(sid)) removePlayer(sid);
      }

      // 为新玩家分配默认点位（轮询 MAP_LOCATIONS）
      if (players) {
        players.forEach((p, i) => {
          if (!playerPositions[p.socketId]) {
            const locKeys = Object.keys(MAP_LOCATIONS);
            const locId = locKeys[i % locKeys.length];
            setPlayerPosition(p.socketId, locId, p.name, i);
          }
        });
      }
    };

    socket.on('roomPlayersUpdate', ({ players }) => syncPlayers(players));
    socket.on('roomUpdate', ({ players }) => syncPlayers(players));

    // 离开房间 → 清空
    socket.on('leftRoom', () => clearAll());
    socket.on('kickedFromRoom', () => clearAll());
    socket.on('roomDissolved', () => clearAll());

    console.log('[MapMarkers] Socket 事件已绑定');
  }

  // ========== 初始化 ==========
  function init() {
    const layer = getLayer();
    // 加载羊皮纸地图底图（若 HTML 中未预设 src）
    if (cityMapBg && !cityMapBg.src) {
      cityMapBg.src = '/assets/city-map-parchment.svg';
    }
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ========== 暴露 API ==========
  window.MapMarkers = {
    setPlayerPosition,
    removePlayer,
    hideAll,
    showAll,
    clearAll,
    getLocations: () => MAP_LOCATIONS,
    render: renderMarkers
  };
})();
