/**
 * client-shop.js — 商店 / 背包 / 物品 / 快捷栏 / 物品详情 / gold tooltip（2026-08-23 从 client.js 拆分）
 * 依赖：client.js 先加载（socket / currentCharacter / 公共 UI 工具）
 */
let shopItems = null;
let shopCategory = 'all';
let shopSelected = null;
let shopTier = 0;   // ★ P1 阶位：当前角色阶位（商城高阶商品门槛）
const TIER_NAMES = ['见习', '初阶', '中阶', '高阶', '资深', '大师'];
const TIER_BY_QUALITY = { blue: 1, purple: 2, gold: 3, orange: 4, red: 5 };

function needTierOf(item) {
  return item && (item.tier || TIER_BY_QUALITY[item.quality] || 0);
}

function renderShop(items, points, tier) {
  shopItems = items || {};
  shopTier = typeof tier === 'number' ? tier : shopTier;
  const ptsEl = document.getElementById('shopPointsDisplayTop');
  if (ptsEl) ptsEl.textContent = `🪙 诡秘点数: ${points}`;
  const tierEl = document.getElementById('shopTierDisplay');
  if (tierEl) tierEl.textContent = `阶位：${TIER_NAMES[shopTier] || '见习'}`;
  renderShopGrid();
}

function renderShopGrid() {
  const grid = document.getElementById('shopItemGrid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.entries(shopItems || {}).forEach(([name, item]) => {
    if (shopCategory !== 'all' && item.type !== shopCategory) return;
    const card = document.createElement('div');
    card.className = 'shop-item-card' + (shopSelected === name ? ' selected' : '');
    card.dataset.name = name;
    const icon = item.icon || ({ equip: '⚔️', equipment: '⚔️', consumable: '🧪', tool: '🪢', material: '🔩', plot: '📜' }[item.type] || '💪');
    const typeLabel = { perm: '强化', consumable: '消耗品', equip: '装备', equipment: '装备', tool: '工具', material: '材料', plot: '剧情' }[item.type] || '物品';
    const qColor = { white: '#c8c8c8', green: '#4cc9f0', blue: '#4d7cff', purple: '#9b5cff', gold: '#ffd700', orange: '#ff8c42', red: '#ff4d4d', black: '#9aa0a6' }[item.quality] || '#c8c8c8';
    // ★ 商品图标：有 itemId 用物品图（emoji 兜底），否则 emoji
    const iconHtml = item.itemId
      ? `<span class="shop-item-icon"><img src="/assets/items/${item.itemId}.png" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="shop-item-emoji" style="display:none">${icon}</span></span>`
      : `<span class="shop-item-icon">${icon}</span>`;
    // ★ P1 阶位门槛：蓝色+商品需对应阶位（未达 → 灰锁）
    const needTier = needTierOf(item);
    const locked = needTier > 0 && shopTier < needTier;
    card.innerHTML = `<span class="shop-quality" style="background:${qColor}"></span>
      ${iconHtml}
      <strong class="shop-item-name">${name}${locked ? ' <span class="shop-lock">🔒</span>' : ''}</strong>
      ${needTier > 0 ? `<span class="shop-tier-req">需「${TIER_NAMES[needTier]}」阶</span>` : ''}
      <span class="shop-item-cost">${item.cost} 🪙</span>
      <span class="shop-item-type">${typeLabel}${item.quality ? ' · ' + ({white:'白',green:'绿',blue:'蓝',purple:'紫',gold:'金',orange:'橙',red:'红',black:'黑'}[item.quality] || '') : ''}</span>`;
    if (locked) card.classList.add('locked');
    card.addEventListener('click', () => selectShopItem(name, item));
    grid.appendChild(card);
  });
  if (grid.children.length === 0) grid.innerHTML = '<div class="empty-inventory">该分类暂无物品</div>';
}

