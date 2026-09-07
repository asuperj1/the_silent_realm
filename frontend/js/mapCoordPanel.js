/**
 * mapCoordPanel.js — 地图坐标系控制面板（悬浮在地图右上角）
 *
 * 职责：
 * 1. 网格显隐开关、网格密度切换（精细 / 标准 / 粗略）
 * 2. 标注模式开关（开启后点击地图直接落标注点）
 * 3. 手动添加标注（输入列/行/名称）
 * 4. 标注点列表管理：定位 / 重命名 / 删除 / 清空
 * 5. 持久化：导出 JSON / 导入 JSON
 *
 * 依赖：window.MapCoordinateSystem（mapCoordinateSystem.js）
 * 暴露：window.MapCoordPanel = { init, show, hide }
 */
(function () {
  'use strict';

  let panel = null, body = null, listEl = null;
  let toggleBtn = null, chkGrid = null, selDensity = null, chkMode = null;
  let inCol = null, inRow = null, inLabel = null, btnAdd = null;
  let btnExport = null, btnImport = null, fileInput = null, btnClear = null;

  const SEQ_ICON = {};

  // 可选的标注底图（assets 下资源，可按需扩展）
  const MAP_OPTIONS = [
    { path: 'assets/qingfeng_scenes/废都青峰山地图.png', label: '废都青峰山地图' },
    { path: 'assets/废都1.png', label: '废都1' },
    { path: 'assets/废都图书馆.png', label: '废都图书馆' },
    { path: 'assets/废都富人区.png', label: '废都富人区' },
    { path: 'assets/废都鹤鸣岭废弃庄园.png', label: '废都鹤鸣岭废弃庄园' },
    { path: 'assets/qingfeng_scenes/废都青峰山1号车外隧道正常.png', label: '青峰山1·隧道入口' },
    { path: 'assets/qingfeng_scenes/废都青峰山2号车正常.png', label: '青峰山2·车厢' },
    { path: 'assets/qingfeng_scenes/废都青峰山3号车外隧道正常.png', label: '青峰山3·暗夜全景' },
    { path: 'assets/qingfeng_scenes/废都青峰山7号车配电间.png', label: '青峰山7·乘务设备' }
  ];

  // ==================== DOM 构建 ====================
  function ensureDOM() {
    const container = document.getElementById('cityMapContainer');
    if (!container) return false;
    if (panel && container.contains(panel)) return true;

    panel = document.createElement('div');
    panel.id = 'mapCoordPanel';
    panel.className = 'map-coord-panel';

    toggleBtn = document.createElement('button');
    toggleBtn.id = 'mcpToggle';
    toggleBtn.className = 'mcp-toggle';
    toggleBtn.type = 'button';
    toggleBtn.textContent = '⚙ 坐标工具';
    panel.appendChild(toggleBtn);

    body = document.createElement('div');
    body.id = 'mcpBody';
    body.className = 'mcp-body hidden';
    body.innerHTML = `
      <div class="mcp-section">
        <div class="mcp-title">底图选择</div>
        <select id="mcpMap" class="mcp-map">
          ${MAP_OPTIONS.map(m => `<option value="${m.path}">${m.label}</option>`).join('')}
        </select>
      </div>
      <div class="mcp-section">
        <div class="mcp-title">坐标系控制</div>
        <label class="mcp-check"><input type="checkbox" id="mcpGridVisible" checked> 网格显示</label>
        <div class="mcp-row">
          <span class="mcp-label">密度</span>
          <select id="mcpDensity">
            <option value="fine">精细</option>
            <option value="medium">标准</option>
            <option value="coarse">粗略</option>
          </select>
        </div>
        <label class="mcp-check"><input type="checkbox" id="mcpAnnotMode"> 标注模式（点击地图落点）</label>
      </div>
      <div class="mcp-section">
        <div class="mcp-title">添加标注</div>
        <div class="mcp-addrow">
          <input id="mcpAddCol" type="number" min="1" max="60" placeholder="列" title="列 1-60">
          <input id="mcpAddRow" type="number" min="1" placeholder="行" title="行">
          <input id="mcpAddLabel" type="text" placeholder="名称" title="标注名称">
          <button id="mcpAddBtn" type="button">＋</button>
        </div>
      </div>
      <div class="mcp-section">
        <div class="mcp-title">标注点列表 <span id="mcpCount" class="mcp-count">0</span></div>
        <div id="mcpList" class="mcp-list"></div>
      </div>
      <div class="mcp-actions">
        <button id="mcpExport" type="button">导出</button>
        <button id="mcpImport" type="button">导入</button>
        <button id="mcpClear" type="button" class="danger">清空</button>
        <input type="file" id="mcpImportFile" accept=".json,application/json" style="display:none">
      </div>
    `;
    panel.appendChild(body);
    container.appendChild(panel);

    // 引用控件
    listEl = body.querySelector('#mcpList');
    chkGrid = body.querySelector('#mcpGridVisible');
    selDensity = body.querySelector('#mcpDensity');
    chkMode = body.querySelector('#mcpAnnotMode');
    inCol = body.querySelector('#mcpAddCol');
    inRow = body.querySelector('#mcpAddRow');
    inLabel = body.querySelector('#mcpAddLabel');
    btnAdd = body.querySelector('#mcpAddBtn');
    btnExport = body.querySelector('#mcpExport');
    btnImport = body.querySelector('#mcpImport');
    fileInput = body.querySelector('#mcpImportFile');
    btnClear = body.querySelector('#mcpClear');

    // 动态行数（编辑器按图片比例调整后同步到面板）
    const R = (window.MapCoordinateSystem && window.MapCoordinateSystem.ROWS) || 34;
    if (inRow) { inRow.max = R; inRow.title = '行 1-' + R; }

    bindEvents();
    syncControls();
    return true;
  }

  // ==================== 事件绑定 ====================
  function bindEvents() {
    // 底图切换
    const mcpMap = body.querySelector('#mcpMap');
    mcpMap.addEventListener('change', () => setMapBg(mcpMap.value));

    // 面板折叠/展开
    toggleBtn.addEventListener('click', () => {
      body.classList.toggle('hidden');
      toggleBtn.textContent = body.classList.contains('hidden') ? '⚙ 坐标工具' : '⚙ 收起';
      if (!body.classList.contains('hidden')) refreshList();
    });

    // 网格显隐
    chkGrid.addEventListener('change', () => {
      window.MapCoordinateSystem.setGridVisible(chkGrid.checked);
    });

    // 密度切换
    selDensity.addEventListener('change', () => {
      window.MapCoordinateSystem.setDensity(selDensity.value);
    });

    // 标注模式
    chkMode.addEventListener('change', () => {
      window.MapCoordinateSystem.setAnnotationMode(chkMode.checked);
    });

    // 手动添加
    btnAdd.addEventListener('click', () => {
      const R = (window.MapCoordinateSystem && window.MapCoordinateSystem.ROWS) || 34;
      const col = parseInt(inCol.value, 10);
      const row = parseInt(inRow.value, 10);
      if (!isFinite(col) || !isFinite(row)) { alert('请填写列(1-60)和行(1-' + R + ')'); return; }
      window.MapCoordinateSystem.addAnnotation(col, row, inLabel.value.trim());
      inCol.value = ''; inRow.value = ''; inLabel.value = '';
    });

    // 导出
    btnExport.addEventListener('click', () => {
      const json = window.MapCoordinateSystem.exportAnnotations();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'map-annotations-' + Date.now() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    // 导入
    btnImport.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const n = window.MapCoordinateSystem.importAnnotations(reader.result);
        refreshList();
        alert('导入完成：新增 ' + n + ' 个标注点');
      };
      reader.readAsText(file);
      fileInput.value = '';
    });

    // 清空
    btnClear.addEventListener('click', () => {
      if (confirm('确定清空所有标注点？')) {
        window.MapCoordinateSystem.clearAnnotations();
        refreshList();
      }
    });

    // 监听标注变更 → 刷新列表
    window.MapCoordinateSystem.onAnnotationsChanged(() => refreshList());
  }

  // ==================== 控件状态同步 ====================
  function syncControls() {
    if (!window.MapCoordinateSystem) return;
    chkGrid.checked = window.MapCoordinateSystem.getGridVisible();
    selDensity.value = window.MapCoordinateSystem.getDensity();
    chkMode.checked = window.MapCoordinateSystem.getAnnotationMode();
  }

  // ==================== 标注点列表 ====================
  function refreshList() {
    if (!listEl || !window.MapCoordinateSystem) return;
    const anns = window.MapCoordinateSystem.getAnnotations();
    const countEl = body.querySelector('#mcpCount');
    if (countEl) countEl.textContent = anns.length;
    listEl.innerHTML = '';
    if (anns.length === 0) {
      listEl.innerHTML = '<div class="mcp-empty">暂无标注点</div>';
      return;
    }
    anns.forEach(a => {
      const item = document.createElement('div');
      item.className = 'mcp-item';
      item.innerHTML = `
        <span class="mcp-item-dot" style="background:${a.color || '#000000'}"></span>
        <span class="mcp-item-name" title="${a.label}">${a.label}</span>
        <span class="mcp-item-coord">${a.col},${a.row}</span>
        <span class="mcp-item-btns">
          <button type="button" class="mcp-mini" data-act="focus" title="定位">◎</button>
          <button type="button" class="mcp-mini" data-act="rename" title="重命名">✎</button>
          <button type="button" class="mcp-mini danger" data-act="del" title="删除">✕</button>
        </span>`;
      const nameEl = item.querySelector('.mcp-item-name');
      const btns = item.querySelectorAll('.mcp-mini');
      btns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'focus') {
            window.MapCoordinateSystem.selectAnnotation(a.id);
          } else if (act === 'rename') {
            const label = prompt('标注名称：', a.label || '');
            if (label != null && label.trim()) {
              window.MapCoordinateSystem.updateAnnotation(a.id, { label: label.trim() });
            }
          } else if (act === 'del') {
            window.MapCoordinateSystem.removeAnnotation(a.id);
          }
        });
      });
      // 点击名称 → 定位
      item.addEventListener('click', () => window.MapCoordinateSystem.selectAnnotation(a.id));
      listEl.appendChild(item);
    });
  }

  // ==================== 底图加载 ====================
  function setMapBg(path) {
    const img = document.getElementById('cityMapBg');
    if (img) img.src = path;
    try { localStorage.setItem('coc_map_coord_bg', path); } catch (e) { /* ignore */ }
  }

  // ==================== 生命周期 ====================
  function init() {
    if (!window.MapCoordinateSystem) {
      setTimeout(init, 300);
      return false;
    }
    window.MapCoordinateSystem.init();
    ensureDOM();
    // 默认加载上次选择的地图，否则加载废都青峰山地图（供标注）
    let saved = '';
    try { saved = localStorage.getItem('coc_map_coord_bg') || ''; } catch (e) { /* ignore */ }
    const defaultMap = saved || 'assets/qingfeng_scenes/废都青峰山地图.png';
    setMapBg(defaultMap);
    const mcpMap = body ? body.querySelector('#mcpMap') : null;
    if (mcpMap) mcpMap.value = defaultMap;
    return true;
  }

  function show() { if (panel) panel.classList.remove('hidden'); }
  function hide() { if (panel) panel.classList.add('hidden'); }

  // ==================== 暴露 ====================
  window.MapCoordPanel = { init, show, hide };

  // 自动初始化（地图容器可用后）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
