/**
 * cluePanel.js — 右栏「线索记录」+「消耗品」面板（独立模块）
 *
 * 功能：
 * - 线索记录：展示已收集的文字线索（dungeonState.cluesFound）+ 线索物品（背包 type==='clue'）
 * - 消耗品：12 格网格展示背包 type==='consumable' 物品，点击确认后使用（useItem）
 *
 * 依赖（由 client.js 暴露）：window.socket / window.getCurrentCharacter / window._dungeonState
 * 依赖（client.js 全局）：window.showConfirm / window.showToast
 */
(function () {
  'use strict';

  // 青峰山虚空列车·线索目录（与服务端 qingfengTrain.collectClue 保持一致）
  const CLUE_CATALOG = {
    L1: { title: '旅客护照', loc: '3号行李厢', desc: '所有人的签发日期都在废都799年——没有一本更晚的。' },
    L2: { title: '揉皱的便签', loc: '2号二等座', desc: '「广播里说去7号车集合——但我看到7号车门外有东西在动，黑色的、像柏油一样渗进来。乘务员倒在了过道上。」' },
    L3: { title: '列车长的尸体', loc: '1号驾驶室', desc: '尸体颈部覆盖黑色粘液，姿态端正、面色如生——没有腐败气味（米·戈拟态）。' },
    L4: { title: '日记·第一页', loc: '5号卧铺', desc: '「第三天。广播还在重复一样的话。我已经分不清哪个声音是真的……」' },
    L5: { title: '日记·后页', loc: '5号卧铺', desc: '「陈姐说往7号车跑，她被困在末尾的设备间里。去找陈姐，她知道怎么出去。」' },
    L6: { title: '广播面板日志', loc: '4号餐车', desc: '23:47:00正常广播后，23:47:03信号被外部源劫持。自动广播从未恢复控制权。' },
    L7: { title: '陈慧的证言', loc: '7号乘务设备厢', desc: '米·戈伪装机制、8号车修格斯幼体潜伏位置、8号车尾唯一逃生路径。' },
    L8: { title: '隧道工程图', loc: '3号行李厢', desc: '紧急疏散通道在8号车尾侧壁——「掰开侧壁角阀，闭气贴地通过。8号车有东西盘踞在通道口。」' }
  };

  /** 简易 HTML 转义（防注入） */
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function getChar() {
    return (typeof window.getCurrentCharacter === 'function') ? window.getCurrentCharacter() : null;
  }

  function getDungeon() {
    return window._dungeonState || null;
  }

  /** 渲染线索记录：★ 仅线索物品（剧情道具投影），文字线索已取消 */
  function renderCluePanel() {
    const itemList = document.getElementById('clueItemList');
    if (!itemList) return;
    itemList.innerHTML = '';

    // ★ P2 真相拼图进度（青峰山：truthTier 0未明 1碎片 2拼图 3完全真相）增强目标感
    const d = getDungeon();
    if (d && typeof d.truthTier === 'number') {
      const tier = Math.max(0, Math.min(3, d.truthTier));
      const labels = ['真相未明…', '碎片拾取', '拼图成形', '完全真相'];
      const prog = document.createElement('div');
      prog.className = 'truth-progress';
      prog.innerHTML =
        '<div class="truth-progress-head"><span>🧩 真相拼图</span><span class="truth-progress-tier">' + tier + '/3</span></div>' +
        '<div class="truth-progress-track"><div class="truth-progress-fill" style="width:' + (tier / 3 * 100) + '%"></div></div>' +
        '<div class="truth-progress-label">' + labels[tier] + '</div>';
      itemList.appendChild(prog);
    }

    // ---- 线索物品（★ 剧情道具投影：所有 type==='plot'/'clue' 物品，像快捷栏投影背包物品） ----
    const c = getChar();
    const items = ((c && c.inventory) || []).filter(i => i.type === 'plot' || i.type === 'clue');
    if (items.length === 0) {
      itemList.appendChild(_emptyHint('暂无线索物品'));
    } else {
      items.forEach(it => {
        const name = it.itemName || it.name || '未知';
        const icon = it.icon || '📜';
        const isWalkie = it.itemId === 'QFSP-WALKIE';
        const card = document.createElement('div');
        card.className = 'clue-item' + (isWalkie ? ' clue-item-walkie' : '');
        card.title = name + (it.desc ? '\n' + it.desc : '');
        card.innerHTML =
          `<div class="clue-item-head"><span class="clue-item-title"><span class="clue-item-icon"><img src="/assets/items/${it.itemId}.png" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span style="display:none">${icon}</span></span>${esc(name)}</span></div>` +
          (it.desc ? `<div class="clue-item-desc">${esc(it.desc)}</div>` : '');
        // ★ 金色浮窗（完整描述）
        if (window.attachItemTooltip) window.attachItemTooltip(card, it);
        // ★ 对讲机：点击呼叫陈慧（每 2 回合一次，消耗 0.5 回合值）
        if (isWalkie) {
          card.style.cursor = 'pointer';
          card.addEventListener('click', () => {
            window.socket.emit('walkieCall', {});
            if (window.showToast) window.showToast('📻 你按下对讲机的通话键…');
          });
        }
        itemList.appendChild(card);
      });
    }
  }

  /** 渲染右栏快捷栏 8 格（显示 MC 快捷栏物品，点击使用/装备） */
  function renderConsumePanel() {
    const grid = document.getElementById('consumeGrid');
    if (!grid) return;
    const c = getChar();
    const inv = ((c && c.inventory) || []);
    const hotbar = (c && c.hotbar) || [];
    grid.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const slot = document.createElement('div');
      slot.className = 'consume-slot';
      slot.dataset.idx = i;
      const uid = hotbar[i];
      const item = uid ? inv.find(x => (x.uid || x.id) === uid) : null;
      if (item) {
        const name = item.itemName || item.name || '未知';
        const icon = item.icon || ({ consumable: '🧪', tool: '🪢', material: '🔩', equipment: '⚔️', equip: '⚔️', plot: '📜' }[item.type] || '📦');
        slot.classList.add('filled');
        // ★ 显示物品图片，加载失败回退 emoji
        slot.innerHTML = `<span class="consume-icon"><img src="/assets/items/${item.itemId}.png" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="ce-emoji" style="display:none">${icon}</span></span><span class="consume-name">${esc(name)}${item.stack && item.stack > 1 ? '×' + item.stack : ''}</span>`;
        slot.title = `${name}\n${item.desc || ''}`;
        // ★ 可拖拽（拖到下方 LOL 装备栏/装备格穿戴），拖拽数据为 text/plain uid
        slot.draggable = true;
        slot.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', item.uid || item.id);
          e.dataTransfer.effectAllowed = 'move';
          slot.classList.add('dragging');
        });
        slot.addEventListener('dragend', () => slot.classList.remove('dragging'));
        // ★ hover 金色浮窗（全部信息）
        if (window.attachItemTooltip) window.attachItemTooltip(slot, item);
        slot.onclick = () => useOrEquipBar(item);
      } else {
        slot.title = '快捷栏空位';
      }
      // ★ 快捷栏内拖动 → 互换位置（把 A 拖到 B 的槽，A/B 交换；拖到空槽则移动）
      slot.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        const dropUid = raw.startsWith('__remove__') ? raw.slice('__remove__'.length) : raw;
        if (!dropUid) return;
        const cc = getChar();
        const hot = (cc && cc.hotbar && cc.hotbar.slice()) || [];
        while (hot.length < 8) hot.push(null);
        const i2 = parseInt(slot.dataset.idx, 10);
        const oldIdx = hot.indexOf(dropUid);
        if (oldIdx !== -1) {
          // ★ 互换
          const moved = hot[i2] || null;
          hot[oldIdx] = moved;
          hot[i2] = dropUid;
        } else {
          // 从背包/装备栏拖入：放入目标槽
          hot[i2] = dropUid;
        }
        window.socket.emit('setHotbar', { items: hot });
      });
      grid.appendChild(slot);
    }
  }

  /** 右栏快捷栏点击：使用（消耗）/装备（装备）/提示（工具材料）/对讲机呼叫 */
  async function useOrEquipBar(item) {
    const type = item.type;
    const name = item.itemName || item.name || '未知';
    const uid = item.uid || item.id;
    // ★ 对讲机：点击呼叫陈慧（每 2 回合一次，消耗 0.5 回合值）
    if (item.itemId === 'QFSP-WALKIE') {
      window.socket.emit('walkieCall', {});
      if (window.showToast) window.showToast('📻 你按下对讲机的通话键…');
      return;
    }
    if (type === 'consumable') {
      const ok = await window.showConfirm(`使用「${name}」？`, '使用', '取消');
      if (!ok) return;
      window.socket.emit('useItem', { itemId: uid });
      if (window.showToast) window.showToast(`使用了「${name}」`);
    } else if (type === 'equipment' || type === 'equip' || type === 'tool') {
      window.socket.emit('equipItem', { itemId: uid, slot: item.slot || (type === 'tool' ? 'hand' : 'accessory') });
      if (window.showToast) window.showToast(`已尝试装备「${name}」`);
    } else {
      if (window.showToast) window.showToast(`「${name}」为材料/剧情道具，可在探索场景中使用`);
    }
  }

  function formatEffect(effect) {
    if (!effect) return '—';
    const map = { hp: 'HP', san: 'SAN', maxHp: '最大HP', maxSan: '最大SAN', str: '力量', dex: '敏捷', con: '体质', per: '感知', wil: '意志' };
    return Object.entries(effect).map(([k, v]) => `${map[k] || k} +${v}`).join('，');
  }

  async function useConsumable(item) {
    const name = item.itemName || item.name || '未知';
    const ok = await window.showConfirm(`使用「${name}」？\n效果：${formatEffect(item.effect)}`, '使用', '取消');
    if (!ok) return;
    window.socket.emit('useItem', { itemId: item.id || item.uid });
    if (window.showToast) window.showToast(`使用了「${name}」`);
  }

  function _emptyHint(text) {
    const h = document.createElement('div');
    h.className = 'clue-empty';
    h.textContent = text;
    return h;
  }

  function bindEvents() {
    const socket = window.socket;
    if (!socket) { setTimeout(bindEvents, 400); return; }
    if (window.__cluePanelBound) return;
    window.__cluePanelBound = true;

    socket.on('copyStart', () => { renderCluePanel(); renderConsumePanel(); });
    socket.on('resumePlayer', () => { renderCluePanel(); renderConsumePanel(); });
    socket.on('dungeonStateUpdate', () => renderCluePanel());
    socket.on('roomUpdate', () => renderConsumePanel());
    socket.on('roomPlayersUpdate', () => renderConsumePanel());
    socket.on('inventoryData', () => { renderCluePanel(); renderConsumePanel(); });
    console.log('[CluePanel] 事件已绑定');
  }

  // 对外 API
  window.CluePanel = {
    renderClues: renderCluePanel,
    renderConsumables: renderConsumePanel,
    refresh: () => { renderCluePanel(); renderConsumePanel(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bindEvents(); renderCluePanel(); renderConsumePanel(); });
  } else {
    bindEvents();
    renderCluePanel();
    renderConsumePanel();
  }
})();