function selectShopItem(name, item) {
  shopSelected = name;
  renderShopGrid();
  const detail = document.getElementById('shopDetail');
  if (!detail) return;
  const effHint = item.itemId
    ? ({ equipment: '装备物品 · 进入背包后装备到对应部位', consumable: '消耗品 · 进入背包后使用生效', tool: '工具 · 进入背包后可在探索中使用', material: '材料 · 用于制作与修复' }[item.type] || '物品 · 进入背包后使用')
    : '';
  const effText = (item.effect && Object.keys(item.effect).length)
    ? `<div class="shop-detail-effect">效果：${JSON.stringify(item.effect)}</div>`
    : (effHint ? `<div class="shop-detail-effect">${effHint}</div>` : '');
  detail.innerHTML = `
    <h3 class="shop-detail-name">${name}</h3>
    <p class="shop-detail-desc">${item.desc || ''}</p>
    ${effText}
    <div class="shop-detail-price">${item.cost} 🪙</div>
    ${needTierOf(item) > 0 ? `<div class="shop-detail-tier">🔒 需「${TIER_NAMES[needTierOf(item)]}」阶位（当前「${TIER_NAMES[shopTier]}」）</div>` : ''}
    <button class="shop-buy-btn" id="btnBuyItem">购买</button>
  `;
  const buyBtn = detail.querySelector('#btnBuyItem');
  if (buyBtn) buyBtn.addEventListener('click', async () => {
    if (needTierOf(item) > 0 && shopTier < needTierOf(item)) {
      if (window.showToast) showToast(`✖ 需「${TIER_NAMES[needTierOf(item)]}」阶位解锁（当前「${TIER_NAMES[shopTier]}」）`);
      return;
    }
    const ok = await showConfirm(`确定购买 ${name}？\n价格：${item.cost} 诡秘点`);
    if (ok) socket.emit('buyItem', { itemId: name });
  });
}

function bindShopCats() {
  document.querySelectorAll('.shop-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shop-cat').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      shopCategory = btn.dataset.cat;
      renderShopGrid();
    });
  });
}

// ==================== 背包渲染（仓库式格子：分区背包 + 快捷栏 + 六槽装备） ====================
let mcHotbar = [];        // 快捷栏（uid 列表，最长 8）
let mcHotSelected = 0;    // 当前选中的快捷栏槽位

function bindInvCats() { /* 分区背包不使用分类栏 */ }

const INV_CELL = 44;      // 副本背包格子像素（快捷栏风格卡片，紧凑免滚动）
const INV_PART_IDS = { consumable: 'inv-consumable', plot: 'inv-plot', material: 'inv-material', tool: 'inv-tool', equipment: 'inv-equipment' };
const INV_PARTITIONS = {
  consumable: { cols: 5, rows: 5 },   // 25 格
  plot:       { cols: 15, rows: 4 },  // 60 格（横向 15 列 × 4 行，与仓库页一致）
  material:   { cols: 10, rows: 4 },  // 40 格
  equipment:  { cols: 12, rows: 1 },  // 12 格（横排一列，与仓库页一致）
  tool:       { cols: 6, rows: 4 }    // 24 格
};
function invPartitionOf(type) {
  return { consumable: 'consumable', plot: 'plot', material: 'material', equipment: 'equipment', equip: 'equipment', tool: 'tool' }[type] || null;
}
const MC_QUALITY_COLOR = { white: '#c8c8c8', green: '#4cc9f0', blue: '#4d7cff', purple: '#9b5cff', gold: '#ffd700', orange: '#ff8c42', red: '#ff4d4d', black: '#9aa0a6' };
function mcIconOf(item) {
  return item.icon || ({ consumable: '🧪', tool: '🪢', material: '🔩', equipment: '⚔️', equip: '⚔️', plot: '📜', perm: '💪' }[item.type] || '📦');
}
const INV_TYPE_LABEL = { consumable: '消耗品', plot: '剧情', material: '材料', equipment: '装备', equip: '装备', tool: '工具' };
const INV_ATTR_LABEL = { str: '力量', con: '体质', dex: '敏捷', per: '感知', wil: '意志', hp: '生命', san: '理智' };
const INV_SLOT_DEFS = [
  { key: 'weapon', label: '武器', icon: '🗡️' },
  { key: 'head', label: '头部', icon: '⛑️' },
  { key: 'body', label: '身体', icon: '🦺' },
  { key: 'hand', label: '手部', icon: '🧤' },
  { key: 'foot', label: '足部', icon: '🥾' },
  { key: 'accessory', label: '配饰', icon: '📿' }
];
// ★ 装备名 → 物品图（装备槽装备后显示对应装备图标）
const EQUIP_ITEM_IDS = { '左轮手枪':'G-023', '猎刀':'G-024', '猎鹿帽':'G-025', '防毒面具':'G-026', '调查员风衣':'G-027', '皮夹克':'G-028', '战术手套':'G-029', '登山靴':'G-030', '黄铜手链':'G-031', '银质吊坠':'G-032' };
// ★ 已装备物品缓存（slot → 物品对象）：装备后背包已移除该物品，凭此缓存渲染装备栏图片/浮窗
// 持久化到 localStorage，刷新后装备格仍能显示装备属性（而非槽位提示）
let _equipCache = {};
try { const _c = JSON.parse(localStorage.getItem('coc_equip_cache') || '{}'); if (_c && typeof _c === 'object') _equipCache = _c; } catch (e) { _equipCache = {}; }
function persistEquipCache() { try { localStorage.setItem('coc_equip_cache', JSON.stringify(_equipCache)); } catch (e) {} }


