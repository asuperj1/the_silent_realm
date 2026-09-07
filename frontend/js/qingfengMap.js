/**
 * qingfengMap.js — 青峰山副本 地图系统（小地图 + 大地图浮窗 + 场景图联动）
 *
 * 职责：
 * 1. 中间栏上半：按当前车厢显示 qingfeng_scenes 场景图（正常/遇怪，KP 联动）
 * 2. 右栏小地图：显示列车地图 + 当前位置红点 + 位置文字（按地图编辑器标注点）
 * 3. 点击小地图 → 浮窗大地图：显示全部标注点 + 玩家序号（多玩家错开防遮挡）
 * 4. 依赖地图编辑器标注数据（/api/mapeditor/data），坐标 COLS=60，ROWS 按图片比例动态
 *
 * 暴露：window.QingfengMap = { onCarChanged(carId,{monster}), onMonster(flag), updateSceneImage }
 */
(function () {
  'use strict';

  const SEQ = '①②③④⑤⑥⑦⑧⑨⑩';
  const COLS = 60;
  const MAP_KEY = '废都青峰山地图.png';
  // ★ 修正地图标注 row：青峰山地图 4 排车厢实际位于 y≈19%/43%/67%/89%，
  // 标注数据（rows=32 基准）row 为 9/14/20/25 → 修正为 6/14/22/28 才对准车厢
  // （第二排 14 已准确；其余排系统性偏上/偏下，除 4 号车外都有偏移）
  const ROW_CORRECT = { 9: 6, 14: 14, 20: 22, 25: 28, 7: 4, 12: 12, 18: 20, 23: 26 };
  // 空间 id → 标注点名称（与地图编辑器标注一致；含子空间：配电间/餐车餐室）
  const CAR_LABEL = {
    car_1_cab: '1号车驾驶室', car_2_economy: '2号车', car_2_power: '2号车配电间',
    car_3_luggage: '3号车', car_4_dining: '4号车', car_5_sleeper: '5号车',
    car_5_diningroom: '5号车餐车餐室', car_6_mail: '6号车', car_7_service: '7号车',
    car_7_power: '7号车配电间', car_8_cabin: '8号车'
  };

  let points = [];          // 标注点 { label, col, row }
  let rows = 29;            // 当前图 ROWS（按图片比例动态算）
  let currentLabel = null;  // 自己当前位置标点名称
  let myCarId = null;       // 自己当前车厢 id（单人独立车厢）
  let monsterMode = false;  // 是否遇怪（切换遇怪场景图）
  let players = [];         // 房间玩家列表（各含 carId，序号用）
  let active = false;       // 是否青峰山副本中
  let _fullMapPath = '';    // ★ 大地图路径（延迟加载：首次打开浮窗时才设置 src）

  // ==================== 工具 ====================
  const $ = id => document.getElementById(id);
  const isQingfengName = name => typeof name === 'string' && name.includes('青峰山');
  function imgNaturalRatio(img) {
    return new Promise(res => {
      if (img.complete && img.naturalWidth) return res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res({ w: 0, h: 0 });
      img.src = img.src;
    });
  }
  function findPoint(label) {
    return points.find(p => p.label === label) ||
           points.find(p => label && p.label && p.label.includes(label));
  }

  /**
   * 计算 object-fit:contain 下图片内容的实际显示矩形（相对容器，px）
   */
  function containedRect(box, natW, natH) {
    const cw = box.width, ch = box.height;
    if (!cw || !ch || !natW || !natH) return { left: 0, top: 0, width: cw, height: ch };
    const scale = Math.min(cw / natW, ch / natH);
    const w = natW * scale, h = natH * scale;
    return { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h };
  }

  /**
   * 把图片内百分比坐标 (px,py 0-100) 映射到容器内百分比，使标点正对图片实际显示区域
   * @param {HTMLElement} container 定位基准容器
   * @param {HTMLElement} el 要定位的元素
   * @param {number} natW 图片自然宽
   * @param {number} natH 图片自然高
   * @param {number} px 图片内 X 百分比
   * @param {number} py 图片内 Y 百分比
   * @param {number} [dx=0] 附加像素偏移 X（玩家序号圆形错开用）
   * @param {number} [dy=0] 附加像素偏移 Y
   */
  function placeAt(container, el, natW, natH, px, py, dx, dy) {
    const box = container.getBoundingClientRect();
    const c = containedRect(box, natW, natH);
    const l = c.left + c.width * (px / 100) + (dx || 0);
    const t = c.top + c.height * (py / 100) + (dy || 0);
    el.style.left = ((box.width ? l / box.width : 0) * 100) + '%';
    el.style.top = ((box.height ? t / box.height : 0) * 100) + '%';
  }

  // ==================== 标注点加载 ====================
  async function loadPoints() {
    try {
      const res = await fetch('/api/mapeditor/data?map=' + encodeURIComponent(MAP_KEY));
      const j = await res.json();
      const list = (j.data && Array.isArray(j.data.annotations)) ? j.data.annotations : [];
      // ★ 应用 row 修正（修正标注点垂直偏移，除 4 号车外其余车厢对齐）
      points = list.map(a => ({ ...a, row: ROW_CORRECT[a.row] != null ? ROW_CORRECT[a.row] : a.row }));
    } catch (e) { points = []; }
  }

  // ==================== 小地图 ====================
  async function renderMiniMap() {
    const bg = $('miniMapBg'), marker = $('miniMapMarker'), loc = $('miniMapLoc'), wrap = $('miniMapWrap');
    if (!bg || !loc) return;
    const dim = await imgNaturalRatio(bg);
    if (dim.w > 0) rows = Math.max(8, Math.round(COLS * dim.h / dim.w));
    const p = currentLabel ? findPoint(currentLabel) : null;
    if (p && marker && wrap && dim.w) {
      marker.style.display = '';
      placeAt(wrap, marker, dim.w, dim.h, (p.col / COLS) * 100, (p.row / rows) * 100);
    } else if (marker) {
      marker.style.display = 'none';
    }
    loc.textContent = '📍 当前位置：' + (currentLabel || '未知');
  }

  // ==================== 大地图浮窗 ====================
  async function renderFullMap() {
    const bg = $('fullMapBg'), mk = $('fullMapMarkers');
    if (!bg || !mk) return;
    const dim = await imgNaturalRatio(bg);
    if (dim.w > 0) rows = Math.max(8, Math.round(COLS * dim.h / dim.w));
    const body = bg.parentElement;
    if (!body || !dim.w) return;
    mk.innerHTML = '';
    if (!players.length) return;
    // ★ 每个玩家显示在各自所在车厢标点处；同车厢多人圆形错开防遮挡
    const myId = (window.socket && window.socket.id) || '';
    const byCar = {};
    players.forEach(pl => {
      const c = pl.carId || 'car_4_dining';
      (byCar[c] = byCar[c] || []).push(pl);
    });
    players.forEach((pl, i) => {
      const car = pl.carId || 'car_4_dining';
      const p = findPoint(CAR_LABEL[car]);
      if (!p) return;
      const group = byCar[car] || [];
      const j = Math.max(0, group.indexOf(pl));
      const n = Math.max(1, group.length);
      const ang = (2 * Math.PI * j / n) - Math.PI / 2;
      const r = 14 + Math.min(12, n * 2);
      const el = document.createElement('div');
      el.className = 'fm-player' + (pl.socketId === myId ? ' me' : '');
      el.textContent = SEQ[i % SEQ.length];
      el.title = pl.name || ('玩家' + (i + 1));
      mk.appendChild(el);
      placeAt(body, el, dim.w, dim.h, (p.col / COLS) * 100, (p.row / rows) * 100, Math.cos(ang) * r, Math.sin(ang) * r);
    });
  }

  // ★ 幂等守卫：sync 每副本触发，防 document 级监听累加
  let _fullMapBound = false;
  function bindFullMapToggle() {
    if (_fullMapBound) return; _fullMapBound = true;
    const wrap = $('miniMapWrap'), overlay = $('fullMapOverlay'), close = $('fullMapClose');
    if (!wrap || !overlay) return;
    wrap.addEventListener('click', () => {
      overlay.style.display = 'flex';
      // ★ 性能优化：大地图大图延迟到首次打开浮窗时才加载，避免进副本即预载大图
      // ★ 无条件设置 src：浏览器会把无 src 的 <img> 自动补成当前页面 URL（导致 getAttribute('src') 非空误判已加载），
      //   故不依赖 src 判断，直接覆盖为地图路径（同 URL 走浏览器缓存，无重复请求）
      if (_fullMapPath) {
        const fbg = $('fullMapBg'), fblur = $('fullMapBgBlur');
        if (fbg) fbg.src = _fullMapPath;
        if (fblur) fblur.src = _fullMapPath;
      }
      renderFullMap();
      loadSketch();
      setTimeout(() => redrawSketch(null), 60); // 等 body 尺寸稳定后绘制涂鸦/标点
    });
    close.addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.style.display = 'none'; });
  }

  // ==================== 玩家涂鸦 + 标点（大地图通用功能） ====================
  const SKETCH_KEY = 'qingfeng_map_sketch_v1';
  // ★ 每个玩家分配一种深色涂鸦颜色（按角色 uid 稳定哈希，同一角色始终同色）
  const SKETCH_COLORS = ['#7a2d2b', '#1f4e79', '#2e5d3f', '#5b2c6f', '#8a5a1d', '#1e6b6b', '#6b1f4d', '#3d5a80'];
  function myUid() {
    const c = (typeof window.getCurrentCharacter === 'function') ? window.getCurrentCharacter() : null;
    return (c && c.uid) || (window.socket && window.socket.id) || 'local';
  }
  function playerSketchColor() {
    const s = String(myUid());
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return SKETCH_COLORS[h % SKETCH_COLORS.length];
  }
  let sketchMode = null;        // null(查看) | 'draw' | 'pin'
  let sketchStrokes = [];       // [{ pts:[[x%,y%],...], color, uid }]
  let sketchPins = [];          // [{ x%, y%, color, label, uid }]
  let drawing = false;
  let currentStroke = [];

  /** 画布尺寸与 body 对齐（含设备像素比） */
  function setupCanvas() {
    const cv = $('fullMapCanvas'), body = $('fullMapBg');
    if (!cv || !body) return null;
    const box = body.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(box.width * dpr));
    cv.height = Math.max(1, Math.round(box.height * dpr));
    cv.style.width = box.width + 'px';
    cv.style.height = box.height + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: box.width, h: box.height };
  }
  /** 全量重绘：已存笔画 + 正在画的笔画 + 标点 */
  function redrawSketch(extraStroke) {
    const c = setupCanvas(); if (!c) return;
    const ctx = c.ctx, w = c.w, h = c.h;
    ctx.clearRect(0, 0, w, h);
    const drawStroke = (pts, color, lw) => {
      if (!pts || pts.length < 2) return;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = p[0] / 100 * w, y = p[1] / 100 * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color; ctx.lineWidth = lw;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(212,168,67,0.5)'; ctx.shadowBlur = 3;
      ctx.stroke(); ctx.shadowBlur = 0;
    };
    sketchStrokes.forEach(s => drawStroke(s.pts, s.color || playerSketchColor(), 3));
    if (extraStroke) drawStroke(extraStroke, playerSketchColor(), 3);
    // 标点：金色定位针 + 圆点
    sketchPins.forEach(p => {
      const x = p.x / 100 * w, y = p.y / 100 * h;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y - 16);
      ctx.strokeStyle = '#ffd76b'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - 16, 5, 0, Math.PI * 2);
      ctx.fillStyle = p.color || '#ff5252'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      if (p.label) {
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(p.label).width + 12;
        ctx.fillStyle = 'rgba(20,24,36,0.9)';
        ctx.fillRect(x - tw / 2, y - 36, tw, 16);
        ctx.strokeStyle = '#c9a44b'; ctx.strokeRect(x - tw / 2, y - 36, tw, 16);
        ctx.fillStyle = '#ffe9a8'; ctx.fillText(p.label, x, y - 28);
      }
    });
  }
  function saveSketch() {
    try { localStorage.setItem(SKETCH_KEY, JSON.stringify({ strokes: sketchStrokes, pins: sketchPins })); } catch (e) { /* ignore */ }
  }
  function loadSketch() {
    try {
      const d = JSON.parse(localStorage.getItem(SKETCH_KEY) || 'null');
      // ★ 始终以 localStorage 为准：无数据则清空内存（避免外部清除后残留旧值）
      sketchStrokes = d && Array.isArray(d.strokes) ? d.strokes : [];
      sketchPins = d && Array.isArray(d.pins) ? d.pins : [];
    } catch (e) { sketchStrokes = []; sketchPins = []; }
  }
  function bindSketch() {
    const cv = $('fullMapCanvas'), body = $('fullMapBg');
    if (!cv || !body) return;
    const wrap = body.parentElement;
    const toPct = (e) => {
      const r = wrap.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100];
    };
    cv.addEventListener('mousedown', (e) => {
      if (sketchMode !== 'draw') return;
      e.preventDefault();
      drawing = true;
      currentStroke = [toPct(e)];
      redrawSketch(currentStroke);
    });
    cv.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      currentStroke.push(toPct(e));
      redrawSketch(currentStroke);
    });
    window.addEventListener('mouseup', () => {
      if (!drawing) return;
      drawing = false;
      if (currentStroke.length >= 2) sketchStrokes.push({ pts: currentStroke.slice(), color: playerSketchColor(), uid: myUid() });
      currentStroke = [];
      saveSketch();
      redrawSketch(null);
    });
    cv.addEventListener('click', (e) => {
      if (sketchMode !== 'pin') return;
      const p = toPct(e);
      sketchPins.push({ x: p[0], y: p[1], color: playerSketchColor(), label: '', uid: myUid() });
      saveSketch();
      redrawSketch(null);
    });
    // 工具栏
    const btnDraw = $('fmToolDraw'), btnPin = $('fmToolPin'), btnClear = $('fmToolClear');
    if (btnDraw) btnDraw.addEventListener('click', () => {
      sketchMode = sketchMode === 'draw' ? null : 'draw';
      btnDraw.classList.toggle('on', sketchMode === 'draw');
      if (btnPin) btnPin.classList.remove('on');
    });
    if (btnPin) btnPin.addEventListener('click', () => {
      sketchMode = sketchMode === 'pin' ? null : 'pin';
      btnPin.classList.toggle('on', sketchMode === 'pin');
      if (btnDraw) btnDraw.classList.remove('on');
    });
    if (btnClear) btnClear.addEventListener('click', () => {
      sketchStrokes = []; sketchPins = []; saveSketch(); redrawSketch(null);
    });
  }

  // ==================== 场景图切换 ====================
  function syncSceneBlur() {
    // ★ 强制同步场景图模糊铺底层（双保险：不依赖 MutationObserver 异步）
    const main = $('sceneBg'), blur = $('sceneBgBlur');
    if (main && blur) {
      const s = main.getAttribute('src');
      if (s && blur.getAttribute('src') !== s) blur.setAttribute('src', s);
    }
  }
  function updateSceneImage() {
    const img = $('sceneBg');
    if (!img || !currentLabel) return;
    let tries = 0;
    const candidates = [
      `assets/qingfeng_scenes/废都青峰山${currentLabel}${monsterMode ? '遇怪' : '正常'}.png`,
      `assets/qingfeng_scenes/废都青峰山${currentLabel}.png`,
      'assets/placeholder.png'
    ];
    const load = () => {
      if (tries >= candidates.length) return;
      const src = candidates[tries++];
      img.onload = () => { img.style.opacity = '1'; syncSceneBlur(); }; // 加载成功：确保可见 + 同步模糊层
      img.onerror = () => load(); // 当前候选缺失 → 尝试下一个
      if (img.getAttribute('src') !== src) img.src = src;
      syncSceneBlur();
    };
    // ★ 切换前重置透明度（防止 bgSwitcher 残留 opacity=0 导致"看似未切换"）
    img.style.opacity = '1';
    load();
  }

  // ==================== KP 联动 ====================
  /** 获取自己所在车厢（优先从玩家列表 carId，兼容 _dungeonState） */
  function getMyCar() {
    const my = players.find(p => p.socketId === (window.socket && window.socket.id));
    if (my && my.carId) return my.carId;
    return (window._dungeonState && window._dungeonState.currentCar) || 'car_4_dining';
  }
  /** 应用车厢位置：更新标点 / 场景图 / 小地图 / 大地图 */
  function applyCar(carId) {
    myCarId = carId;
    const label = CAR_LABEL[carId];
    if (label) currentLabel = label;
    updateSceneImage();
    renderMiniMap();
    renderFullMap();
  }
  function onCarChanged(carId, opts) {
    if (!active) return;
    if (opts && opts.monster !== undefined) monsterMode = !!opts.monster;
    else monsterMode = false; // 移动车厢默认回到正常场景
    applyCar(carId);
  }
  function onMonster(flag) {
    if (!active) return;
    monsterMode = !!flag;
    updateSceneImage();
  }

  /** 同步玩家列表并刷新各自位置（由 client.js 在 roomUpdate / roomPlayersUpdate / resumePlayer 时显式调用） */
  function refreshPlayers(list) {
    players = (list || []).filter(p => p && p.socketId);
    if (!active) return;
    const car = getMyCar();
    if (car !== myCarId) applyCar(car);        // 自己车厢变化 → 切场景图/小地图
    else { renderMiniMap(); renderFullMap(); } // 仅他人位置变化 → 刷新序号/小地图
  }

  // ==================== Socket ====================
  /**
   * 显式同步（由 client.js 在 copyStart / resumePlayer 后调用，避免 socket 事件竞态）
   * @param {{copyName?:string, exclusiveMap?:string, dungeonState?:object, players?:Array}} data
   */
  function sync(data) {
    if (!isQingfengName(data && data.copyName)) { active = false; currentLabel = null; myCarId = null; return; }
    active = true;
    monsterMode = false;
    const mapPath = (data && data.exclusiveMap) || window._exclusiveMap;
    _fullMapPath = mapPath || '';
    const mbg = $('miniMapBg');
    if (mbg && mapPath) mbg.src = mapPath; // ★ 小地图立即加载；大地图 fullMapBg 延迟到首次打开浮窗
    bindFullMapToggle();
    if (data && Array.isArray(data.players)) players = data.players.filter(p => p && p.socketId);
    loadPoints().then(() => applyCar(getMyCar()));
  }

  function bindEvents() {
    const socket = window.socket;
    if (!socket) { setTimeout(bindEvents, 500); return; }

    // 兜底：正常首进副本若 client.js 未显式同步，此处仍能捕获
    socket.on('copyStart', (data) => sync(data));

    const syncPlayers = (list) => refreshPlayers(list);
    socket.on('roomPlayersUpdate', ({ players }) => syncPlayers(players));
    socket.on('roomUpdate', ({ players }) => syncPlayers(players));
    socket.on('resumePlayer', ({ players }) => syncPlayers(players));

    socket.on('copySettlement', () => {
      active = false;
      const o = $('fullMapOverlay'); if (o) o.style.display = 'none';
    });
  }

  function init() { bindEvents(); bindSketch(); }

  window.QingfengMap = { init, sync, onCarChanged, onMonster, updateSceneImage, refreshPlayers };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
