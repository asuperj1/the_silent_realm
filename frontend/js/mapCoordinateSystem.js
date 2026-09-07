/**
 * mapCoordinateSystem.js — 二维地图坐标系（叠加在城市地图图片上方）
 *
 * 职责：
 * 1. 在城市地图容器（#cityMapContainer）上叠加二维坐标系：网格线 + X/Y 轴刻度 + 边框
 * 2. 点击地图任意位置 → 浮动显示该点网格坐标（如 8F），方便开发者标注点位
 * 3. 管理玩家队伍序号标记（①-⑧）：序号由进入副本后的队伍信息生成（与 mapMarkers 的 markerIndex 对齐）
 * 4. 监听场景切换命令（move_car 等 dungeonActionResult），自动把队伍序号移动到 SCENE_COORDS 对应坐标
 *
 * 暴露：window.MapCoordinateSystem = { init, destroy, show, hide, markPoint, clearPoints,
 *        setTeamMarkers, moveMarker, moveTeam, getCoordFromEvent, COLS, ROWS, SCENE_COORDS }
 */
(function () {
  'use strict';

  // ==================== 配置 ====================
  const COLS = 60;              // X 方向列数（刻度 1~60）
  const ROWS_DEFAULT = 34;      // Y 方向默认行数（数字 1~34，接近 16:9 正方形；编辑器可按图片比例动态调整）
  const SCENE_ROW_BASE = 18;    // SCENE_COORDS 行号基准（旧 18 行语义，动态 ROWS 下自动换算保持视觉位置）
  let ROWS = ROWS_DEFAULT;      // Y 方向当前行数
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SEQ = '①②③④⑤⑥⑦⑧';

  // 场景/车厢 → 网格坐标映射（外部可扩展覆盖，例如 window.MapCoordinateSystem.SCENE_COORDS.xxx = {...}）
  const SCENE_COORDS = {
    // 青峰山虚空列车：8 节车厢横向排布在地图中部（row 为 18 行基准，自动换算）
    car_1_cab:     { col: 5,  row: 9 },
    car_2_economy: { col: 12, row: 9 },
    car_3_luggage: { col: 19, row: 9 },
    car_4_dining:  { col: 26, row: 9 },
    car_5_sleeper: { col: 33, row: 9 },
    car_6_mail:    { col: 40, row: 9 },
    car_7_service: { col: 47, row: 9 },
    car_8_cabin:   { col: 54, row: 9 }
  };

  // ==================== 状态 ====================
  let overlay = null;       // 坐标系覆盖层（SVG 网格 + 刻度）
  let markerLayer = null;   // 序号标记 + 标注点层
  let hint = null;          // 点击坐标读数提示
  let teamMarkers = {};     // markerIndex -> { el, name, col, row }
  let annotations = [];     // { id, col, row, label, color, el }
  let density = 'fine';     // 网格密度：fine | medium | coarse
  let annotationMode = false; // 标注模式：开启时点击地图直接落点
  let changeListeners = []; // 标注变更监听（控制面板刷新列表）
  const STORE_KEY = 'coc_map_coord_annotations_v1';
  let externalStore = null; // 外部数据源（由地图编辑器注入：{ load(), save(list) }，优先于 localStorage）
  const DENSITIES = {
    fine:   { colStep: 1, rowStep: 1, xLabel: 5,  yLabel: 2, sCol: 10, sRow: 6 },
    medium: { colStep: 2, rowStep: 2, xLabel: 10, yLabel: 4, sCol: 10, sRow: 6 },
    coarse: { colStep: 4, rowStep: 4, xLabel: 20, yLabel: 8, sCol: 20, sRow: 12 }
  };

  // ==================== 工具 ====================
  const colToX = c => (c / COLS) * 100;
  const rowToY = r => (r / ROWS) * 100;
  const colText = c => String(c);
  const rowText = r => String(r);   // Y 轴使用数字（与 X 轴一致）
  const coordText = (c, r) => `${colText(c)}-${rowText(r)}`;
  const clamp = (min, max, v) => Math.min(max, Math.max(min, v));
  function genId() { return 'ann_' + Date.now() + '_' + Math.floor(Math.random() * 1e4); }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // ==================== DOM 构建 ====================
  function ensureDOM() {
    const container = document.getElementById('cityMapContainer');
    if (!container) return false;
    if (overlay && container.contains(overlay)) return true;

    overlay = document.createElement('div');
    overlay.id = 'mapCoordOverlay';
    overlay.className = 'map-coord-overlay';

    markerLayer = document.createElement('div');
    markerLayer.id = 'mapTeamMarkers';
    markerLayer.className = 'map-team-markers';

    hint = document.createElement('div');
    hint.id = 'mapCoordHint';
    hint.className = 'map-coord-hint hidden';

    container.appendChild(overlay);
    container.appendChild(markerLayer);
    container.appendChild(hint);

    buildGrid();
    bindClick();
    return true;
  }

  function buildGrid() {
    const D = DENSITIES[density] || DENSITIES.fine;
    const svg = svgEl('svg', { class: 'map-coord-svg', viewBox: '0 0 100 100', preserveAspectRatio: 'none' });

    // 网格线（坐标基准为 COLS×ROWS，密度只影响显示步长）
    for (let c = 1; c < COLS; c += D.colStep) {
      const x = (c / COLS) * 100;
      svg.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: 100, class: 'coord-grid' + (c % D.sCol === 0 ? ' strong' : '') }));
    }
    for (let r = 1; r < ROWS; r += D.rowStep) {
      const y = (r / ROWS) * 100;
      svg.appendChild(svgEl('line', { x1: 0, y1: y, x2: 100, y2: y, class: 'coord-grid' + (r % D.sRow === 0 ? ' strong' : '') }));
    }
    // 外边框
    svg.appendChild(svgEl('rect', { x: 0.15, y: 0.15, width: 99.7, height: 99.7, class: 'coord-frame' }));

    // X 轴刻度（顶部：1 及每 xLabel 列显示一个数字，避免 60 格文字重叠）
    for (let c = 1; c <= COLS; c++) {
      if (c !== 1 && c % D.xLabel !== 0) continue;
      const x = ((c - 0.5) / COLS) * 100;
      const t = svgEl('text', { x, y: 3.2, class: 'coord-label coord-label-x' });
      t.textContent = colText(c);
      svg.appendChild(t);
    }
    // Y 轴刻度（左侧 A~R）
    for (let r = 1; r <= ROWS; r += D.yLabel) {
      const y = ((r - 0.5) / ROWS) * 100;
      const t = svgEl('text', { x: 1.3, y, class: 'coord-label coord-label-y' });
      t.textContent = rowText(r);
      svg.appendChild(t);
    }
    overlay.appendChild(svg);
  }

  // ★ 幂等守卫：持久容器上重复绑定会累加监听（destroy 不卸载）
  let _clickBound = false;
  function bindClick() {
    if (_clickBound) return; _clickBound = true;
    const container = document.getElementById('cityMapContainer');
    if (!container) return;
    // 左键：标注模式 → 落点；否则 → 坐标读数
    container.addEventListener('click', (e) => {
      if (e.target.closest && (e.target.closest('.coord-label') || e.target.closest('.map-annotation') || e.target.closest('.map-coord-panel'))) return;
      const p = getCoordFromEvent(e);
      if (annotationMode) {
        addAnnotation(p.col, p.row);
      } else {
        showHint(p);
      }
    });
    // 右键：删除标注点
    container.addEventListener('contextmenu', (e) => {
      const annEl = e.target.closest ? e.target.closest('.map-annotation') : null;
      if (!annEl) return;
      e.preventDefault();
      const id = annEl.dataset.id;
      if (confirm('删除该标注点？')) removeAnnotation(id);
    });
  }

  // ==================== 坐标读取 ====================
  function getCoordFromEvent(e) {
    const container = document.getElementById('cityMapContainer');
    const r = container.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const col = Math.min(COLS, Math.max(1, Math.round(px * COLS)));
    const row = Math.min(ROWS, Math.max(1, Math.round(py * ROWS)));
    return { col, row, xPct: Math.max(0, Math.min(100, px * 100)), yPct: Math.max(0, Math.min(100, py * 100)) };
  }

  function showHint(p) {
    if (!hint) return;
    hint.textContent = `📍 坐标 ${coordText(p.col, p.row)}  (${p.col}, ${p.row})`;
    hint.classList.remove('hidden');
    hint.style.left = Math.min(88, p.xPct) + '%';
    hint.style.top = Math.max(4, p.yPct) + '%';
    clearTimeout(showHint._t);
    showHint._t = setTimeout(() => hint.classList.add('hidden'), 4000);
  }

  // ==================== 标注点位（完整标注工具） ====================
  function renderAnnotation(a) {
    if (a.el && a.el.parentNode) a.el.parentNode.removeChild(a.el);
    const d = document.createElement('div');
    d.className = 'map-annotation';
    d.dataset.id = a.id;
    d.style.left = colToX(a.col) + '%';
    d.style.top = rowToY(a.row) + '%';
    d.innerHTML = `<span class="map-annotation-dot" style="background:${a.color || '#000000'}"></span>` +
      `<span class="map-annotation-label"><b>${a.label || coordText(a.col, a.row)}</b> <em>${coordText(a.col, a.row)}</em></span>`;
    markerLayer.appendChild(d);
    a.el = d;
    // 拖动（网格吸附）
    let dragging = false;
    d.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      dragging = true;
      d.classList.add('dragging');
      const onMove = (ev) => {
        if (!dragging) return;
        const p = getCoordFromEvent(ev);
        moveAnnotation(a.id, p.col, p.row, true);
      };
      const onUp = () => {
        dragging = false;
        d.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveAnnotations();
        notify();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    // 双击重命名
    d.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const label = prompt('标注名称：', a.label || '');
      if (label != null && label.trim()) {
        a.label = label.trim();
        renderAnnotation(a);
        saveAnnotations();
        notify();
      }
    });
    return d;
  }

  function addAnnotation(col, row, label, color) {
    if (!ensureDOM()) return null;
    const a = {
      id: genId(),
      col: clamp(1, COLS, Math.round(col)),
      row: clamp(1, ROWS, Math.round(row)),
      label: (label != null && String(label).trim()) ? String(label).trim() : coordText(col, row),
      color: color || '#000000',
      el: null
    };
    annotations.push(a);
    renderAnnotation(a);
    saveAnnotations();
    notify();
    return a;
  }

  // 兼容旧 API
  function markPoint(col, row, label) { return addAnnotation(col, row, label); }

  function removeAnnotation(id) {
    const i = annotations.findIndex(a => a.id === id);
    if (i < 0) return false;
    const a = annotations[i];
    if (a.el && a.el.parentNode) a.el.parentNode.removeChild(a.el);
    annotations.splice(i, 1);
    saveAnnotations();
    notify();
    return true;
  }

  function clearAnnotations(save) {
    annotations.forEach(a => { if (a.el && a.el.parentNode) a.el.parentNode.removeChild(a.el); });
    annotations = [];
    if (save !== false) { saveAnnotations(); notify(); }
  }
  function clearPoints() { clearAnnotations(); }

  function getAnnotations() {
    return annotations.map(a => ({ id: a.id, col: a.col, row: a.row, label: a.label, color: a.color }));
  }

  function moveAnnotation(id, col, row, silent) {
    const a = annotations.find(x => x.id === id);
    if (!a) return false;
    a.col = clamp(1, COLS, Math.round(col));
    a.row = clamp(1, ROWS, Math.round(row));
    if (a.el) {
      a.el.style.left = colToX(a.col) + '%';
      a.el.style.top = rowToY(a.row) + '%';
    }
    if (!silent) { saveAnnotations(); notify(); }
    return true;
  }

  function updateAnnotation(id, patch) {
    const a = annotations.find(x => x.id === id);
    if (!a) return false;
    if (patch.col != null) a.col = clamp(1, COLS, Math.round(patch.col));
    if (patch.row != null) a.row = clamp(1, ROWS, Math.round(patch.row));
    if (patch.label != null) a.label = String(patch.label).trim() || a.label;
    if (patch.color != null) a.color = patch.color;
    renderAnnotation(a);
    saveAnnotations();
    notify();
    return true;
  }

  function selectAnnotation(id) {
    const a = annotations.find(x => x.id === id);
    if (!a || !a.el) return false;
    a.el.classList.add('flash');
    setTimeout(() => a.el && a.el.classList.remove('flash'), 1200);
    return true;
  }

  // ==================== 标注持久化 ====================
  function saveAnnotations() {
    const list = annotations.map(a => ({ id: a.id, col: a.col, row: a.row, label: a.label, color: a.color }));
    if (externalStore && externalStore.save) { externalStore.save(list); return; }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (e) { /* ignore */ }
  }

  function loadAnnotations() {
    // 外部数据源优先（编辑器模式：从服务端数据渲染）
    if (externalStore && typeof externalStore.load === 'function') {
      const list = externalStore.load();
      annotations.forEach(a => { if (a.el && a.el.parentNode) a.el.parentNode.removeChild(a.el); });
      annotations = [];
      (Array.isArray(list) ? list : []).forEach(x => {
        if (!x || x.col == null || x.row == null) return;
        annotations.push({
          id: x.id || genId(),
          col: clamp(1, COLS, x.col),
          row: clamp(1, ROWS, x.row),
          label: x.label || coordText(x.col, x.row),
          color: x.color || '#000000',
          el: null
        });
      });
      annotations.forEach(a => renderAnnotation(a));
      return annotations.length;
    }
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return 0;
      const list = JSON.parse(raw);
      annotations.forEach(a => { if (a.el && a.el.parentNode) a.el.parentNode.removeChild(a.el); });
      annotations = [];
      (Array.isArray(list) ? list : []).forEach(x => {
        if (!x || x.col == null || x.row == null) return;
        // 旧数据迁移：ROWS 动态后，旧 18 行基准的 row 按比例换算，保持视觉位置
        const r = (x.row <= 18 && ROWS > 18) ? Math.round((x.row / 18) * ROWS) : x.row;
        annotations.push({
          id: x.id || genId(),
          col: clamp(1, COLS, x.col),
          row: clamp(1, ROWS, r),
          label: x.label || coordText(x.col, r),
          color: x.color || '#000000',
          el: null
        });
      });
      annotations.forEach(a => renderAnnotation(a));
      return annotations.length;
    } catch (e) { return 0; }
  }

  function exportAnnotations() {
    return JSON.stringify(annotations.map(a => ({ col: a.col, row: a.row, label: a.label, color: a.color })), null, 2);
  }

  function importAnnotations(json) {
    try {
      const list = JSON.parse(json);
      if (!Array.isArray(list)) return 0;
      let n = 0;
      list.forEach(x => {
        if (x && x.col != null && x.row != null) { addAnnotation(x.col, x.row, x.label, x.color); n++; }
      });
      return n;
    } catch (e) { return 0; }
  }

  // ==================== 队伍序号标记 ====================
  function setTeamMarkers(players) {
    if (!ensureDOM()) return;
    (players || []).forEach((p, i) => {
      const idx = (p.markerIndex != null) ? p.markerIndex : i;
      if (teamMarkers[idx]) return; // 已存在则不重置位置
      const el = document.createElement('div');
      el.className = 'map-team-marker';
      el.textContent = SEQ[idx % SEQ.length];
      el.title = p.name || ('成员' + (idx + 1));
      // 初始位置：底部按序号横向排开
      const col = idx + 1;
      const row = ROWS - 1;
      el.style.left = colToX(col) + '%';
      el.style.top = rowToY(row) + '%';
      markerLayer.appendChild(el);
      teamMarkers[idx] = { el, name: p.name, col, row };
    });
  }

  function moveMarker(markerIndex, col, row) {
    const m = teamMarkers[markerIndex];
    if (!m) return false;
    m.col = col; m.row = row;
    m.el.style.left = colToX(col) + '%';
    m.el.style.top = rowToY(row) + '%';
    return true;
  }

  /**
   * 切换场景 → 移动队伍序号
   * @param {string|{col,row}} sceneKey - SCENE_COORDS 中的场景键，或直接 {col,row} 坐标
   * @param {number} [markerIndex] - 指定移动某个序号；缺省移动全部序号
   */
  function moveTeam(sceneKey, markerIndex) {
    if (!markerLayer) return false;
    const isSceneKey = (typeof sceneKey === 'string');
    const target = isSceneKey ? SCENE_COORDS[sceneKey] : ((typeof sceneKey === 'object' && sceneKey.col != null) ? sceneKey : null);
    if (!target) return false;
    // SCENE_COORDS 行号为 18 行基准，动态 ROWS 下换算保持视觉位置；直接对象视为当前 ROWS 基准
    const row = isSceneKey ? Math.round((target.row / SCENE_ROW_BASE) * ROWS) : target.row;
    if (markerIndex != null) return moveMarker(markerIndex, target.col, row);
    for (const k in teamMarkers) moveMarker(k, target.col, row);
    return true;
  }

  // ==================== 显隐 ====================
  function show() { if (overlay) overlay.classList.add('map-coord-on'); }
  function hide() { if (overlay) overlay.classList.remove('map-coord-on'); }
  function setGridVisible(on) { if (overlay) overlay.style.display = on ? '' : 'none'; }
  function getGridVisible() { return !overlay || overlay.style.display !== 'none'; }
  function setDensity(d) {
    if (!DENSITIES[d]) return false;
    density = d;
    if (overlay) { overlay.innerHTML = ''; buildGrid(); }
    return true;
  }
  /**
   * 动态调整行数（按底图宽高比使格子接近正方形）。
   * @param {number} rows 目标行数；传空则按 COLS 与当前容器/图片比例自行估算
   */
  function setRows(rows) {
    const nr = Math.min(99, Math.max(8, Math.round(rows || ROWS)));
    if (nr === ROWS) return ROWS;
    ROWS = nr;
    // 同步暴露值（window.MapCoordinateSystem.ROWS 是值快照，需手动更新）
    if (window.MapCoordinateSystem) window.MapCoordinateSystem.ROWS = ROWS;
    if (overlay) { overlay.innerHTML = ''; buildGrid(); }
    // 重渲染已有标注（位置随新行数变化）
    annotations.forEach(a => renderAnnotation(a));
    notify();
    return ROWS;
  }
  /** 按图片宽高比计算使格子接近正方形的行数（COLS×h/w） */
  function squareRowsForImage(naturalW, naturalH) {
    if (naturalW > 0 && naturalH > 0) return Math.round(COLS * naturalH / naturalW);
    return ROWS_DEFAULT;
  }
  function getDensity() { return density; }
  function setAnnotationMode(on) { annotationMode = !!on; }
  function getAnnotationMode() { return annotationMode; }
  function onAnnotationsChanged(fn) {
    if (typeof fn === 'function') changeListeners.push(fn);
  }
  function notify() {
    changeListeners.forEach(fn => { try { fn(getAnnotations()); } catch (e) { /* ignore */ } });
  }

  // ==================== Socket 事件 ====================
  function bindSocket() {
    if (window.MAP_COORD_NO_SOCKET) return; // 地图编辑器：无 socket 环境，跳过
    const socket = window.socket;
    if (!socket) { setTimeout(bindSocket, 500); return; }

    // 场景切换命令（move_car 等）→ 移动队伍序号
    socket.on('dungeonActionResult', (data) => {
      if (data && data.action === 'move_car' && data.result && data.result.moved) {
        moveTeam(data.result.moved);
      }
    });
    // 队伍数据同步 → 生成/增补序号标记（不重置已移动位置）
    socket.on('roomPlayersUpdate', ({ players }) => setTeamMarkers(players));
    socket.on('roomUpdate', ({ players }) => setTeamMarkers(players));
  }

  // ==================== 生命周期 ====================
  function init() {
    if (!ensureDOM()) return false;
    bindSocket();
    loadAnnotations();
    show();
    notify();
    return true;
  }

  function destroy() {
    const container = document.getElementById('cityMapContainer');
    if (overlay && container && container.contains(overlay)) container.removeChild(overlay);
    if (markerLayer && container && container.contains(markerLayer)) container.removeChild(markerLayer);
    if (hint && container && container.contains(hint)) container.removeChild(hint);
    overlay = null; markerLayer = null; hint = null;
    teamMarkers = {}; annotations = []; changeListeners = [];
  }

  // 设置外部数据源（编辑器注入；传 null 恢复 localStorage）
  function setExternalStore(store) {
    externalStore = store || null;
  }

  // ==================== 暴露 ====================
  window.MapCoordinateSystem = {
    init, destroy, show, hide,
    setGridVisible, getGridVisible,
    setDensity, getDensity,
    setAnnotationMode, getAnnotationMode,
    addAnnotation, markPoint, removeAnnotation, clearAnnotations, clearPoints,
    getAnnotations, moveAnnotation, updateAnnotation, selectAnnotation,
    saveAnnotations, loadAnnotations, exportAnnotations, importAnnotations,
    onAnnotationsChanged, setExternalStore,
    setRows, squareRowsForImage,
    setTeamMarkers, moveMarker, moveTeam,
    getCoordFromEvent,
    COLS, ROWS, SCENE_COORDS
  };
})();