/** 仓库式格子渲染（★ 委托可复用组件 ItemGrid.renderPositioned）+ 背包内自由拖动 */
function renderGridBoard(board, list, cols, rows) {
  if (!board) return;
  window.ItemGrid.renderPositioned(board, list, {
    cols, rows, cellSize: INV_CELL,
    cardClass: 'grid-item',
    noQbar: true,   // ★ 保持副本背包原视觉（44px 小格不加右上角品质点）
    drag: { mime: 'text/plain', data: (uid) => uid },
    onClick: (it) => itemMenu(it),
    cardPost: (card, it) => attachItemTooltip(card, it)   // ★ 金色浮窗（自动移除原生 title）
  });
  // ★ 背包内自由拖动：目标分区必须与物品类型匹配（种类不符放不进去）；快捷栏物品拖回 → 移除快捷栏槽并刷新背包
  window.ItemGrid.bindDrop(board, {
    mime: 'text/plain',
    onDrop: (raw, e) => {
      // 快捷栏/右栏快捷栏物品拖回 → 移除对应快捷栏槽（物品保留在背包，刷新显示）
      if (raw.startsWith('__remove__')) {
        const uid = raw.slice('__remove__'.length);
        const nxt = mcHotbar.slice();
        while (nxt.length < 8) nxt.push(null);
        const idx = nxt.indexOf(uid);
        if (idx !== -1) {
          nxt[idx] = null; mcHotbar = nxt;
          socket.emit('setHotbar', { items: mcHotbar });
          renderMcHotbar();
          if (window.CluePanel?.refresh) window.CluePanel.refresh();
        }
        return;
      }
      // 背包内自由拖动：目标分区必须与物品类型匹配，否则拒绝（放不进去）
      const invList = (currentCharacter && currentCharacter.inventory) || [];
      const it = invList.find(x => (x.uid || x.id) === raw);
      const boardType = board.dataset.type;
      const partKey = it ? invPartitionOf(it.type) : null;
      if (!it || partKey !== boardType) {
        if (window.showToast) window.showToast(it ? `「${it.itemName || it.name}」只能放入「${INV_TYPE_LABEL[partKey] || partKey}」分区` : '无法放置');
        return;
      }
      const pos = window.ItemGrid.gridPosFromEvent(e, board, cols, rows, INV_CELL);
      socket.emit('moveInInventory', { itemId: raw, x: pos.x, y: pos.y });
    }
  });
}

/** 渲染完整背包：分区格子（与仓库一致）+ 快捷栏 + 装备栏 */
function renderInventory(items) {
  const inv = items || [];
  if (currentCharacter) currentCharacter.inventory = inv;
  for (const [key, id] of Object.entries(INV_PART_IDS)) {
    const board = document.getElementById(id);
    if (!board) continue;
    const p = INV_PARTITIONS[key] || { cols: 5, rows: 5 };
    const list = inv.filter(i => invPartitionOf(i.type) === key);
    renderGridBoard(board, list, p.cols, p.rows);
    const capEl = document.getElementById('cap' + key.charAt(0).toUpperCase() + key.slice(1));
    const used = list.reduce((s, i) => s + (i.size ? i.size.w * i.size.h : 1), 0);
    if (capEl) capEl.textContent = `${used}/${p.cols * p.rows}`;
  }
  const ptsEl = document.getElementById('mcPointsDisp');
  if (ptsEl && currentCharacter) ptsEl.textContent = '🪙 ' + (currentCharacter.mysteryPoint || 0);
  renderMcHotbar();
  renderEquipBar();
}

