/**
 * EquipMaterialGrid.js — 组件3：装备 / 材料格子（可复用）
 * ★ 用途：装备背包（仅装备）与 材料+装备背包（混合池）的流式格子（auto-fill + 空槽补齐铺满）
 * ★ 覆盖场景：锻造炉装备池、吞噬装备池、背包/仓库平铺展示
 * ★ 复用内核：window.ItemGrid（渲染 + 拖拽 + 点击原语）
 * ★ 可复用点：同一组件通过 mode 配置过滤（equip / equip+material / all），通过 cardClass + drag.mime + onClick 适配不同宿主
 * 依赖：window.ItemGrid
 */
(function () {
  'use strict';

  /**
   * 过滤物品池
   * @param {Array} items
   * @param {string} mode  'equip'（仅装备）/ 'equip+material'（装备+材料）/ 'all'（全部，去除黑色成长/绑定可选）
   * @param {object} [opts]  { excludeBlack: 排除黑色成长/绑定（默认 true） }
   */
  function filterPool(items, mode, opts) {
    opts = opts || {};
    const excludeBlack = opts.excludeBlack !== false;
    const list = items || [];
    const base = (i) => !excludeBlack || !(i.quality === 'black' || i.bind);
    if (mode === 'equip') return list.filter(i => base(i) && (i.type === 'equipment' || i.type === 'perm'));
    if (mode === 'equip+material') return list.filter(i => base(i) && (i.type === 'equipment' || i.type === 'perm' || i.type === 'material'));
    return list.filter(base);
  }

  /**
   * 渲染流式格子（auto-fill + 空槽补齐）
   * @param {HTMLElement} board 格子容器
   * @param {object} cfg
   *   items: 物品数组（可先经 filterPool 过滤，或传 mode 由内部过滤）
   *   mode: 'equip' / 'equip+material' / 'all'（可选，传了则内部先过滤）
   *   cardClass: 'forge-eq' / 'ws-devour-eq' / 'grid-item'
   *   emptyCls: 空槽补齐类名（默认 cardClass+'-empty'；现有 CSS：forge-empty / ws-devour-empty）
   *   perRow / rows / cellSize / availH: 网格参数（可选，自动估算）
   *   showWorn: 是否显示穿戴标记（默认 true）
   *   drag: { mime, data } 拖拽配置（可选；不传则不可拖）
   *   onClick(it, card, e): 点击物品回调
   */
  function render(board, cfg) {
    if (!board) return [];
    cfg = cfg || {};
    let items = cfg.items || [];
    if (cfg.mode) items = filterPool(items, cfg.mode, { excludeBlack: cfg.excludeBlack });
    return window.ItemGrid.renderFlow(board, items, {
      cardClass: cfg.cardClass || 'forge-eq',
      emptyCls: cfg.emptyCls,
      perRow: cfg.perRow, rows: cfg.rows, cellSize: cfg.cellSize, availH: cfg.availH,
      showWorn: cfg.showWorn !== false,
      drag: cfg.drag,
      onClick: cfg.onClick
    });
  }

  window.EquipMaterialGrid = { render, filterPool };
})();
