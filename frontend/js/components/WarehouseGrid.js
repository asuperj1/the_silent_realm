/**
 * WarehouseGrid.js — 组件1：仓库格子（可复用）
 * ★ 用途：仓库大空间（15×12 定位式格子，多尺寸物品），支持从背包/装备槽拖入、拖出
 * ★ 复用内核：window.ItemGrid（渲染 + 拖拽 + drop 原语）
 * ★ 拖拽 MIME：application/x-wh（payload JSON { uid, from, slot }）
 * ★ socket 事件：moveToWarehouse（拖入仓库）、unequipToWarehouse（装备槽拖出 → 仓库）
 * 依赖：window.ItemGrid、window.socket（由调用方传入 cfg.socket）
 */
(function () {
  'use strict';

  /**
   * 渲染仓库大格子
   * @param {HTMLElement} board 仓库格子容器（data-space="warehouse"）
   * @param {object} cfg
   *   warehouse: 仓库物品数组
   *   cols / rows: 网格列/行（默认 15×12）
   *   cellSize: 格子像素（默认 48）
   *   socket: socket 实例（必传）
   *   onClick(it): 点击物品回调（可选）
   */
  function render(board, cfg) {
    if (!board || !cfg) return;
    cfg = cfg || {};
    const cols = cfg.cols || 15, rows = cfg.rows || 12;
    const socket = cfg.socket || window.socket;
    window.ItemGrid.renderPositioned(board, cfg.warehouse || [], {
      cols, rows, cellSize: cfg.cellSize,
      cardClass: 'grid-item',
      drag: {
        mime: 'application/x-wh',
        data: (uid) => JSON.stringify({ uid, from: 'warehouse' })
      },
      onClick: cfg.onClick
    });
    // drop 目标：接收背包物品 / 装备槽 → 存入仓库
    window.ItemGrid.bindDrop(board, {
      mime: 'application/x-wh',
      onDrop: (raw, e) => {
        let payload;
        try { payload = JSON.parse(raw); } catch (err) { return; }
        const { uid, from, slot } = payload || {};
        if (slot) {
          // 从装备槽拖出 → 卸下并放入仓库
          if (socket) socket.emit('unequipToWarehouse', { slot, x: null, y: null });
          return;
        }
        if (!uid) return;
        if (from === 'warehouse') {
          // ★ 同空间内部 → 仓库内重排/互换（moveInWarehouse）
          const pos = window.ItemGrid.gridPosFromEvent(e, board, cols, rows, cfg.cellSize);
          if (socket) socket.emit('moveInWarehouse', { itemId: uid, x: pos.x, y: pos.y });
          return;
        }
        const pos = window.ItemGrid.gridPosFromEvent(e, board, cols, rows, cfg.cellSize);
        if (socket) socket.emit('moveToWarehouse', { itemId: uid, x: pos.x, y: pos.y });
      }
    });
  }

  window.WarehouseGrid = { render };
})();