/** 渲染快捷栏 8 格（图标 + 数字键角标 + 点击使用/装备 + 拖放/拖出） */
function renderMcHotbar() {
  const hot = document.getElementById('mcHotbar');
  if (!hot) return;
  const inv = (currentCharacter && currentCharacter.inventory) || [];
  hot.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const slot = document.createElement('div');
    slot.className = 'mc-hot-slot' + (i === mcHotSelected ? ' selected' : '');
    slot.dataset.idx = i;
    const uid = mcHotbar[i];
    const item = uid ? inv.find(x => (x.uid || x.id) === uid) : null;
    if (item) {
      const name = item.itemName || item.name || '';
      const q = item.quality || 'white';
      const qColor = MC_QUALITY_COLOR[q] || '#c8c8c8';
      const stack = (item.stack && item.stack > 1) ? `<span class="mc-stack">×${item.stack}</span>` : '';
      slot.classList.add('filled', 'q-' + q);
      // ★ 品质外发光（框外冒品质色光）
      slot.style.borderColor = qColor + 'aa';
      slot.style.boxShadow = `0 0 8px ${qColor}66, inset 0 0 5px ${qColor}33`;
      slot.innerHTML = `<span class="mc-icon"><img src="/assets/items/${item.itemId}.png" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="mc-emoji" style="display:none">${mcIconOf(item)}</span></span><span class="mc-hot-key">${i + 1}</span><span class="mc-hot-name">${name}</span>${stack}`;
      slot.title = `${name} · 点击使用/装备`;
      attachItemTooltip(slot, item); // ★ hover 金色浮窗
      slot.addEventListener('click', () => { mcHotSelected = i; renderMcHotbar(); useOrEquip(item); });
      // 拖出移除（拖到快捷栏外空白）
      slot.draggable = true;
      slot.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', '__remove__' + uid); });
    } else {
      slot.innerHTML = `<span class="mc-hot-key">${i + 1}</span>`;
      slot.title = '快捷栏槽位';
    }
    // 拖入
    slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drop-hover'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drop-hover'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drop-hover');
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;
      const nxt = mcHotbar.slice();
      if (raw.startsWith('__remove__')) {
        // ★ 快捷栏内拖动 → 互换位置：把 A 拖到 B 的槽，A 与 B 交换；拖到空槽则移动
        const uid = raw.slice('__remove__'.length);
        const oldIdx = nxt.indexOf(uid);
        if (oldIdx !== -1) {
          const moved = nxt[i] || null;   // 目标槽原物品（B 或空）
          nxt[oldIdx] = moved;            // 原物品移到 A 的原槽
          nxt[i] = uid;                   // A 放入目标槽
        } else {
          nxt[i] = undefined;             // 异常兜底
        }
      } else {
        // 从背包/装备栏拖入：同一物品去重（移动），否则放入目标槽
        const oldIdx = nxt.indexOf(raw);
        if (oldIdx !== -1) nxt[oldIdx] = undefined;
        nxt[i] = raw;
      }
      mcHotbar = nxt;
      window.socket.emit('setHotbar', { items: mcHotbar });
      renderMcHotbar();
    });
    hot.appendChild(slot);
  }
}

// ==================== 物品详情浮窗（黑金风格：品质/类型/功能 + 装备/快捷栏/丢弃） ====================
const QUALITY_LABEL = { white: '普通', green: '优秀', blue: '精良', purple: '史诗', gold: '传说', orange: '橙色', red: '红色', black: '黑色' };
const SLOT_LABEL = { weapon: '武器', head: '头部', body: '身体', hand: '手部', foot: '足部', accessory: '配饰' };

/** 主网格物品操作：点击 → 打开美观浮窗（黑金风格） */
function itemMenu(item) { openItemDetail(item); }

function formatItemEffects(item) {
  const eff = item.effects || [];
  if (!eff.length) return '';
  const parts = eff.map(e => {
    if (e.kind === 'stat') return (INV_ATTR_LABEL[e.stat] || e.stat) + ' +' + e.value;
    return (e.label || e.kind) + (e.value != null ? (e.value > 0 ? ' +' : ' ') + e.value : '');
  });
  return parts.join('；');
}

