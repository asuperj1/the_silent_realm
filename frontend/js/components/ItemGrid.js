/**
 * ItemGrid.js — 可复用「物品格子」组件内核
 * ★ 职责：物品格子渲染（定位式/流式）+ 拖拽原语（dragstart / dragover / drop）+ 点击交互 + 空槽补齐
 * ★ 不绑定 socket / 业务逻辑；三个业务组件复用本内核：
 *     WarehouseGrid（仓库格子）/ InventoryGrid（背包格子）/ EquipMaterialGrid（装备·材料格子）
 * ★ 两种格子模式：
 *     positioned —— 定位式（物品含 grid.x/y + size 多尺寸），用于仓库 / 背包分区
 *     flow       —— 流式（auto-fill 网格 + 空槽补齐铺满），用于装备 / 材料池（锻造 / 吞噬 / 背包平铺）
 * ★ 支持三种卡片结构（cardClass 映射内部类名）：grid-item / forge-eq / ws-devour-eq
 * 依赖：无（纯 DOM），挂载 window.ItemGrid
 */
(function () {
  'use strict';

  const QUALITY_LABEL = { white: '白', green: '绿', blue: '蓝', purple: '紫', gold: '金', orange: '橙', red: '红', black: '黑' };
  const QUALITY_COLOR = { white: '#c8c8c8', green: '#4cc9f0', blue: '#4d7cff', purple: '#9b5cff', gold: '#ffd700', orange: '#ff8c42', red: '#ff4d4d', black: '#9aa0a6' };
  const TYPE_LABEL = { consumable: '消耗品', plot: '剧情', material: '材料', equipment: '装备', equip: '装备', tool: '工具', perm: '强化' };
  const ATTR_LABEL = { str: '力量', con: '体质', dex: '敏捷', per: '感知', wil: '意志', int: '智力', cha: '魅力', lck: '幸运', hp: '生命', san: '理智' };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 卡片结构映射：不同卡片类的内部类名前缀
  // ★ grid-item（仓库/背包小格）无 meta 行：保持 gicon+gname+gstack+gq 原视觉，避免无样式 gmeta 裸文本
  // ★ market-eq（商店寄售/拍卖市场卡片，宽卡带 footer 由宿主注入）
  // ★ ws-mk-eq（商店挂售/挂拍选择器小格，点击选中 + 可拖动）
  const STRUCT = {
    'grid-item': { icon: 'gicon', iconEmoji: 'gemoji', name: 'gname', stack: 'gstack', qbar: 'gq' },
    'forge-eq': { icon: 'forge-eq-icon', iconEmoji: 'forge-emoji', name: 'forge-eq-name', meta: 'forge-eq-meta' },
    'ws-devour-eq': { icon: 'ws-devour-eq-icon', iconEmoji: 'forge-emoji', name: 'ws-devour-eq-name', meta: 'ws-devour-eq-meta' },
    'market-eq': { icon: 'market-eq-icon', iconEmoji: 'forge-emoji', name: 'market-eq-name', meta: 'market-eq-meta' },
    'ws-mk-eq': { icon: 'ws-mk-eq-icon', iconEmoji: 'forge-emoji', name: 'ws-mk-eq-name', meta: 'ws-mk-eq-meta' }
  };

  /** 物品图标 HTML（图片 /assets/items/{itemId}.png + emoji 兜底） */
  function iconHtml(it, s) {
    s = s || {};
    const itemId = it.itemId || (typeof it.id === 'string' && it.id.startsWith('G-') ? it.id : '');
    const emoji = it.icon || '📦';
    const iconCls = s.icon || 'gicon';
    const emojiCls = s.emoji || 'gemoji';
    if (itemId) {
      return `<span class="${iconCls}"><img src="/assets/items/${esc(itemId)}.png" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="${emojiCls}" style="display:none">${esc(emoji)}</span></span>`;
    }
    return `<span class="${iconCls}">${esc(emoji)}</span>`;
  }

  /** 物品 tooltip 文本（描述 + 属性词条 + 类型） */
  function tooltipOf(it) {
    const eff = (it.effects || []).map((e) => {
      let name = e.label;
      if (!name) name = e.kind === 'stat' ? (ATTR_LABEL[e.stat] || e.stat) : (ATTR_LABEL[e.kind] || e.kind);
      return name + (e.value ? (e.value > 0 ? ' +' : ' ') + e.value : '') + (e.duration ? '(' + e.duration + '回合)' : '');
    }).join('；');
    return (it.desc || '') + (eff ? '\n' + eff : '') + `\n${TYPE_LABEL[it.type] || it.type || ''}`;
  }

  /**
   * 生成单个物品卡片 HTML（通用，按 cardClass 映射内部结构）
   * @param {object} it 物品
   * @param {object} [cfg]
   *   cardClass: 卡片基类（grid-item / forge-eq / ws-devour-eq）
   *   worn: 是否穿戴标记（默认取 it.worn）
   *   draggable: 是否可拖（默认 true）
   *   noQbar: grid-item 省略右上角品质点（默认 false，保持紧凑小格原视觉）
   * @returns {string} HTML
   */
  function itemCard(it, cfg) {
    cfg = cfg || {};
    const cardClass = cfg.cardClass || 'grid-item';
    const s = STRUCT[cardClass] || STRUCT['grid-item'];
    const q = it.quality || 'white';
    const worn = cfg.worn != null ? cfg.worn : !!it.worn;
    const isBlack = it.quality === 'black' || it.bind;
    const name = it.itemName || it.name || '未知';
    const stackable = it.stackable && it.stack > 1;
    const metaParts = [];
    if (s.meta) {
      metaParts.push(QUALITY_LABEL[q] || q);
      if (it.enhanceLevel) metaParts.push('+' + it.enhanceLevel);
      if (it.durability != null) metaParts.push('🔧' + it.durability + '/' + (it.maxDurability ?? 100));
      if (stackable) metaParts.push('×' + it.stack);
      if (worn) metaParts.push('🛡穿戴');
      if (isBlack && !worn) metaParts.push('🔒绑定');
    }
    const nameHtml = `<span class="${s.name}">${esc(name)}</span>`;
    const stackHtml = s.stack && stackable ? `<span class="${s.stack}">×${it.stack}</span>` : '';
    const metaHtml = s.meta ? `<span class="${s.meta}">${esc(metaParts.join(' '))}</span>` : '';
    const qbar = (!cfg.noQbar && s.qbar) ? `<span class="${s.qbar}" style="background:${QUALITY_COLOR[q] || '#c8c8c8'}"></span>` : '';
    const dragAttr = cfg.draggable === false ? '' : ' draggable="true"';
    return `<div class="${cardClass} q-${q}${worn ? ' worn' : ''}" data-uid="${esc(it.uid || it.id || '')}" title="${esc(tooltipOf(it))}"${dragAttr}>
      ${iconHtml(it, { icon: s.icon, emoji: s.iconEmoji })}
      ${nameHtml}${stackHtml}${metaHtml}${qbar}
    </div>`;
  }

  /**
   * 卡片拖拽绑定（dragstart 设置 dataTransfer + dragging class / dragend 还原）
   * @param {HTMLElement} card
   * @param {object} [cfg]
   *   drag: { mime, data(uid,card)->string|string, onStart, onEnd }
   */
  // ★ 拖拽异常兜底：document 级 dragend/dragcancel 清理当前拖拽卡片（防 .dragging 残留导致半透明卡死）
  let _draggingEl = null;
  let _dragCleanBound = false;
  function ensureDragClean() {
    if (_dragCleanBound) return;
    _dragCleanBound = true;
    const clear = () => { if (_draggingEl) { _draggingEl.classList.remove('dragging'); _draggingEl = null; } };
    document.addEventListener('dragend', clear, true);
    document.addEventListener('dragcancel', clear, true);
  }
  function bindDrag(card, cfg) {
    const drag = cfg && cfg.drag;
    if (!drag || drag === false) { card.draggable = false; return card; }
    ensureDragClean();
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      const uid = card.dataset.uid;
      const data = typeof drag.data === 'function' ? drag.data(uid, card, e) : (drag.data != null ? drag.data : '');
      if (drag.mime) e.dataTransfer.setData(drag.mime, String(data == null ? '' : data));
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
      _draggingEl = card;
      if (drag.onStart) drag.onStart(uid, card, e);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      if (_draggingEl === card) _draggingEl = null;
      if (drag.onEnd) drag.onEnd(card);
    });
    return card;
  }

  /** 事件坐标 → 格子位置（越界钳制） */
  function gridPosFromEvent(e, board, cols, rows, cellSize) {
    const c = cellSize || 48;
    const rect = board.getBoundingClientRect();
    let x = Math.floor((e.clientX - rect.left) / c);
    let y = Math.floor((e.clientY - rect.top) / c);
    return { x: Math.max(0, Math.min((cols || 1) - 1, x)), y: Math.max(0, Math.min((rows || 1) - 1, y)) };
  }

  /**
   * drop 目标绑定（容器接收拖放）
   * @param {HTMLElement} board
   * @param {object} cfg
   *   mime: 读取的拖拽 MIME 类型
   *   onDrop(raw, e): 收到数据回调（raw 为空且未 allowEmpty 时不触发）
   *   allowEmpty: 允许空数据回调
   *   onDragOver / onDragLeave
   */
  function bindDrop(board, cfg) {
    if (!board || board._igDropBound) return board;
    board._igDropBound = true;
    cfg = cfg || {};
    board.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      board.classList.add('ig-drop-hover');   // ★ 落点高亮反馈
      if (cfg.onDragOver) cfg.onDragOver(e);
    });
    board.addEventListener('dragleave', (e) => {
      if (board.contains(e.relatedTarget)) return;   // ★ 仍在 board 内（子元素间移动）不取消高亮
      board.classList.remove('ig-drop-hover');
      if (cfg.onDragLeave) cfg.onDragLeave(e);
    });
    board.addEventListener('drop', (e) => {
      e.preventDefault();
      board.classList.remove('ig-drop-hover');
      const raw = cfg.mime ? (e.dataTransfer.getData(cfg.mime) || '') : '';
      if (!raw && !cfg.allowEmpty) return;
      if (cfg.onDrop) cfg.onDrop(raw, e);
    });
    return board;
  }

  /**
   * 定位式格子渲染（仓库 / 背包分区）：背景格 + 物品按 grid.x/y + size 定位
   * @param {HTMLElement} board
   * @param {Array} items
   * @param {object} cfg  cols/rows/cellSize/cardClass/drag/onClick/cardPost
   * @returns {HTMLElement[]} 物品卡片元素
   */
  function renderPositioned(board, items, cfg) {
    if (!board) return [];
    cfg = cfg || {};
    const cols = cfg.cols || 15, rows = cfg.rows || 12, cell = cfg.cellSize || 48;
    const cardClass = cfg.cardClass || 'grid-item';
    let html = '';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) html += '<div class="gcell"></div>';
    board.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`;
    board.style.gridTemplateRows = `repeat(${rows}, ${cell}px)`;
    board.innerHTML = html;
    const els = [];
    for (const it of items) {
      if (!it.grid) continue;
      const wrap = document.createElement('div');
      wrap.innerHTML = itemCard(it, { cardClass, worn: false, draggable: cfg.drag !== false });
      const card = wrap.firstElementChild;
      card.style.gridColumn = `${it.grid.x + 1} / span ${it.size ? it.size.w : 1}`;
      card.style.gridRow = `${it.grid.y + 1} / span ${it.size ? it.size.h : 1}`;
      card.dataset.uid = it.uid || it.id;
      bindDrag(card, cfg);
      if (cfg.onClick) card.addEventListener('click', (e) => cfg.onClick(it, card, e));
      if (cfg.cardPost) cfg.cardPost(card, it, cfg);
      board.appendChild(card);
      els.push(card);
    }
    return els;
  }

  /**
   * 流式格子渲染（装备 / 材料池 / 背包平铺）：auto-fill 网格 + 空槽补齐铺满
   * @param {HTMLElement} board
   * @param {Array} items
   * @param {object} cfg
   *   cardClass / perRow / rows / cellSize / availH / emptyCls
   *   showWorn（默认 true）/ drag / onClick / cardPost(card, it, cfg)
   * @returns {HTMLElement[]} 物品卡片元素（不含空槽）
   */
  function renderFlow(board, items, cfg) {
    if (!board) return [];
    cfg = cfg || {};
    const cardClass = cfg.cardClass || 'grid-item';
    const emptyCls = cfg.emptyCls || cardClass + '-empty';
    const cell = cfg.cellSize || 56;
    const perRow = cfg.perRow || Math.max(8, Math.floor((board.clientWidth || 1200) / cell));
    const rows = cfg.rows || Math.max(2, Math.min(5, Math.floor((cfg.availH || 300) / cell)));
    const total = Math.max(perRow * rows, Math.ceil(items.length / perRow) * perRow);
    const fill = Math.max(0, total - items.length);
    const cards = items.map(it => itemCard(it, { cardClass, worn: cfg.showWorn !== false ? it.worn : false, draggable: cfg.drag !== false }));
    board.innerHTML = cards.join('') + `<div class="${cardClass} ${emptyCls}" data-uid=""></div>`.repeat(fill);
    const els = [];
    board.querySelectorAll('.' + cardClass).forEach(card => {
      if (card.classList.contains(emptyCls)) return;
      bindDrag(card, cfg);
      if (cfg.cardPost) {
        const it = items.find(i => String(i.uid || i.id) === String(card.dataset.uid));
        if (it) cfg.cardPost(card, it, cfg);
      }
      els.push(card);
    });
    if (cfg.onClick && !board._igClickBound) {
      board._igClickBound = true;
      board.addEventListener('click', (e) => {
        const card = e.target.closest('.' + cardClass);
        if (!card || card.classList.contains(emptyCls)) return;
        const uid = card.dataset.uid;
        const it = items.find(i => String(i.uid || i.id) === String(uid));
        if (it) cfg.onClick(it, card, e);
      });
    }
    return els;
  }

  /** 物品类型 → 背包分区键（null 表示无分区，如剧情/消耗） */
  function partitionFor(type) {
    return { consumable: 'consumable', plot: 'plot', material: 'material', equipment: 'equipment', equip: 'equipment', perm: 'equipment', tool: 'tool' }[type] || null;
  }

  /** 清空容器（解除绑定标记） */
  function destroy(board) {
    if (!board) return;
    board._igDropBound = false;
    board._igClickBound = false;
    board.innerHTML = '';
  }

  window.ItemGrid = {
    esc, QUALITY_LABEL, QUALITY_COLOR, TYPE_LABEL, ATTR_LABEL,
    iconHtml, tooltipOf, itemCard, bindDrag, gridPosFromEvent,
    bindDrop, renderPositioned, renderFlow, partitionFor, destroy
  };
})();
