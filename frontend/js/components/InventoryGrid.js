/**
 * InventoryGrid.js — 组件2：背包格子（可复用）
 * ★ 用途：背包分区格子（消耗品/剧情/材料/装备/工具，定位式多尺寸），支持从仓库/装备槽拖入、类型校验、拖出
 * ★ 复用内核：window.ItemGrid（渲染 + 拖拽 + drop 原语）
 * ★ 拖拽 MIME：application/x-wh（payload JSON { uid, from, slot }）
 * ★ socket 事件：moveToInventory（拖入背包分区，类型不符自动路由）、unequipItem（装备槽拖出 → 背包）、equipItem（拖入装备槽）
 * 依赖：window.ItemGrid、window.socket（由调用方传入 cfg.socket）
 */
(function () {
  'use strict';

  /**
   * 渲染一个背包分区格子
   * @param {HTMLElement} board 分区格子容器（data-space="inventory"，data-type=分区键）
   * @param {object} cfg
   *   items: 该分区物品数组（已按分区过滤）
   *   type: 分区键（consumable/plot/material/equipment/tool），用于拖入类型校验
   *   cols / rows: 网格列/行
   *   cellSize: 格子像素（默认 48）
   *   socket: socket 实例（必传）
   *   srcItems: 来源物品池（背包+仓库，用于拖入校验），默认取 cfg.items
   *   autoRoute: 类型不匹配时是否自动路由到对应分区（默认 true）
   *   onClick(it): 点击物品回调（可选）
   */
  function render(board, cfg) {
    if (!board || !cfg) return;
    cfg = cfg || {};
    const cols = cfg.cols || 5, rows = cfg.rows || 5;
    const socket = cfg.socket || window.socket;
    const type = cfg.type || board.dataset.type;
    const srcItems = cfg.srcItems || cfg.items || [];
    const partitionFor = window.ItemGrid.partitionFor;
    window.ItemGrid.renderPositioned(board, cfg.items || [], {
      cols, rows, cellSize: cfg.cellSize,
      cardClass: 'grid-item',
      drag: {
        mime: 'application/x-wh',
        data: (uid) => JSON.stringify({ uid, from: 'inventory' })
      },
      onClick: cfg.onClick
    });
    // drop 目标：接收仓库物品 / 装备槽 → 放入背包分区（类型匹配才定位，否则自动路由）
    window.ItemGrid.bindDrop(board, {
      mime: 'application/x-wh',
      onDrop: (raw, e) => {
        let payload;
        try { payload = JSON.parse(raw); } catch (err) { return; }
        const { uid, from, slot } = payload || {};
        if (slot) {
          // 从装备槽拖出 → 卸下放入背包
          if (socket) socket.emit('unequipItem', { slot });
          return;
        }
        if (!uid) return;
        if (from === 'inventory') {
          // ★ 同空间内部 → 背包分区内重排/互换（moveInInventory，服务端已支持）
          // 跨分区（物品类型与目标分区不符）→ 保留友好提示
          const srcItem = srcItems.find(i => String(i.uid || i.id) === String(uid));
          if (srcItem && type && partitionFor(srcItem.type) !== type) {
            if (window.showToast) window.showToast(`「${srcItem.itemName || srcItem.name}」只能放入对应背包分区`);
            return;
          }
          const pos = window.ItemGrid.gridPosFromEvent(e, board, cols, rows, cfg.cellSize);
          if (socket) socket.emit('moveInInventory', { itemId: uid, x: pos.x, y: pos.y });
          return;
        }
        const srcItem = srcItems.find(i => String(i.uid || i.id) === String(uid));
        if (type && srcItem && partitionFor(srcItem.type) === type) {
          const pos = window.ItemGrid.gridPosFromEvent(e, board, cols, rows, cfg.cellSize);
          if (socket) socket.emit('moveToInventory', { itemId: uid, x: pos.x, y: pos.y });
        } else {
          // 类型不匹配 → 自动放入正确分区
          if (socket) socket.emit('moveToInventory', { itemId: uid, x: null, y: null });
          if (window.showToast) window.showToast('物品将放入对应背包分区');
        }
      }
    });
  }

  /**
   * 渲染装备槽（拖入装载 / 拖出卸下）——通用 6 部位装备槽
   * @param {HTMLElement} dockEl 装备槽容器
   * @param {object} cfg
   *   equip: 角色穿戴 {weapon/head/body/hand/foot/accessory}
   *   socket: socket 实例（必传）
   *   slotIds: {weapon:'whWeapon',...} 每部位名称显示元素 id
   *   slotClass: 装备槽选择器基类（默认 '.eq-slot'）
   *   equipTo: 拖入装备槽时：from=inventory → equipItem；from=warehouse → 先移入背包再装备
   */
  function renderEquipSlots(dockEl, cfg) {
    if (!dockEl || !cfg) return;
    cfg = cfg || {};
    const socket = cfg.socket || window.socket;
    const equip = cfg.equip || {};
    const slots = dockEl.querySelectorAll((cfg.slotClass || '.eq-slot') + '[data-slot]');
    slots.forEach(slotEl => {
      const slot = slotEl.dataset.slot;
      const valEl = cfg.slotIds && cfg.slotIds[slot] ? document.getElementById(cfg.slotIds[slot]) : null;
      const name = equip[slot];
      if (valEl) { valEl.textContent = name || '空'; valEl.style.color = name ? '#ffe9a8' : ''; }
      if (name) {
        slotEl.classList.add('has-item');
        slotEl.draggable = true;
        slotEl.ondragstart = (e) => {
          e.dataTransfer.setData('application/x-wh', JSON.stringify({ slot }));
          e.dataTransfer.effectAllowed = 'move';
          slotEl.classList.add('dragging');
        };
        slotEl.ondragend = () => slotEl.classList.remove('dragging');
      } else {
        slotEl.classList.remove('has-item');
        slotEl.draggable = false;
        slotEl.ondragstart = null;
      }
      if (!slotEl._igEquipBound) {
        slotEl._igEquipBound = true;
        slotEl.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
        slotEl.addEventListener('drop', (e) => {
          e.preventDefault();
          const raw = e.dataTransfer.getData('application/x-wh');
          if (!raw) return;
          let payload;
          try { payload = JSON.parse(raw); } catch (err) { return; }
          const { uid, from, slot: fromSlot } = payload || {};
          if (fromSlot || !uid || !socket) return;
          if (from === 'inventory') socket.emit('equipItem', { itemId: uid, slot });
          else if (from === 'warehouse') {
            socket.emit('moveToInventory', { itemId: uid, x: null, y: null });
            setTimeout(() => socket.emit('equipItem', { itemId: uid, slot }), 150);
          }
        });
      }
    });
  }

  window.InventoryGrid = { render, renderEquipSlots };
})();