function openItemDetail(item) {
  const name = item.itemName || item.name || '未知';
  const uid = item.uid || item.id;
  const type = item.type;
  const q = item.quality || 'white';
  const qName = QUALITY_LABEL[q] || q;
  const typeName = INV_TYPE_LABEL[type] || type;
  const icon = item.icon || mcIconOf(item);
  // ★ 仅装备类可装备（工具 tool 不可穿装备，避免误导）
  const isEquip = type === 'equipment' || type === 'equip';
  let modal = document.getElementById('itemDetailModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'itemDetailModal';
    modal.className = 'item-detail-modal';
    modal.addEventListener('click', (e) => { if (e.target === modal) closeItemDetail(); });
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="item-detail-card q-${q}">
      <div class="idc-head">
        <div class="idc-icon"><img src="/assets/items/${item.itemId}.png" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span style="display:none">${icon}</span></div>
        <div class="idc-title">
          <div class="idc-name">${name}</div>
          <div class="idc-badges">
            <span class="idc-quality" style="background:${MC_QUALITY_COLOR[q] || '#c8c8c8'}">${qName}</span>
            <span class="idc-type">${typeName}</span>
          </div>
        </div>
        <button class="idc-close" onclick="closeItemDetail()">✕</button>
      </div>
      <div class="idc-desc">${item.desc || '暂无描述'}</div>
      ${formatItemEffects(item) ? `<div class="idc-effects">✨ ${formatItemEffects(item)}</div>` : ''}
      ${item.slot ? `<div class="idc-slot">装备槽位：${SLOT_LABEL[item.slot] || item.slot}</div>` : ''}
      <div class="idc-actions">
        ${isEquip ? `<button class="idc-btn use" data-act="equip">⚔ 装备</button>` : (type === 'consumable' ? `<button class="idc-btn use" data-act="use">🍖 使用</button>` : '')}
        <button class="idc-btn" data-act="hotbar">⚡ 放入快捷栏</button>
        <button class="idc-btn danger" data-act="drop">🗑 丢弃</button>
        <button class="idc-btn" data-act="close">关闭</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
  modal.querySelectorAll('.idc-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      if (act === 'close') { closeItemDetail(); return; }
      if (act === 'equip') {
        closeItemDetail();
        socket.emit('equipItem', { itemId: item.id || uid, slot: item.slot || (type === 'tool' ? 'hand' : 'accessory') });
        if (window.showToast) showToast(`已尝试装备「${name}」`);
        return;
      }
      if (act === 'use') {
        closeItemDetail();
        const ok = await showConfirm(`使用「${name}」？`, '使用', '取消');
        if (ok) { socket.emit('useItem', { itemId: item.id || uid }); if (window.showToast) showToast(`使用了「${name}」`); }
        return;
      }
      if (act === 'hotbar') {
        closeItemDetail();
        // ★ 规范化为 8 长度找第一个空槽
        const arr = Array.from({ length: 8 }, (_, i) => mcHotbar[i] || null);
        // ★ 同一物品已在快捷栏 → 提示，不重复添加（快捷栏是物品的投影）
        if (arr.includes(uid)) {
          if (window.showToast) window.showToast(`「${name}」已在快捷栏`);
          return;
        }
        const empty = arr.findIndex(x => !x);
        const slot = empty === -1 ? 0 : empty;
        const nxt = mcHotbar.slice();
        while (nxt.length < 8) nxt.push(null);
        nxt[slot] = uid;
        mcHotbar = nxt;
        socket.emit('setHotbar', { items: mcHotbar });
        renderMcHotbar();
        return;
      }
      if (act === 'drop') {
        closeItemDetail();
        const ok = await showConfirm(`确定丢弃「${name}」？`, '丢弃', '取消');
        if (ok) socket.emit('dropItem', { itemId: uid });
        return;
      }
    });
  });
}
function closeItemDetail() {
  const modal = document.getElementById('itemDetailModal');
  if (modal) modal.style.display = 'none';
}

// ==================== 金色花纹悬浮浮窗（hover tooltip：物品全部信息 / 技能信息+战斗伤害估算） ====================
const EFF_KEY_LABEL = {
  holyDmg: '神圣伤害', corrosionDmg: '腐蚀伤害', explosionDmg: '爆炸伤害', burnDmg: '灼烧伤害',
  magDmg: '法术伤害', physDmg: '物理伤害', trueDmg: '真实伤害', damage: '伤害',
  heal: '治疗', healAll: '全体治疗', restoreSan: '理智恢复', sanRestore: '理智恢复',
  armorShred: '护甲削减', armorPen: '护甲穿透', duration: '持续', immobilize: '禁锢',
  stun: '眩晕', root: '定身', bind: '束缚', slow: '减速', fear: '恐惧', silence: '沉默',
  burnGround: '灼烧地面', cureDisease: '清除疫病', explode: '爆炸', shockwave: '冲击波'
};
let _goldTipEl = null;
let _goldTipTimer = null;

