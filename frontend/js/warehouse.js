/**
 * warehouse.js — 仓库独立页面模块（分区格子装载系统）
 * ★ 布局：左=仓库 800 格大空间 / 右=背包 分区（消耗25/剧情80/材料40/装备12含槽）
 * ★ 交互：拖拽装载（跨栏/分区 + 装备槽），无按钮
 * 依赖：window.socket、window.getCurrentCharacter()
 * 事件：getInventory / inventoryData / moveToWarehouse / moveToInventory / equipItem / unequipItem / unequipToWarehouse / equipChanged
 */
(function() {
  let inventory = [];   // 背包（随身）
  let warehouse = [];   // 仓库（存储）
  let equipInfo = {};   // ★ 穿戴装备完整信息（品质/图标/词条，来自服务端 getInventory.equipInfo）
  let partitions = { consumable: { cols: 5, rows: 5 }, plot: { cols: 15, rows: 4 }, material: { cols: 10, rows: 4 }, equipment: { cols: 12, rows: 1 }, tool: { cols: 6, rows: 4 } };
  let whCols = 15, whRows = 12;   // ★ 仓库 15×12 = 180 格（2026-08-23）
  let bound = false;

  // ★ 背包分区格子像素：与仓库同尺寸（computeWhCell），2026-08-23
  const SLOT_IDS = { weapon: 'whWeapon', head: 'whHead', body: 'whBody', hand: 'whHand', foot: 'whFoot', accessory: 'whAccessory' };
  const PART_IDS = { consumable: 'whInv-consumable', plot: 'whInv-plot', material: 'whInv-material', equipment: 'whInv-equipment', tool: 'whInv-tool' };

  // ★ 仓库格子大小：按左半屏宽度动态计算，使 15 列正好铺满左半边且不出现横向滚动条
  //   减去的余量覆盖：网格 gap(14px) + padding(4px) + border(2px) ≈ 20px
  function computeWhCell() {
    const panel = document.querySelector('.wh-panel');
    const width = panel ? panel.clientWidth : 760;
    return Math.max(20, Math.floor((width - 24) / whCols));
  }
  const QUALITY_COLOR = { white: '#c8c8c8', green: '#4cc9f0', blue: '#4d7cff', purple: '#9b5cff', gold: '#ffd700', orange: '#ff8c42', red: '#ff4d4d', black: '#9aa0a6' };
  const ATTR_LABEL = { str: '力量', con: '体质', dex: '敏捷', per: '感知', wil: '意志', hp: '生命', san: '理智' };
  const TYPE_LABEL = { consumable: '消耗品', plot: '剧情', material: '材料', equipment: '装备', equip: '装备', tool: '工具' };
  const SLOT_LABEL = { weapon: '武器', head: '头部', body: '身体', hand: '手部', foot: '足部', accessory: '配饰' };

  function partitionFor(type) {
    return { consumable: 'consumable', plot: 'plot', material: 'material', equipment: 'equipment', equip: 'equipment', tool: 'tool' }[type] || null;
  }

  // ==================== 格子渲染（★ 委托给可复用组件） ====================
  //   仓库大格 → WarehouseGrid（组件1）；背包分区 → InventoryGrid（组件2）
  //   内核 ItemGrid 统一处理：定位式格子、物品卡片、拖拽（dragstart/drop）、品质边框、图标+emoji 兜底
  function renderGrid(board, list, cols, rows, cell) {
    if (!board) return;
    const space = board.dataset.space || 'inventory';
    if (space === 'warehouse') {
      window.WarehouseGrid.render(board, {
        warehouse: list, cols, rows, cellSize: cell, socket: window.socket
      });
    } else {
      window.InventoryGrid.render(board, {
        items: list, type: board.dataset.type, cols, rows, cellSize: cell,
        socket: window.socket, srcItems: [...inventory, ...warehouse]
      });
    }
  }

  // 装备槽：显示装备 + 拖拽目标（★ 委托 InventoryGrid.renderEquipSlots）
  function renderEquip() {
    const ch = window.getCurrentCharacter && window.getCurrentCharacter();
    const equip = (ch && ch.equip) || {};
    const dock = document.querySelector('.wh-equip-slots');
    if (dock) window.InventoryGrid.renderEquipSlots(dock, {
      equip, socket: window.socket, slotIds: SLOT_IDS
    });
  }

  function updateCap() {
    const used = (list) => list.filter(i => i.grid).reduce((s, i) => s + (i.size ? i.size.w * i.size.h : 1), 0);
    const whUsed = used(warehouse);
    const capWh = document.getElementById('whCapLbl');
    if (capWh) capWh.textContent = `${whUsed}/${whCols * whRows}`;
    for (const [key, id] of Object.entries(PART_IDS)) {
      const p = partitions[key] || { cols: 5, rows: 5 };
      const list = inventory.filter(i => partitionFor(i.type) === key);
      const capEl = document.getElementById('cap' + key.charAt(0).toUpperCase() + key.slice(1));
      let extra = 0;
      if (key === 'equipment') {
        const ch = window.getCurrentCharacter && window.getCurrentCharacter();
        extra = Object.values((ch && ch.equip) || {}).filter(Boolean).length; // 含 6 槽
      }
      if (capEl) capEl.textContent = `${used(list) + extra}/${p.cols * p.rows + (key === 'equipment' ? 6 : 0)}`;
    }
  }

  function render() {
    // 仓库大网格（15 列，格子大小适配左半屏）
    renderGrid(document.getElementById('whWhGrid'), warehouse, whCols, whRows, computeWhCell());
    // 背包各分区（格子与仓库同尺寸）
    const cell = computeWhCell();
    for (const [key, id] of Object.entries(PART_IDS)) {
      const p = partitions[key] || { cols: 5, rows: 5 };
      const list = inventory.filter(i => partitionFor(i.type) === key);
      renderGrid(document.getElementById(id), list, p.cols, p.rows, cell);
    }
    renderEquip();
    updateCap();
  }

  function init() {
    if (bound) return;
    bound = true;
    if (window.socket) {
      window.socket.on('inventoryData', (data) => {
        inventory = data.items || [];
        warehouse = data.warehouse || [];
        if (data.equipInfo) equipInfo = data.equipInfo;   // ★ 穿戴装备品质/图标（吞噬/锻造预览用）
        if (data.partitions) partitions = data.partitions;
        if (data.whCols) whCols = data.whCols;
        if (data.whRows) whRows = data.whRows;
        const ch = window.getCurrentCharacter && window.getCurrentCharacter();
        if (ch) { ch.inventory = inventory; ch.warehouse = warehouse; }
        if (isActive()) render();
        if (window.CluePanel?.refresh) window.CluePanel.refresh();
      });
      window.socket.on('equipChanged', (data) => {
        const ch = window.getCurrentCharacter && window.getCurrentCharacter();
        if (ch) { ch.equip = data.equip; ch.inventory = data.items; ch.warehouse = data.warehouse || []; }
        inventory = data.items || [];
        warehouse = data.warehouse || [];
        if (isActive()) render();
        if (window.CluePanel?.refresh) window.CluePanel.refresh();
      });
    }
    // ★ drop 目标绑定已由组件（WarehouseGrid / InventoryGrid）在 render 时内部完成，此处不再重复绑定
    const back = document.getElementById('btnWhBack');
    if (back) back.addEventListener('click', () => window.Warehouse.close());
  }

  function isActive() {
    const p = document.getElementById('pageWarehouse');
    const pane = document.getElementById('cdPaneInventory');
    return (p && p.classList.contains('active')) || (pane && pane.classList.contains('active'));
  }

  window.Warehouse = {
    init,
    /**
     * 打开仓库格子界面
     * @param {string} [embedId] 若传入容器 id，则内嵌到该容器（详情页背包仓库标签）；否则全屏 pageWarehouse
     */
    open: (embedId) => {
      init();
      const ch = window.getCurrentCharacter && window.getCurrentCharacter();
      if (!ch) { (window.showToast || function(m){ alert(m); })('请先选择角色'); return; }
      // ★ 移动仓库格子 body 到目标容器（内嵌 / 全屏），避免 id 冲突
      const src = document.querySelector('#pageWarehouse .inventory-page-body');
      if (embedId) {
        const dst = document.getElementById(embedId);
        if (src && dst && src.parentElement !== dst) dst.appendChild(src);
        const pane = document.getElementById('cdPaneInventory');
        if (pane) pane.classList.add('active');
        if (typeof showPage === 'function') showPage(document.getElementById('pageCharDetail'));
      } else {
        const wh = document.getElementById('pageWarehouse');
        const invPage = wh && wh.querySelector('.inventory-page');
        if (src && invPage && src.parentElement !== invPage) invPage.appendChild(src);
        if (typeof showPage === 'function') showPage(wh);
        else { document.getElementById('pageCharacters')?.classList.remove('active'); if (wh) wh.classList.add('active'); }
      }
      inventory = (ch.inventory || []).slice();
      warehouse = (ch.warehouse || []).slice();
      render();
      window.socket.emit('getInventory');
    },
    close: () => {
      const wh = document.getElementById('pageWarehouse');
      if (wh) wh.classList.remove('active');
      if (typeof showPage === 'function') showPage(document.getElementById('pageCharacters'));
      else {
        document.getElementById('pageWarehouse')?.classList.remove('active');
        document.getElementById('pageCharacters')?.classList.add('active');
      }
    },
    refresh: render,
    /** 穿戴装备完整信息（slot → {quality, icon, ...}）供吞噬/锻造预览读取 */
    getEquipInfo: () => equipInfo
  };
})();
