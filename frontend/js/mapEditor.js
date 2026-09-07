/**
 * mapEditor.js — 地图标点编辑器（开发工具，管理员 debug_admin 专用）
 * 复用 mapCoordinateSystem.js 的网格/标注核心，数据走服务端 API 持久化
 * 入口：调查员大厅管理员专属按钮 → mapEditor.html?user=<username>
 * 依赖：window.MapCoordinateSystem（mapCoordinateSystem.js）
 */
(function () {
  'use strict';

  // ==================== 登录校验 ====================
  const token = localStorage.getItem('token') || localStorage.getItem('coc_token');
  if (!token) { location.replace('/'); return; }

  const username = new URLSearchParams(location.search).get('user') || '';
  const isAdmin = username === 'debug_admin';

  const S = window.MapCoordinateSystem;
  const $ = id => document.getElementById(id);

  // ==================== 状态 ====================
  const state = {
    map: '',          // 当前地图相对路径（assets 内）
    annotations: [],  // 当前地图标注（服务端数据源）
    dirty: false,
    autoSave: true
  };
  let saveTimer = null;

  // ==================== 外部数据源（注入坐标系统，替代 localStorage） ====================
  const store = {
    load: () => state.annotations,
    save: (list) => {
      state.annotations = (list || []).map(a => ({ id: a.id, col: a.col, row: a.row, label: a.label, color: a.color }));
      markDirty();
    }
  };
  window.MAP_COORD_NO_SOCKET = true;
  S.setExternalStore(store);

  // ==================== 工具 ====================
  const coordText = (c, r) => c + '-' + r;
  function updateStatus() {
    const el = $('meStatus');
    el.className = 'me-status ' + (state.dirty ? 'dirty' : 'saved');
    el.textContent = (state.map ? state.map.split('/').pop() + ' · ' : '') + (state.dirty ? '● 未保存' : '✓ 已保存');
    const c = $('meAnnotCount');
    if (c) c.textContent = state.annotations.length ? '(' + state.annotations.length + ')' : '';
  }
  function toast(msg, isErr) {
    const el = $('meStatus');
    el.className = 'me-status ' + (isErr ? 'dirty' : 'saved');
    el.textContent = msg;
    setTimeout(updateStatus, 2500);
  }
  function markDirty() {
    state.dirty = true;
    if (state.autoSave) scheduleSave();
    updateStatus();
    refreshList();
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 900);
  }

  // ==================== 保存 / 加载 ====================
  async function save() {
    if (!state.map) return;
    clearTimeout(saveTimer);
    try {
      // ★ 每次保存读取最新 token（服务器重启会清会话，避免加载时的旧 token 快照导致 403）
      const tk = localStorage.getItem('token') || localStorage.getItem('coc_token') || '';
      const res = await fetch('/api/mapeditor/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': tk },
        body: JSON.stringify({
          map: state.map,
          annotations: state.annotations,
          density: S.getDensity()
        })
      });
      const r = await res.json();
      if (r.success) { state.dirty = false; updateStatus(); }
      else { toast('保存失败：' + (r.error || '未知'), true); }
    } catch (e) { toast('保存失败：' + e.message, true); }
  }

  async function selectMap(img) {
    state.map = img.path;
    state.annotations = [];
    state.dirty = false;
    const nm = $('meNameModal'); if (nm) nm.style.display = 'none'; // 切换地图时关闭名称弹窗
    // 底图
    const bg = $('meBg');
    bg.src = img.url;
    bg.style.display = '';
    $('meNoMap').style.display = 'none';
    // 按图片宽高比动态调整行数，使坐标格接近正方形
    try {
      const dim = await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => resolve({ w: 0, h: 0 });
        im.src = img.url;
      });
      if (dim.w > 0 && dim.h > 0) S.setRows(S.squareRowsForImage(dim.w, dim.h));
    } catch (e) { /* 忽略 */ }
    // 清空当前标注 DOM（不触发保存）
    S.clearAnnotations(false);
    // 加载服务端数据
    try {
      const res = await fetch('/api/mapeditor/data?map=' + encodeURIComponent(state.map));
      const r = await res.json();
      if (r.success && r.data && Array.isArray(r.data.annotations)) {
        state.annotations = r.data.annotations;
        if (r.data.density) { $('meDensity').value = r.data.density; S.setDensity(r.data.density); }
      }
    } catch (e) { /* 忽略 */ }
    // 渲染标注
    S.loadAnnotations();
    S.setAnnotationMode(false);
    $('meAnnotMode').checked = false;
    refreshList();
    updateStatus();
    toast('已加载：' + img.name);
  }

  // ==================== 图片库（分类） ====================
  const CAT_LABELS = { map: '🗺 地图', scene: '🏞 场景', skill: '✨ 技能', item: '📦 物品', character: '🧑 角色', other: '🗂 其他' };
  let imagesCache = [];       // 全部图片（带 category）
  state.category = 'all';

  async function loadGallery() {
    const g = $('meGallery');
    g.innerHTML = '<div id="meGalleryEmpty">加载中…</div>';
    try {
      const res = await (await fetch('/api/mapeditor/images')).json();
      imagesCache = (res.images || []).filter(i => /\.(png|jpe?g|webp)$/i.test(i.path));
      const categories = res.categories || {};
      // 分类下拉：全部 + 各类（按固定顺序，仅显示存在的分类）
      const sel = $('meCatFilter');
      sel.innerHTML = '';
      const total = imagesCache.length;
      const mkOpt = (val, label, n) => {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = `${label} (${n})`;
        sel.appendChild(o);
      };
      mkOpt('all', '全部', total);
      ['map', 'scene', 'skill', 'item', 'character', 'other'].forEach(k => {
        if ((categories[k] || 0) > 0) mkOpt(k, CAT_LABELS[k], categories[k]);
      });
      sel.value = state.category;
      if (!imagesCache.length) { g.innerHTML = '<div id="meGalleryEmpty">未找到图片</div>'; return; }
      renderGallery();
      // 首次自动选第一张地图
      if (!state.map) {
        const first = imagesCache.find(i => i.category === 'map') || imagesCache[0];
        if (first) selectMap(first);
      }
    } catch (e) {
      g.innerHTML = '<div id="meGalleryEmpty">加载失败：' + e.message + '</div>';
    }
  }

  function renderGallery() {
    const g = $('meGallery');
    g.innerHTML = '';
    const list = imagesCache.filter(i => state.category === 'all' || i.category === state.category);
    if (!list.length) { g.innerHTML = '<div id="meGalleryEmpty">该分类下暂无图片</div>'; return; }
    list.forEach(img => {
      const d = document.createElement('div');
      d.className = 'me-thumb' + (state.map === img.path ? ' active' : '');
      d.dataset.path = img.path;
      d.innerHTML = `<img src="${img.url}" loading="lazy" alt="${img.name}"><span>${img.path}</span>`;
      d.title = img.path;
      d.addEventListener('click', () => {
        document.querySelectorAll('.me-thumb').forEach(x => x.classList.remove('active'));
        d.classList.add('active');
        selectMap(img);
      });
      g.appendChild(d);
    });
  }

  // ==================== 标注列表 ====================
  function refreshList() {
    const list = $('meAnnotList');
    if (!list) return;
    list.innerHTML = '';
    const anns = S.getAnnotations();
    if (!anns.length) {
      list.innerHTML = '<div id="meAnnotEmpty">暂无标注点</div>';
      return;
    }
    anns.forEach(a => {
      const row = document.createElement('div');
      row.className = 'me-annot';
      row.innerHTML = `
        <span class="me-ann-coord">${coordText(a.col, a.row)}</span>
        <span class="me-ann-label">${(a.label || '')}</span>
        <span class="me-ann-ops">
          <button data-op="locate" title="定位">🎯</button>
          <button data-op="rename" title="改名">✏️</button>
          <button data-op="del" class="del" title="删除">✕</button>
        </span>`;
      row.querySelector('[data-op=locate]').onclick = () => S.selectAnnotation(a.id);
      row.querySelector('[data-op=rename]').onclick = () => {
        if (window.__meOpenRename) window.__meOpenRename(a.id, a.label || '', coordText(a.col, a.row));
      };
      row.querySelector('[data-op=del]').onclick = () => S.removeAnnotation(a.id);
      list.appendChild(row);
    });
  }

  // ==================== 事件 ====================
  function bindEvents() {
    // 顶栏
    $('meSave').addEventListener('click', save);
    $('meBack').addEventListener('click', () => { if (state.dirty && !confirm('有未保存的标注，确定离开？')) return; window.close(); location.href = '/'; });

    // 工具条
    $('meGrid').addEventListener('change', e => S.setGridVisible(e.target.checked));
    $('meDensity').addEventListener('change', e => { S.setDensity(e.target.value); state.dirty = true; updateStatus(); });
    $('meAnnotMode').addEventListener('change', e => {
      // 落点由编辑器接管（点击后输入名称），坐标系统的标注模式保持关闭，避免双重落点
      S.setAnnotationMode(false);
      toast(e.target.checked ? '标注模式开启：点击地图后输入名称落点' : '标注模式关闭');
    });
    $('meClear').addEventListener('click', () => {
      if (!state.map) return;
      if (confirm('确定清空当前地图的所有标注点？')) { S.clearAnnotations(); }
    });

    // 点击地图落点（标注模式开启时）：点击后弹出名称输入框，确认后添加，颜色取自工具条
    let pending = null; // 待添加 {col,row} 或 {id}
    const focusNameInput = () => { try { $('meNameInput').focus(); $('meNameInput').select(); } catch (e) {} };
    const openNameModal = (title, coord, initial) => {
      $('meNameModalTitle').textContent = title;
      $('meNameCoord').textContent = coord;
      $('meNameInput').value = initial || '';
      $('meNameModal').style.display = 'flex';
      focusNameInput();               // 立即聚焦
      setTimeout(focusNameInput, 80); // 延迟二次聚焦（防点击事件链打断）
      setTimeout(focusNameInput, 400); // 最终保险
    };
    const ctr = $('cityMapContainer');
    ctr.addEventListener('click', (e) => {
      if (!$('meAnnotMode').checked) return;
      if (pending) return; // 弹窗已打开：忽略地图点击，防重置弹窗/抢焦点
      if (e.target.closest && (e.target.closest('.map-annotation') || e.target.closest('.coord-label'))) return;
      const p = S.getCoordFromEvent(e);
      pending = { col: p.col, row: p.row };
      openNameModal('📍 添加标注', '坐标 ' + coordText(p.col, p.row) + '（列-行）', '');
    });
    // 输入框点击强制聚焦（防任何焦点被抢导致无法键入）
    $('meNameInput').addEventListener('mousedown', (e) => { e.stopPropagation(); focusNameInput(); });
    $('meNameInput').addEventListener('click', (e) => { e.stopPropagation(); focusNameInput(); });
    // 名称输入弹窗：确定（添加或重命名）/ 取消 / 回车 / Esc
    $('meNameOk').addEventListener('click', () => {
      if (!pending) return;
      if (pending.id) S.updateAnnotation(pending.id, { label: $('meNameInput').value.trim() });
      else S.addAnnotation(pending.col, pending.row, $('meNameInput').value.trim(), $('meColor').value);
      pending = null;
      $('meNameModal').style.display = 'none';
    });
    $('meNameCancel').addEventListener('click', () => { pending = null; $('meNameModal').style.display = 'none'; });
    $('meNameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('meNameOk').click(); }
      else if (e.key === 'Escape') { $('meNameCancel').click(); }
    });

    // 标注列表：改名也复用名称弹窗（替代被禁用的原生 prompt）
    window.__meOpenRename = (id, label, coord) => {
      pending = { id };
      openNameModal('✏️ 重命名标注', '坐标 ' + coord, label || '');
    };

    // 侧栏切换
    $('meTabImages').addEventListener('click', () => { $('meTabImages').classList.add('active'); $('meTabAnnots').classList.remove('active'); $('meGalleryWrap').style.display = ''; $('meAnnotWrap').style.display = 'none'; $('meCatBar').style.display = ''; });
    $('meTabAnnots').addEventListener('click', () => { $('meTabAnnots').classList.add('active'); $('meTabImages').classList.remove('active'); $('meGalleryWrap').style.display = 'none'; $('meAnnotWrap').style.display = ''; $('meCatBar').style.display = 'none'; refreshList(); });

    // 图片分类下拉切换
    $('meCatFilter').addEventListener('change', () => {
      state.category = $('meCatFilter').value;
      renderGallery();
    });

    // 标注变更 → 刷新列表
    S.onAnnotationsChanged(() => { refreshList(); updateStatus(); });

    // 快捷键：Ctrl+S 保存
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); }
    });
  }

  // ==================== 启动 ====================
  function init() {
    $('meUser').textContent = (username ? '👤 ' + username : '未登录') + (isAdmin ? ' · 管理员' : ' · 只读');
    if (!isAdmin) {
      $('meStatus').textContent = '非管理员（仅浏览）';
      $('meStatus').className = 'me-status dirty';
      $('meSave').disabled = true;
      $('meClear').disabled = true;
      state.autoSave = false;
    }
    if (!S.init()) { $('meStatus').textContent = '画布初始化失败'; return; }
    bindEvents();
    loadGallery();
    updateStatus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