function getGoldTipEl() {
  if (_goldTipEl) return _goldTipEl;
  _goldTipEl = document.createElement('div');
  _goldTipEl.id = 'goldTooltip';
  _goldTipEl.className = 'gold-tooltip';
  _goldTipEl.innerHTML = '<i class="gt-corner gt-c-tl"></i><i class="gt-corner gt-c-tr"></i><i class="gt-corner gt-c-bl"></i><i class="gt-corner gt-c-br"></i><div class="gt-body"></div>';
  document.body.appendChild(_goldTipEl);
  return _goldTipEl;
}
function hideGoldTooltip() {
  if (_goldTipTimer) { clearTimeout(_goldTipTimer); _goldTipTimer = null; }
  const el = getGoldTipEl();
  el.classList.remove('show');
}
function positionGoldTooltip(clientX, clientY) {
  const el = getGoldTipEl();
  const pad = 16;
  const r = el.getBoundingClientRect();
  let x = clientX + pad, y = clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = clientY - r.height - pad;
  el.style.left = Math.max(4, x) + 'px';
  el.style.top = Math.max(4, y) + 'px';
}
function showGoldTooltip(html, clientX, clientY) {
  const el = getGoldTipEl();
  el.querySelector('.gt-body').innerHTML = html;
  el.classList.add('show');
  positionGoldTooltip(clientX, clientY);
}
/** 通用悬停绑定：鼠标停留 380ms 显示，跟随移动，离开隐藏（同时去除原生 title 防双浮窗） */
function attachGoldTooltip(el, getHtml) {
  if (!el || el._gtBound) return;
  el._gtBound = true;
  el.addEventListener('mouseenter', (e) => {
    if (_goldTipTimer) clearTimeout(_goldTipTimer);
    const html = getHtml();
    _goldTipTimer = setTimeout(() => { showGoldTooltip(html, e.clientX, e.clientY); }, 380);
  });
  el.addEventListener('mousemove', (e) => {
    if (_goldTipEl && _goldTipEl.classList.contains('show')) positionGoldTooltip(e.clientX, e.clientY);
  });
  el.addEventListener('mouseleave', hideGoldTooltip);
  el.removeAttribute('title');
}
/** 物品 tooltip：展示全部信息 */
function buildItemTooltipHtml(item) {
  if (!item) return '<div class="gt-empty">—</div>';
  const name = item.itemName || item.name || '未知物品';
  const q = item.quality || 'white';
  const qName = QUALITY_LABEL[q] || q;
  const typeName = INV_TYPE_LABEL[item.type] || item.type || '物品';
  const eff = formatItemEffects(item);
  const icon = item.icon || ({ consumable: '🧪', tool: '🪢', material: '🔩', equipment: '⚔️', equip: '⚔️', plot: '📜' }[item.type] || '📦');
  return `
    <div class="gt-head">
      <span class="gt-icon"><img src="/assets/items/${item.itemId}.png" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span style="display:none">${icon}</span></span>
      <div class="gt-title">
        <div class="gt-name" style="color:${MC_QUALITY_COLOR[q] || '#ffe9a8'}">${escapeHtml(name)}</div>
        <div class="gt-badges"><span class="gt-q" style="background:${MC_QUALITY_COLOR[q] || '#c8c8c8'}">${qName}</span><span class="gt-t">${typeName}</span></div>
      </div>
    </div>
    <div class="gt-desc">${escapeHtml(item.desc || '暂无描述')}</div>
    ${eff ? `<div class="gt-eff">✨ ${escapeHtml(eff)}</div>` : ''}
    ${item.slot ? `<div class="gt-slot">装备槽位：${SLOT_LABEL[item.slot] || item.slot}</div>` : ''}
    ${item.stackable && item.maxStack ? `<div class="gt-meta">堆叠上限：${item.maxStack}</div>` : ''}
    ${item.cooldown ? `<div class="gt-meta">冷却：${item.cooldown} 秒</div>` : ''}
  `;
}
function attachItemTooltip(el, item) {
  attachGoldTooltip(el, () => buildItemTooltipHtml(item));
}
/** 技能 tooltip：展示信息 + 战斗模式下计算伤害/治疗估算 */
function buildSkillTooltipHtml(skillData, isPassive, key) {
  if (!skillData) return '<div class="gt-empty">未解锁</div>';
  const name = skillData.name || '未知技能';
  const typeMap = { attack: '攻击', control: '控制', heal: '治疗', buff: '增益', debuff: '减益', defense: '防御', utility: '辅助', passive: '被动' };
  const typeLabel = typeMap[skillData.type] || (isPassive ? '被动' : '主动');
  const cdTurns = Math.max(1, Math.round((parseInt(skillData.cooldown || 10, 10) || 10) / 5));
  const combat = (typeof getCombatStats === 'function') ? getCombatStats() : null;
  const info = buildSkillEffectInfo(skillData, combat, isPassive);
  return `
    <div class="gt-head">
      <span class="gt-icon gt-skill">${skillData.icon || (isPassive ? '♾️' : '✦')}</span>
      <div class="gt-title">
        <div class="gt-name">${escapeHtml(name)}</div>
        <div class="gt-badges"><span class="gt-t gt-skilltype">${typeLabel}</span>${key ? `<span class="gt-key">${key}</span>` : ''}${isPassive ? '<span class="gt-key">被动</span>' : ''}</div>
      </div>
    </div>
    <div class="gt-desc">${escapeHtml(skillData.desc || '暂无描述')}</div>
    <div class="gt-meta">冷却：${cdTurns} 回合${skillData.cooldown ? `（${skillData.cooldown} 秒）` : ''}</div>
    ${info.effects ? `<div class="gt-eff">${info.effects}</div>` : ''}
    ${info.combat ? `<div class="gt-combat">${info.combat}</div>` : ''}
  `;
}
function labelEffKey(k) { return EFF_KEY_LABEL[k] || k; }
/** 解析技能 effect：伤害 / 治疗 / 其他效果（数值与标记） */
function buildSkillEffectInfo(skillData, combat, isPassive) {
  const eff = skillData.effect || {};
  const dmgVals = [], healVals = [], notes = [];
  let totalDmg = 0, totalHeal = 0;
  for (const [k, v] of Object.entries(eff)) {
    const kl = String(k).toLowerCase();
    if (typeof v === 'number') {
      if (kl.includes('dmg') || kl.includes('damage')) { totalDmg += v; dmgVals.push(`${labelEffKey(k)} ${v}`); }
      else if (kl.includes('heal') || kl.includes('restore')) { totalHeal += v; healVals.push(`${labelEffKey(k)} ${v}`); }
      else if (kl === 'armorshred' || kl === 'armorpen') notes.push(`护甲削减 ${Math.round(v * 100)}%`);
      else if (kl === 'duration') notes.push(`持续 ${v} 秒`);
      else if (['immobilize', 'stun', 'root', 'bind', 'slow', 'fear', 'silence'].includes(kl)) notes.push(`控制 ${v} 秒`);
      else if (v !== 0) notes.push(`${labelEffKey(k)} ${v}`);
    } else if (typeof v === 'boolean' && v) {
      notes.push(labelEffKey(k));
    }
  }
  let effects = '';
  if (dmgVals.length) effects += `<div class="gt-line gt-dmg">💥 伤害：${dmgVals.join(' + ')}</div>`;
  if (healVals.length) effects += `<div class="gt-line gt-heal">💚 治疗：${healVals.join(' + ')}</div>`;
  if (notes.length) effects += `<div class="gt-line gt-note">${notes.join(' · ')}</div>`;
  // ★ 战斗模式：结合角色攻击力估算伤害/治疗
  let combatHtml = '';
  if (_lolBattleActive && combat && !isPassive) {
    const role = CAREER_ROLE[(currentCharacter && currentCharacter.career)] || '战士';
    const useMag = role === '法师' || skillData.type === 'heal';
    const atk = useMag ? (combat.magAtk || 0) : (combat.physAtk || 0);
    const rate = 0.35;
    if (totalDmg > 0) {
      const est = Math.round(totalDmg + atk * rate);
      combatHtml += `<div class="gt-cdmg">⚔ 预估伤害 <b>${est}</b><span class="gt-csub">基础 ${totalDmg} + ${useMag ? '法攻' : '物攻'}×${Math.round(rate * 100)}%</span></div>`;
    }
    if (totalHeal > 0) {
      const est = Math.round(totalHeal + atk * rate);
      combatHtml += `<div class="gt-cheal">💚 预估治疗 <b>${est}</b><span class="gt-csub">基础 ${totalHeal} + 法攻×${Math.round(rate * 100)}%</span></div>`;
    }
  }
  return { effects, combat: combatHtml };
}

/** 快捷栏使用/装备：消耗→使用；装备/武器/手持工具→装备对应槽 */
function useOrEquip(item) {
  const type = item.type;
  const name = item.itemName || item.name || '未知';
  if (type === 'consumable') {
    socket.emit('useItem', { itemId: item.id || item.uid });
    if (window.showToast) showToast(`使用了「${name}」`);
  } else if (type === 'equipment' || type === 'equip') {
    socket.emit('equipItem', { itemId: item.id || item.uid, slot: item.slot || 'accessory' });
    if (window.showToast) showToast(`已尝试装备「${name}」`);
  } else {
    if (window.showToast) showToast(`「${name}」为材料/剧情道具，可在探索场景中使用`);
  }
}

// ★ 数字键 1-8 快速使用快捷栏（背包页打开时）
document.addEventListener('keydown', (e) => {
  if (!/^[1-8]$/.test(e.key)) return;
  const pageInv = document.getElementById('pageInventory');
  if (!pageInv || !pageInv.classList.contains('active')) return;
  const idx = +e.key - 1;
  const inv = (currentCharacter && currentCharacter.inventory) || [];
  const uid = mcHotbar[idx];
  const item = uid ? inv.find(x => (x.uid || x.id) === uid) : null;
  if (item) { mcHotSelected = idx; renderMcHotbar(); useOrEquip(item); }
});

/** 装备格配置：6 槽各部位（武器/头部/身体/手部/足部/配饰），拖入装备 / 点击卸下；显示装备物品图片 */
function renderEquipBar() {
  const bar = document.getElementById('equipSlots');
  if (!bar) return;
  const c = currentCharacter;
  const equip = c?.equip || {};
  const inv = (c && c.inventory) || [];
  bar.innerHTML = '';
  INV_SLOT_DEFS.forEach(def => {
    const val = equip[def.key] || '';
    // ★ 已装备物品：优先背包 → _equipCache 缓存 → 最小装备对象（保证 hover 始终显示装备属性而非槽位提示）
    const eqItem = val ? (inv.find(x => (x.itemName || x.name) === val) || _equipCache[def.key] || null) : null;
    const tipItem = eqItem || (val ? { itemName: val, itemId: EQUIP_ITEM_IDS[val], type: 'equipment', quality: 'white', desc: `当前穿戴：${val}`, slot: def.key } : null);
    const itemId = tipItem ? tipItem.itemId : null;
    const icon = (tipItem && tipItem.icon) ? tipItem.icon : def.icon;
    const qColor = tipItem && tipItem.quality ? MC_QUALITY_COLOR[tipItem.quality] : null;
    const slot = document.createElement('div');
    slot.className = 'equip-slot eq6' + (val ? ' filled' : '');
    slot.dataset.slot = def.key;
    slot.title = val ? `${def.label}: ${val}（点击卸下）` : `${def.label} · 拖入装备`;
    // ★ 品质外发光（像快捷栏：框外冒品质色光）
    if (qColor) { slot.style.borderColor = qColor + 'aa'; slot.style.boxShadow = `0 0 9px ${qColor}66, inset 0 0 6px ${qColor}33`; }
    // ★ 装备后显示对应装备物品图片；空槽只显示部位文字（无图标）
    slot.innerHTML = itemId
      ? `<span class="equip-slot-icon"><img src="/assets/items/${itemId}.png" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="equip-slot-fallback" style="display:none">${icon}</span></span><span class="equip-slot-name">${val}</span>`
      : `<span class="equip-slot-name eq-slot-text">${val || def.label}</span>`;
    // ★ hover 金色浮窗：已装备显示装备信息，空槽显示部位提示
    if (tipItem) attachItemTooltip(slot, tipItem);
    else attachGoldTooltip(slot, () => `<div class="gt-head"><span class="gt-icon" style="font-size:22px">${def.icon}</span><div class="gt-title"><div class="gt-name">${def.label}</div><div class="gt-badges"><span class="gt-t">装备槽</span></div></div></div><div class="gt-desc">将对应部位的装备拖入此处即可穿戴</div>`);
    slot.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw || raw.startsWith('__remove__')) return;
      // ★ 缓存已装备物品（背包移除后仍可渲染图片/浮窗）
      const it = inv.find(x => (x.uid || x.id) === raw);
      if (it) { _equipCache[def.key] = it; persistEquipCache(); }
      socket.emit('equipItem', { itemId: raw, slot: def.key });
    });
    if (val) slot.addEventListener('click', () => { delete _equipCache[def.key]; persistEquipCache(); socket.emit('unequipItem', { slot: def.key }); });
    bar.appendChild(slot);
  });
}

