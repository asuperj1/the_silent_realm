/**
 * charDetail.js — 角色详情配置界面（P0，文档四：五大标签页）
 * 标签1 概况 / 标签2 背包仓库 / 标签3 技能 / 标签4 工坊 / 标签5 档案记录
 * 依赖 client.js 顶层词法环境（showPage/pageCharDetail/currentCharacter/socket/_pendingSkillModal 等）。
 */
(function () {
  let _char = null;                 // 当前详情角色
  let _items = { items: [], warehouse: [] };  // 背包/仓库数据
  let _curTab = 'overview';
  let _archiveTab = 'loop';         // ★ 档案记录子功能：loop 轮回记录 / archive 素材档案 / san SAN损耗
  let _skillEmbedInited = false;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const QUALITY_LABEL = { white: '白', green: '绿', blue: '蓝', purple: '紫', gold: '金', orange: '橙', red: '红', black: '黑' };
  const QUALITY_CLASS = { white: 'q-white', green: 'q-green', blue: 'q-blue', purple: 'q-purple', gold: 'q-gold', orange: 'q-orange', red: 'q-red', black: 'q-black' };
  const ATTR_LABEL = { str: '力量', dex: '敏捷', con: '体力', int: '智力', cha: '魅力', lck: '幸运', hp: '生命', san: '理智' };
  const EFF_STAT_LABEL = { str: '力量', dex: '敏捷', con: '体力', int: '智力', cha: '魅力', lck: '幸运', per: '感知', wil: '意志力', hp: '生命', san: '理智' };
  // ★ P1 阶位（与 server/gameLogic 一致）：不增属性，仅解锁权限
  const TIER_NAMES = ['见习', '初阶', '中阶', '高阶', '资深', '大师'];
  const TIER_THRESHOLDS = [0, 1, 3, 6, 10, 15];
  function tierForCopies(count) {
    let t = 0;
    for (let i = 0; i < TIER_THRESHOLDS.length; i++) if ((count || 0) >= TIER_THRESHOLDS[i]) t = i;
    return t;
  }

  const el = (id) => document.getElementById(id);

  // ==================== 对外 API ====================
  window.CharDetail = {
    /** 点击角色卡片：静默选择角色后进入详情页 */
    open(c) {
      if (!c || !c.uid) return;
      _pendingSkillModal = 'detail';
      window.socket.emit('selectCharacter', { characterUid: c.uid });
    },
    /** characterSelected('detail') 回调：进入详情页 */
    onCharacterSelected(c) {
      _char = c;
      _curTab = 'overview';
      _skillEmbedInited = false;
      // 清理嵌入面板（避免残留）
      const te = el('cdSkillTreeEmbed'), ae = el('cdSkillAllocEmbed');
      if (te) te.innerHTML = '';
      if (ae) ae.innerHTML = '';
      if (window.SkillTree?.close) window.SkillTree.close();
      if (window.AttrAllocate?.close) window.AttrAllocate.close();
      showPage(pageCharDetail);
      updateTitle();
      switchTab('overview');
      // 拉取背包/仓库数据
      window.socket.emit('getInventory');
    },
    /** 外部（加点/工坊成功后）刷新当前详情 */
    refreshCurrent() {
      _char = (typeof getCurrentCharacter === 'function' && getCurrentCharacter()) || _char;
      if (!_char) return;
      renderOverview();
      renderWorkshop();
      renderArchive();
      window.socket.emit('getInventory');
    },
    close() {
      // 隐藏嵌入的 skill modal
      if (window.SkillTree?.close) window.SkillTree.close();
      if (window.AttrAllocate?.close) window.AttrAllocate.close();
      showPage(pageCharacters);
    }
  };

  // ==================== Tab 切换 ====================
  const PANE_MAP = { overview: 'cdPaneOverview', inventory: 'cdPaneInventory', tasks: 'cdPaneTasks', skilltree: 'cdPaneSkillTree', attralloc: 'cdPaneAttrAlloc', workshop: 'cdPaneWorkshop', shop: 'cdPaneShop', archive: 'cdPaneArchive' };
  function switchTab(tab) {
    _curTab = tab;
    document.querySelectorAll('.cd-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    Object.entries(PANE_MAP).forEach(([key, id]) => {
      const p = el(id);
      if (p) p.classList.toggle('active', key === tab);
    });
    if (tab === 'overview') renderOverview();
    else if (tab === 'inventory') openInventoryEmbed();
    else if (tab === 'tasks') renderTasks();
    else if (tab === 'skilltree') openSkillTreeEmbed();
    else if (tab === 'attralloc') openAttrAllocEmbed();
    else if (tab === 'workshop') renderWorkshop();
    else if (tab === 'shop') renderShopModule();
    else if (tab === 'archive') renderArchive();
    // 离开任务标签 → 停止监听（避免后台渲染开销）
    if (tab !== 'tasks' && window.QuestBoard) window.QuestBoard.close(el('cdPaneTasks'));
  }

  // ★ 背包仓库：内嵌复用原格子仓库界面（可拖拽配置），回退旧卡片渲染
  function openInventoryEmbed() {
    if (window.Warehouse?.open) window.Warehouse.open('cdInventoryEmbed');
    else renderInventory();
  }

  // ★ 技能树 / 属性分配：占满整个页面直接内嵌（不做浮窗弹层）
  function openSkillTreeEmbed() {
    if (window.SkillTree?.openEmbed) window.SkillTree.openEmbed('cdSkillTreeEmbed');
  }
  function openAttrAllocEmbed() {
    if (window.AttrAllocate?.openEmbed) window.AttrAllocate.openEmbed('cdSkillAllocEmbed');
  }

  function updateTitle() {
    const t = el('cdTitle');
    if (t && _char) t.textContent = `${_char.name} · ${_char.career || ''} · Lv.${_char.level || 1}`;
  }

  // ==================== 标签1 概况 ====================
  function renderOverview() {
    const pane = el('cdPaneOverview');
    if (!pane || !_char) return;
    const a = _char.attr || {};
    const h = _char.hidden || {};
    const engravingLabels = { white: '白色刻痕', orange: '橙刻痕', darkgold: '暗金刻痕' };
    const eLabel = engravingLabels[_char.engravingTier] || '白色刻痕';
    const clearCount = ((_char.copiesHistory || []).length) || (_char.clearedCopies || []).length;
    const permLoss = _char.permanentSanLoss || 0;
    const tier = tierForCopies((_char.clearedCopies || []).length);   // ★ 阶位依据真实通关数
    const avatar = _char.avatar || 'assets/placeholder.png';
    const six = [['str', '💪', '力量'], ['dex', '👟', '敏捷'], ['con', '🛡️', '体力'], ['int', '🧠', '智力'], ['cha', '🎭', '魅力'], ['lck', '🍀', '幸运']]
      .map(([k, ic, lb]) => `<div class="cd-ov-attr"><span class="cd-ov-attr-icon">${ic}</span><span class="cd-ov-attr-name">${lb}</span><b>${a[k] ?? '?'}</b></div>`).join('');
    pane.innerHTML = `
      <div class="cd-ov-top">
        <img class="cd-ov-avatar" src="${esc(avatar)}" onerror="this.src='assets/placeholder.png'">
        <div class="cd-ov-id">
          <div class="cd-ov-name">${esc(_char.name)}</div>
          <div class="cd-ov-meta">${esc(_char.career || '')} · Lv.${_char.level || 1}</div>
          <div class="engraving-badge engraving-${_char.engravingTier || 'white'}"><span class="engraving-diamond">◆</span>${esc(eLabel)}</div>
        </div>
        <div class="cd-ov-res">
          <div class="cd-ov-res-item"><span>阶位</span><b>${TIER_NAMES[tier]}</b></div>
          <div class="cd-ov-res-item"><span>寂静点数</span><b>${_char.mysteryPoint ?? 0}</b></div>
          <div class="cd-ov-res-item"><span>轮回次数</span><b>${clearCount}</b></div>
          <div class="cd-ov-res-item"><span>永久SAN损耗</span><b class="${permLoss > 0 ? 'cd-warn' : ''}">${permLoss}</b></div>
        </div>
      </div>
      <div class="cd-ov-section">
        <div class="cd-pane-title">全属性</div>
        <div class="cd-ov-attrs">${six}</div>
      </div>
      <div class="cd-ov-section">
        <div class="cd-pane-title">精神数值</div>
        <div class="cd-ov-vitals">
          <div class="cd-ov-vital"><span>🧠 SAN 理智</span><b>${a.san ?? 0} / ${a.maxSan ?? 80}</b><div class="cd-bar"><i style="width:${Math.max(0, Math.min(100, ((a.san ?? 0) / (a.maxSan || 80)) * 100))}%"></i></div></div>
          <div class="cd-ov-vital"><span>🌀 意志力</span><b>${h.will ?? a.wil ?? 0}</b></div>
          <div class="cd-ov-vital"><span>🕯 灵魂强度</span><b>${h.soul ?? 0}</b></div>
          <div class="cd-ov-vital"><span>❤️ 生命值</span><b>${a.hp ?? 0} / ${a.maxHp ?? 0}</b><div class="cd-bar hp"><i style="width:${Math.max(0, Math.min(100, ((a.hp ?? 0) / (a.maxHp || 1)) * 100))}%"></i></div></div>
        </div>
      </div>
      <div class="cd-ov-section">
        <div class="cd-pane-title">轮回总览</div>
        <div class="cd-ov-loop">
          <div><span>通关副本</span><b>${clearCount}</b></div>
          <div><span>永久损耗</span><b class="${permLoss > 0 ? 'cd-warn' : ''}">${permLoss}</b></div>
        </div>
      </div>`;
  }

  // ==================== 标签2 背包仓库 ====================
  function renderInventory() {
    const pane = el('cdPaneInventory');
    if (!pane) return;
    const all = [...(_items.items || []), ...(_items.warehouse || [])];
    if (!all.length) {
      pane.innerHTML = '<div class="cd-empty">背包与仓库为空，副本中获得的装备与资源将永久保留</div>';
      return;
    }
    // ★ 复用可复用组件 EquipMaterialGrid：格子式 + 物品可拖动（正常由 Warehouse 组件接管，此为兜底路径）
    pane.innerHTML = '<div class="cd-inv-grid" id="cdInvGrid"></div>';
    const grid = el('cdInvGrid');
    const perRow = Math.max(6, Math.floor((grid.clientWidth || pane.clientWidth || 1200) / 150));
    window.EquipMaterialGrid.render(grid, {
      items: all, mode: 'all', cardClass: 'grid-item', cellSize: 150,
      perRow, rows: Math.max(2, Math.ceil(all.length / perRow)),
      drag: { mime: 'application/x-inv', data: (uid) => uid },
      showWorn: false
    });
  }

  // ==================== 标签3/4 技能树 / 属性分配（占满内嵌） ====================

  // ==================== 标签5 工坊（子分栏：锻造 / 吞噬 / 商店 / 寄售 / 拍卖；黑色成长已移除） ====================

  // ---------- 商店面板（🏪 · 类比副本商店 LOL 界面：分类 tab + 左网格 + 右详情） ----------
  let _shopCache = null;   // { items, points, tier }
  let _shopCat = 'all';    // 商店分类（全部/装备/消耗品/材料/工具/剧情/强化）
  let _shopSel = null;     // 选中的商品名
  const SHOP_CATS = [['all', '全部'], ['equipment', '⚔️ 装备'], ['consumable', '🧪 消耗品'], ['material', '🔩 材料'], ['tool', '🪢 工具'], ['plot', '📜 剧情'], ['perm', '✨ 强化']];
  // 商品阶位门槛（与服务端 getTier 一致：蓝=1 紫=2 金=3 橙=4 红=5）
  function shopNeedTier(item) {
    const TIER_BY_Q = { blue: 1, purple: 2, gold: 3, orange: 4, red: 5 };
    return item && (item.tier || TIER_BY_Q[item.quality] || 0);
  }
  function renderShopPanel() {
    if (!_shopCache) {
      if (window.socket) window.socket.emit('getShopItems');
      return `<div class="cd-empty">🏪 商店加载中…</div>`;
    }
    const pts = _shopCache.points ?? 0;
    const tier = _shopCache.tier ?? 0;
    return `<div class="cd-ws-shop cd-shop-lol">
      <div class="cd-ws-head2"><span>🏪 商店</span><span class="ws-shop-pts">🪙 ${pts} · 阶位 ${TIER_NAMES[tier] || '见习'}</span></div>
      <div class="shop-page-body">
        <div class="shop-cats" id="cdShopCats">
          ${SHOP_CATS.map(([k, l]) => `<button class="shop-cat ${_shopCat === k ? 'active' : ''}" data-cat="${k}">${l}</button>`).join('')}
        </div>
        <div class="shop-page-main">
          <div class="shop-grid" id="cdShopGrid"></div>
          <div class="shop-detail" id="cdShopDetail"><div class="shop-detail-empty">👆 点击左侧物品查看详情</div></div>
        </div>
      </div>
    </div>`;
  }
  // ★ 渲染左网格（商品卡片：品质条/图标/名称/费用/类型/阶位锁）
  function renderShopLolGrid() {
    const grid = el('cdShopGrid');
    if (!grid) return;
    const items = (_shopCache && _shopCache.items) || {};
    const tier = (_shopCache && _shopCache.tier) || 0;
    const qColor = { white: '#c8c8c8', green: '#4cc9f0', blue: '#4d7cff', purple: '#9b5cff', gold: '#ffd700', orange: '#ff8c42', red: '#ff4d4d', black: '#9aa0a6' };
    const names = Object.keys(items).filter(name => _shopCat === 'all' || (items[name].type || '') === _shopCat);
    grid.innerHTML = '';
    if (!names.length) { grid.innerHTML = '<div class="empty-inventory">该分类暂无物品</div>'; return; }
    for (const name of names) {
      const item = items[name];
      const card = document.createElement('div');
      card.className = 'shop-item-card' + (_shopSel === name ? ' selected' : '');
      card.dataset.name = name;
      const icon = item.icon || ({ equip: '⚔️', equipment: '⚔️', consumable: '🧪', tool: '🪢', material: '🔩', plot: '📜' }[item.type] || '💪');
      const typeLabel = { perm: '强化', consumable: '消耗品', equip: '装备', equipment: '装备', tool: '工具', material: '材料', plot: '剧情' }[item.type] || '物品';
      const iconHtml = item.itemId
        ? `<span class="shop-item-icon"><img src="/assets/items/${esc(item.itemId)}.png" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="shop-item-emoji" style="display:none">${esc(icon)}</span></span>`
        : `<span class="shop-item-icon">${esc(icon)}</span>`;
      const needTier = shopNeedTier(item);
      const locked = needTier > 0 && tier < needTier;
      card.innerHTML = `<span class="shop-quality" style="background:${qColor[item.quality] || '#c8c8c8'}"></span>
        ${iconHtml}
        <strong class="shop-item-name">${esc(name)}${locked ? ' <span class="shop-lock">🔒</span>' : ''}</strong>
        ${needTier > 0 ? `<span class="shop-tier-req">需「${TIER_NAMES[needTier]}」阶</span>` : ''}
        <span class="shop-item-cost">${item.cost} 🪙</span>
        <span class="shop-item-type">${typeLabel}${item.quality ? ' · ' + (QUALITY_LABEL[item.quality] || '') : ''}</span>`;
      if (locked) card.classList.add('locked');
      card.addEventListener('click', () => { _shopSel = name; renderShopLolGrid(); renderShopLolDetail(name, item); });
      grid.appendChild(card);
    }
  }
  // ★ 渲染右详情（名称/描述/效果/价格/阶位/购买）
  function renderShopLolDetail(name, item) {
    const detail = el('cdShopDetail');
    if (!detail) return;
    const tier = (_shopCache && _shopCache.tier) || 0;
    const effHint = item.itemId
      ? ({ equipment: '装备物品 · 进入背包后装备到对应部位', consumable: '消耗品 · 进入背包后使用生效', tool: '工具 · 进入背包后可在探索中使用', material: '材料 · 用于制作与修复' }[item.type] || '物品 · 进入背包后使用')
      : '';
    const effText = (item.effect && Object.keys(item.effect).length)
      ? `<div class="shop-detail-effect">效果：${esc(JSON.stringify(item.effect))}</div>`
      : (effHint ? `<div class="shop-detail-effect">${effHint}</div>` : '');
    const needTier = shopNeedTier(item);
    detail.innerHTML = `<h3 class="shop-detail-name">${esc(name)}</h3>
      <p class="shop-detail-desc">${esc(item.desc || '')}</p>
      ${effText}
      <div class="shop-detail-price">${item.cost} 🪙</div>
      ${needTier > 0 ? `<div class="shop-detail-tier">🔒 需「${TIER_NAMES[needTier]}」阶位（当前「${TIER_NAMES[tier]}」）</div>` : ''}
      <button class="shop-buy-btn" data-name="${esc(name)}">购买</button>`;
  }
  // ★ 绑定商店 LOL 界面：分类 tab + 网格 + 详情 + 购买
  function bindShopLol() {
    document.querySelectorAll('#cdShopCats .shop-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#cdShopCats .shop-cat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _shopCat = btn.dataset.cat;
        _shopSel = null;
        renderShopLolGrid();
        const detail = el('cdShopDetail');
        if (detail) detail.innerHTML = '<div class="shop-detail-empty">👆 点击左侧物品查看详情</div>';
      });
    });
    renderShopLolGrid();
    document.querySelectorAll('#cdShopDetail .shop-buy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        const item = (_shopCache && _shopCache.items && _shopCache.items[name]) || null;
        const tier = (_shopCache && _shopCache.tier) || 0;
        if (item && shopNeedTier(item) > 0 && tier < shopNeedTier(item)) {
          shopResult(`✖ 需「${TIER_NAMES[shopNeedTier(item)]}」阶位解锁（当前「${TIER_NAMES[tier]}」）`, false);
          return;
        }
        const ok = window.showConfirm ? await showConfirm(`确定购买「${name}」？\n价格：${item ? item.cost : '?'} 🪙`) : true;
        if (ok) window.socket.emit('buyItem', { itemId: name });
      });
    });
  }

  // ---------- 寄售面板（� 玩家间固定报价） ----------
  let _consignCache = null;  // { listings: [] }
  let _consignSel = null;    // 挂售选择的物品 uid
  let _consignPrice = 100;   // 固定价
  let _consignTab = 'create'; // ★ 寄售子功能 tab：create(挂售) / market(寄售市场) / mine(我的寄售)
  function renderConsignMarket() {
    if (!_consignCache) {
      if (window.socket) window.socket.emit('consign.listings');
      return `<div class="cd-empty">📦 寄售市场加载中…</div>`;
    }
    const mine = (_consignCache.listings || []).filter(c => c.mine);
    const others = (_consignCache.listings || []).filter(c => !c.mine);
    // ★ 寄售市场卡片：复用 ItemGrid.itemCard（图片/品质/强化/耐久/tooltip 组件化）+ 注入卖家/操作 footer
    const card = (c) => {
      const base = window.ItemGrid.itemCard(c, { cardClass: 'market-eq', draggable: false });
      const footer = `<div class="ws-sell-meta">卖家：${esc(c.sellerName)} · 固定价 <b>${c.price} 🪙</b></div>
        <div class="ws-sell-actions">
          ${c.mine
            ? `<button class="ws-consign-cancel" data-id="${esc(c.id)}">↩ 撤回</button>`
            : `<button class="ws-consign-buy" data-id="${esc(c.id)}">💰 购买</button>`}
        </div>`;
      return marketCard(base, footer);
    };
    const marketHtml = `<div class="cd-pane-title">寄售市场（${others.length}）</div>
      <div class="ws-sell-grid">${others.map(card).join('') || '<div class="cd-empty">暂无寄售物品</div>'}</div>`;
    const mineHtml = `<div class="cd-pane-title">我的寄售（${mine.length}）</div>
      <div class="ws-sell-grid">${mine.map(card).join('') || '<div class="cd-empty">暂无挂售</div>'}</div>`;
    return `<div class="cd-ws-consign">
      <div class="cd-ws-head2"><span>📦 寄售（固定报价 · 玩家间交易）</span><span class="ws-shop-pts">🪙 ${_char ? (_char.mysteryPoint ?? 0) : 0}</span></div>
      <div class="auc-tabs">
        <button class="auc-tab ${_consignTab === 'create' ? 'active' : ''}" data-consigntab="create">📦 挂售</button>
        <button class="auc-tab ${_consignTab === 'market' ? 'active' : ''}" data-consigntab="market">🛒 寄售市场（${others.length}）</button>
        <button class="auc-tab ${_consignTab === 'mine' ? 'active' : ''}" data-consigntab="mine">🏷 我的寄售（${mine.length}）</button>
      </div>
      <div class="auc-panel" data-consignpanel="create" ${_consignTab === 'create' ? '' : 'style="display:none"'}>
        ${renderConsignCreate()}
      </div>
      <div class="auc-panel" data-consignpanel="market" ${_consignTab === 'market' ? '' : 'style="display:none"'}>
        ${marketHtml}
      </div>
      <div class="auc-panel" data-consignpanel="mine" ${_consignTab === 'mine' ? '' : 'style="display:none"'}>
        ${mineHtml}
      </div>
    </div>`;
  }

  // ★ 寄售挂售子页：复用拍卖"挂单"完整格子系统（统一通用格），显示所有非剧情可交易物品（不分品质）
  function renderConsignCreate() {
    const all = marketPool();
    return `<div class="consign-create">
      <div class="ws-mk-create">
        <span class="auc-sel-label">已选：<b id="cdConsignSelName">未选择</b> · 可挂售 <b>${all.length}</b> 件 · 非剧情</span>
        <input type="number" id="cdConsignPrice" class="ws-mk-num" placeholder="固定价" min="1" value="${_consignPrice}">
        <button class="ws-consign-create btn-primary">📦 挂售</button>
      </div>
      <div class="auc-unified" id="consignUnified"></div>
    </div>`;
  }
  // ★ 点击完整格子中的物品 → 选中/取消挂售（复用拍卖 selectForAuction 逻辑，作用于寄售格子）
  function selectForConsign(it, card) {
    const uid = it.uid || it.id;
    if (_consignSel === uid) { _consignSel = null; card.classList.remove('selected'); }
    else {
      document.querySelectorAll('.consign-create .grid-item.selected').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected'); _consignSel = uid;
    }
    updateConsignSelLabel();
  }
  function updateConsignSelLabel() {
    const nameEl = el('cdConsignSelName');
    if (!nameEl) return;
    const it = _consignSel ? marketPool().find(i => String(i.uid || i.id) === String(_consignSel)) : null;
    nameEl.textContent = it ? `${it.itemName || it.name}（${QUALITY_LABEL[it.quality] || it.quality}${it.enhanceLevel ? '+' + it.enhanceLevel : ''}）` : '未选择';
  }
  // ★ 绑定挂售完整格子（复用拍卖 renderUnifiedBoard：整屏显示 · 无滚动条 · 物品流式填入）
  function bindConsignCreate() {
    const board = el('consignUnified');
    if (!board) return;
    const all = marketPool();
    renderUnifiedBoard(board, all, {
      baseTotal: 291,
      rowsDelta: -3,
      dragMime: 'application/x-market-sel',
      onSelect: selectForConsign,
      afterFill: updateConsignSelLabel,
    });
  }
  // ★ 寄售子功能面板绑定：挂售（复用拍卖完整格子）/ 寄售市场 / 我的寄售
  function bindConsignPane(pane) {
    pane.querySelectorAll('.auc-tab[data-consigntab]').forEach(tab => {
      tab.addEventListener('click', () => {
        _consignTab = tab.dataset.consigntab;
        const body = pane.querySelector('[data-mkbody="consign"]');
        if (body) { body.innerHTML = renderConsignMarket(); bindConsignPane(pane); }
      });
    });
    bindConsignCreate();
    const consignPrice = el('cdConsignPrice');
    if (consignPrice) consignPrice.addEventListener('change', () => { _consignPrice = Math.max(1, Number(consignPrice.value) || 1); });
    pane.querySelectorAll('.ws-consign-create').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_consignSel) { shopResult('请先选择要寄售的物品', false); return; }
        window.socket.emit('consign.create', { uid: _consignSel, price: _consignPrice });
      });
    });
    pane.querySelectorAll('.ws-consign-buy').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = window.showConfirm ? await showConfirm('确定购买该寄售物品？') : true;
        if (ok) window.socket.emit('consign.buy', { id: btn.dataset.id });
      });
    });
    pane.querySelectorAll('.ws-consign-cancel').forEach(btn => {
      btn.addEventListener('click', () => window.socket.emit('consign.cancel', { id: btn.dataset.id }));
    });
  }

  // ---------- 拍卖面板（🔨 现实 24 小时 · 起拍价 + 最低加价） ----------
  let _auctionCache = null;  // { listings: [] }
  let _aucSel = null;        // 挂拍选择的物品 uid
  let _aucStartPrice = 100;  // 起拍价
  let _aucMinBid = 10;       // 最低加价
  let _aucTab = 'create';    // ★ 拍卖子功能 tab：create(发起拍卖) / onsale(在售) / mine(我的挂牌)
  // 背包分区（与服务端 INV_PARTITIONS / warehouse.js 一致）
  const AUC_PARTITIONS = { consumable: { cols: 5, rows: 5 }, plot: { cols: 15, rows: 4 }, material: { cols: 10, rows: 4 }, equipment: { cols: 12, rows: 1 }, tool: { cols: 6, rows: 4 } };
  // 前端镜像服务端 tradable：剧情/线索/绑定黑装不可拍卖；仅紫色及以上品质可拍卖
  function isTradable(it) {
    if (it.type === 'plot') return { ok: false, msg: '剧情物品不可拍卖' };
    if (it.itemId && String(it.itemId).startsWith('CLUE')) return { ok: false, msg: '线索不可拍卖' };
    if (it.bind || it.quality === 'black') return { ok: false, msg: '绑定物品不可拍卖' };
    if (!['purple', 'gold', 'orange', 'red'].includes(it.quality)) return { ok: false, msg: '仅紫色及以上品质可拍卖' };
    return { ok: true };
  }
  // ★ 仓库 15 列铺满左半内容区 → 格宽（背包分区同尺寸）
  function auctionCell() {
    const body = document.querySelector('.cd-body');
    const w = body ? body.clientWidth : 900;
    const half = Math.max(320, Math.floor(w / 2) - 30);
    return Math.max(20, Math.floor((half - 10) / 15));
  }
  // ★ 点击完整格子中的物品 → 选中/取消挂拍（不可交易物品提示）
  function selectForAuction(it, card) {
    const uid = it.uid || it.id;
    const trad = isTradable(it);
    if (!trad.ok) { if (window.showToast) window.showToast(trad.msg); return; }
    if (_aucSel === uid) { _aucSel = null; card.classList.remove('selected'); }
    else {
      document.querySelectorAll('.auc-create .grid-item.selected').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected'); _aucSel = uid;
    }
    updateAucSelLabel();
  }
  function updateAucSelLabel() {
    const nameEl = el('cdAucSelName');
    if (!nameEl) return;
    const it = _aucSel ? aucPool().find(i => String(i.uid || i.id) === String(_aucSel)) : null;
    nameEl.textContent = it ? `${it.itemName || it.name}（${QUALITY_LABEL[it.quality] || it.quality}${it.enhanceLevel ? '+' + it.enhanceLevel : ''}）` : '未选择';
  }
  // 背包+仓库全部物品（供已选标签显示）
  function aucPool() {
    const ch = _char || (typeof getCurrentCharacter === 'function' ? getCurrentCharacter() : null);
    const inv = (_items.items && _items.items.length) ? _items.items : ((ch && ch.inventory) || []);
    const wh = (_items.warehouse && _items.warehouse.length) ? _items.warehouse : ((ch && ch.warehouse) || []);
    return [...inv, ...wh];
  }
  // ★ 可拍卖物品池：仅紫色及以上品质、非剧情、非线索、非绑定（与 isTradable 一致）——拍卖格子只显示这些
  function aucTradablePool() {
    return aucPool().filter(i =>
      ['purple', 'gold', 'orange', 'red'].includes(i.quality) &&
      i.type !== 'plot' &&
      !(i.itemId && String(i.itemId).startsWith('CLUE')) &&
      !(i.bind || i.quality === 'black'));
  }
  // ★ 发起拍卖：统一通用格子（只显示可拍卖紫+非剧情物品），整屏显示、无滚动条，物品流式填入 + 空槽补齐
  function renderAuctionCreate() {
    const all = aucTradablePool();
    return `<div class="auc-create">
      <div class="ws-mk-create">
        <span class="auc-sel-label">已选：<b id="cdAucSelName">未选择</b> · 可拍卖紫+ <b>${all.length}</b> 件 · 非剧情</span>
        <input type="number" id="cdAucStart" class="ws-mk-num" placeholder="起拍价" min="1" value="${_aucStartPrice}">
        <input type="number" id="cdAucMin" class="ws-mk-num" placeholder="最低加价" min="1" value="${_aucMinBid}">
        <button class="ws-auc-create btn-primary">🔨 挂拍（24h）</button>
      </div>
      <div class="auc-unified" id="aucUnified"></div>
    </div>`;
  }
  // ★ 通用"挂单"格子系统（拍卖/寄售挂售共用）：统一通用格 · 整屏显示无滚动条 · 物品流式填入 + 空槽补齐 · 点击选中 · 可拖动
  // opts: { baseTotal, rowsDelta, dragMime, onSelect(it, card), afterFill() }
  function renderUnifiedBoard(board, all, opts) {
    const baseTotal = opts.baseTotal || 291;   // 基准格数（341 - 50）
    const rowsDelta = opts.rowsDelta || -3;    // 默认删三行
    const body = document.querySelector('.cd-body');
    const availH = Math.max(400, (body ? body.clientHeight : 919) - 170);   // 内容区高 - 表单/标题/tab 占用
    const W = Math.max(600, board.clientWidth || (body ? body.clientWidth : 900));
    // 最大化格子：cols*cell ≤ W 且 ceil(基准/cols)*cell ≤ availH
    let best = { cols: 20, cell: 30, rows: 18 };
    for (let cols = 12; cols <= 48; cols++) {
      const rows = Math.ceil(baseTotal / cols);
      const cell = Math.min(Math.floor((W - 4) / cols), Math.floor((availH - 4) / rows));
      if (cell >= 22 && cell > best.cell) best = { cols, cell, rows };
    }
    // ★ 删掉三行：行数 + rowsDelta，总格数 = 列数 × 新行数
    const rows = Math.max(4, best.rows + rowsDelta);
    const TOTAL = best.cols * rows;
    board.style.gridTemplateColumns = `repeat(${best.cols}, ${best.cell}px)`;
    board.style.gridTemplateRows = `repeat(${rows}, ${best.cell}px)`;
    let html = '';
    for (let i = 0; i < TOTAL; i++) html += '<div class="gcell"></div>';
    board.innerHTML = html;
    // 物品流式填入通用格（前 N 格覆盖 gcell）
    all.forEach((it, i) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = window.ItemGrid.itemCard(it, { cardClass: 'grid-item', noQbar: true });
      const card = wrap.firstElementChild;
      card.style.gridColumn = String((i % best.cols) + 1);
      card.style.gridRow = String(Math.floor(i / best.cols) + 1);
      card.style.width = best.cell + 'px';
      card.style.height = best.cell + 'px';
      card.style.margin = '0';
      card.dataset.uid = it.uid || it.id;
      card.addEventListener('click', (e) => { e.stopPropagation(); opts.onSelect(it, card); });
      window.ItemGrid.bindDrag(card, { drag: { mime: opts.dragMime, data: (uid) => uid } });
      board.appendChild(card);
    });
    if (opts.afterFill) opts.afterFill();
  }
  // ★ 绑定发起拍卖通用格子：复用 renderUnifiedBoard（整屏显示 · 无滚动条 · 只显示可拍卖紫+非剧情）
  function bindAuctionCreate() {
    const board = el('aucUnified');
    if (!board) return;
    const all = aucTradablePool();
    renderUnifiedBoard(board, all, {
      baseTotal: 291,
      rowsDelta: -3,
      dragMime: 'application/x-market-sel',
      onSelect: selectForAuction,
      afterFill: updateAucSelLabel,
    });
  }
  function fmtRemain(ms) {
    if (!isFinite(ms) || ms <= 0) return '已到期';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}天${h}时` : h > 0 ? `${h}时${m}分` : `${m}分${s % 60}秒`;
  }
  function renderAuctionMarket() {
    if (!_auctionCache) {
      if (window.socket) window.socket.emit('auction.listings');
      return `<div class="cd-empty">🔨 拍卖行加载中…</div>`;
    }
    const mine = (_auctionCache.listings || []).filter(l => l.mine);
    const others = (_auctionCache.listings || []).filter(l => !l.mine);
    const card = (l) => {
      const remain = l.expiresAt ? fmtRemain(l.expiresAt - Date.now()) : '';
      const minNext = l.bidder ? (l.currentBid + l.minBidIncrement) : l.startPrice;
      // ★ 拍卖市场卡片：复用 ItemGrid.itemCard（图片/品质/强化/耐久/tooltip 组件化）+ 注入竞价/操作 footer
      const base = window.ItemGrid.itemCard(l, { cardClass: 'market-eq', draggable: false });
      const footer = `<div class="ws-auc-bidrow">
          <span class="ws-auc-cur">当前 <b>${l.bidder ? l.currentBid + ' 🪙（' + esc(l.bidderName) + '）' : l.startPrice + ' 🪙 起拍'}</b></span>
          <span class="ws-auc-remain">⏳ ${remain || '已到期'}</span>
        </div>
        <div class="ws-auc-bidrow">
          ${l.mine
            ? (l.bidder
                ? `<span class="ws-auc-mine">⏳ 等待到期结算：最高 ${l.currentBid} 🪙</span>`
                : `<button class="ws-auc-cancel" data-id="${esc(l.id)}">↩ 撤回</button>`)
            : `<input type="number" class="ws-auc-input" placeholder="出价≥${minNext}" min="${minNext}">
                <button class="ws-auc-bid" data-id="${esc(l.id)}">出价</button>`}
        </div>`;
      return marketCard(base, footer);
    };
    const onsale = `<div class="cd-pane-title">在售（${others.length}）</div>
      <div class="ws-auc-grid">${others.map(card).join('') || '<div class="cd-empty">暂无在售拍卖</div>'}</div>`;
    const mineHtml = `<div class="cd-pane-title">我的挂牌（${mine.length}）</div>
      <div class="ws-auc-grid">${mine.map(card).join('') || '<div class="cd-empty">暂无挂牌</div>'}</div>`;
    return `<div class="cd-ws-auction">
      <div class="cd-ws-head2"><span>🔨 拍卖行（现实 24 小时 · 最高价者得）</span><span class="ws-shop-pts">🪙 ${_char ? (_char.mysteryPoint ?? 0) : 0}</span></div>
      <div class="auc-tabs">
        <button class="auc-tab ${_aucTab === 'create' ? 'active' : ''}" data-auctab="create">📦 发起拍卖</button>
        <button class="auc-tab ${_aucTab === 'onsale' ? 'active' : ''}" data-auctab="onsale">🔨 在售（${others.length}）</button>
        <button class="auc-tab ${_aucTab === 'mine' ? 'active' : ''}" data-auctab="mine">🏷 我的挂牌（${mine.length}）</button>
      </div>
      <div class="auc-panel" data-aucpanel="create" ${_aucTab === 'create' ? '' : 'style="display:none"'}>
        ${renderAuctionCreate()}
      </div>
      <div class="auc-panel" data-aucpanel="onsale" ${_aucTab === 'onsale' ? '' : 'style="display:none"'}>
        ${onsale}
      </div>
      <div class="auc-panel" data-aucpanel="mine" ${_aucTab === 'mine' ? '' : 'style="display:none"'}>
        ${mineHtml}
      </div>
    </div>`;
  }

  // ==================== 标签·商店模块（子分栏：商店 / 拍卖 / 寄售） ====================
  let _shopTab = 'shop';     // 商店子分栏
  // ★ 可交易物品池（背包+仓库，排除剧情/线索/绑定黑装）——寄售/拍卖挂售共用
  function marketPool() {
    return [...(_items.items || []), ...(_items.warehouse || [])]
      .filter(i => i.type !== 'plot' && !(i.itemId && String(i.itemId).startsWith('CLUE')) && !(i.bind || i.quality === 'black'));
  }

  // ★ 市场卡片：在 ItemGrid.itemCard 生成的 market-eq 卡片末尾注入 footer（卖家/价格/操作按钮）
  function marketCard(baseHtml, footerHtml) {
    const wrap = document.createElement('div');
    wrap.innerHTML = baseHtml;
    const card = wrap.firstElementChild;
    card.insertAdjacentHTML('beforeend', footerHtml);
    return card.outerHTML;
  }

  // ★ 挂售/挂拍选择器：物品格子（复用 ItemGrid.renderFlow）+ 点击选中 + 可拖动 + 接收背包/仓库拖入
  function bindMarketPool(id, getSel, setSel) {
    const board = el(id);
    if (!board) return;
    const pool = marketPool();
    const labelId = id === 'cdConsignSel' ? 'cdConsignSelName' : 'cdAucSelName';
    const refreshLabel = () => {
      const nameEl = el(labelId);
      if (!nameEl) return;
      const uid = getSel();
      const it = uid ? pool.find(i => String(i.uid || i.id) === String(uid)) : null;
      nameEl.textContent = it ? `${it.itemName || it.name}（${QUALITY_LABEL[it.quality] || it.quality}${it.enhanceLevel ? '+' + it.enhanceLevel : ''}）` : '未选择';
    };
    if (!pool.length) {
      board.innerHTML = '<div class="ws-mk-pool-empty">背包/仓库无可交易物品</div>';
      refreshLabel();
      return;
    }
    window.ItemGrid.renderFlow(board, pool, {
      cardClass: 'ws-mk-eq',
      cellSize: 56,
      rows: 1,
      perRow: 8,
      drag: { mime: 'application/x-market-sel', data: (uid) => uid },
      onClick: (it, card) => {
        const uid = it.uid || it.id;
        if (getSel() === uid) { setSel(null); card.classList.remove('selected'); }
        else {
          board.querySelectorAll('.ws-mk-eq.selected').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected'); setSel(uid);
        }
        refreshLabel();
      }
    });
    // ★ 接收仓库/背包（application/x-wh，JSON{uid,from,slot}）拖入选中
    window.ItemGrid.bindDrop(board, {
      mime: 'application/x-wh',
      onDrop: (raw) => {
        let uid = raw;
        try { const d = JSON.parse(raw); uid = (d && (d.uid || d.itemId)) || raw; } catch (e) { /* raw 即 uid */ }
        const it = pool.find(i => String(i.uid || i.id) === String(uid));
        if (!it) { if (window.showToast) window.showToast('该物品不可交易'); return; }
        board.querySelectorAll('.ws-mk-eq.selected').forEach(c => c.classList.remove('selected'));
        board.querySelectorAll('.ws-mk-eq').forEach(c => { if (String(c.dataset.uid) === String(uid)) c.classList.add('selected'); });
        setSel(uid); refreshLabel();
      }
    });
  }

  // ★ 拍卖子功能面板绑定：发起拍卖（完整格子）/ 在售 / 我的挂牌
  function bindAuctionPane(pane) {
    // 子功能 tab 切换（重渲染当前拍卖 body 后重新绑定；仅绑定拍卖 tab，避免与寄售子 tab 冲突）
    pane.querySelectorAll('.auc-tab[data-auctab]').forEach(tab => {
      tab.addEventListener('click', () => {
        _aucTab = tab.dataset.auctab;
        const body = pane.querySelector('[data-mkbody="auction"]');
        if (body) { body.innerHTML = renderAuctionMarket(); bindAuctionPane(pane); }
      });
    });
    // 发起拍卖：完整格子选择 + 起拍价 + 最低加价 + 挂拍
    bindAuctionCreate();
    const aucStart = el('cdAucStart');
    if (aucStart) aucStart.addEventListener('change', () => { _aucStartPrice = Math.max(1, Number(aucStart.value) || 1); });
    const aucMin = el('cdAucMin');
    if (aucMin) aucMin.addEventListener('change', () => { _aucMinBid = Math.max(1, Number(aucMin.value) || 1); });
    pane.querySelectorAll('.ws-auc-create').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_aucSel) { shopResult('请先选择要拍卖的物品', false); return; }
        window.socket.emit('auction.create', { uid: _aucSel, startPrice: _aucStartPrice, minBid: _aucMinBid });
      });
    });
    // 出价 / 撤回
    pane.querySelectorAll('.ws-auc-bid').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.market-eq');
        const input = card ? card.querySelector('.ws-auc-input') : null;
        const amount = input ? Number(input.value) : 0;
        window.socket.emit('auction.bid', { id: btn.dataset.id, amount });
      });
    });
    pane.querySelectorAll('.ws-auc-cancel').forEach(btn => {
      btn.addEventListener('click', () => window.socket.emit('auction.cancel', { id: btn.dataset.id }));
    });
  }

  function shopResult(msg, ok) {
    const r = el('cdShopResult');
    if (r) r.innerHTML = `<div class="${ok ? 'cd-ws-ok' : 'cd-ws-err'}">${esc(msg)}</div>`;
  }
  function renderShopModule() {
    const pane = el('cdPaneShop');
    if (!pane) return;
    const pts = _char ? (_char.mysteryPoint ?? 0) : 0;
    pane.innerHTML = `
      <div class="cd-ws-head">
        <span class="cd-ws-pts">🪙 寂静点数：<b>${pts}</b></span>
      </div>
      <div class="cd-ws-tabs">
        <button class="cd-ws-tab ${_shopTab === 'shop' ? 'active' : ''}" data-mktab="shop">🏪 商店</button>
        <button class="cd-ws-tab ${_shopTab === 'auction' ? 'active' : ''}" data-mktab="auction">🔨 拍卖</button>
        <button class="cd-ws-tab ${_shopTab === 'consign' ? 'active' : ''}" data-mktab="consign">📦 寄售</button>
      </div>
      <div class="cd-ws-pane" data-mkbody="shop" ${_shopTab === 'shop' ? '' : 'style="display:none"'}>
        ${renderShopPanel()}
      </div>
      <div class="cd-ws-pane" data-mkbody="auction" ${_shopTab === 'auction' ? '' : 'style="display:none"'}>
        ${renderAuctionMarket()}
      </div>
      <div class="cd-ws-pane" data-mkbody="consign" ${_shopTab === 'consign' ? '' : 'style="display:none"'}>
        ${renderConsignMarket()}
      </div>
      <div id="cdShopResult" class="cd-ws-result"></div>
    `;
    // 子分栏切换
    pane.querySelectorAll('.cd-ws-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _shopTab = tab.dataset.mktab;
        pane.querySelectorAll('.cd-ws-tab').forEach(t => t.classList.toggle('active', t === tab));
        pane.querySelectorAll('.cd-ws-pane').forEach(p => { p.style.display = p.dataset.mkbody === _shopTab ? '' : 'none'; });
      });
    });
    // 商店：LOL 风格（分类 tab + 左网格 + 右详情 + 阶位门槛 + 购买）
    bindShopLol();
    // 拍卖：子功能 tab（发起拍卖/在售/我的挂牌）+ 完整格子选择 + 出价/撤回
    bindAuctionPane(pane);
    // 寄售：子功能 tab（挂售 / 寄售市场 / 我的寄售）+ 完整格子选择（复用拍卖格子系统）+ 固定价 / 购买 / 撤回
    bindConsignPane(pane);
    // 预拉数据（缺则拉）
    if (!_shopCache && window.socket) window.socket.emit('getShopItems');
    if (!_auctionCache && window.socket) window.socket.emit('auction.listings');
    if (!_consignCache && window.socket) window.socket.emit('consign.listings');
  }

  function equipItems() {
    return [...(_items.items || []), ...(_items.warehouse || [])].filter(i => (i.type === 'equipment' || i.type === 'perm') && !(i.quality === 'black' || i.bind));
  }
  function optOf(it) {
    const q = QUALITY_LABEL[it.quality] || it.quality;
    return `<option value="${esc(it.uid || it.id)}">${esc(it.itemName || it.name)} (${q}${it.enhanceLevel ? '+' + it.enhanceLevel : ''})</option>`;
  }

  // ==================== 吞噬模块（格子式 · 可拖动 · 预览） ====================
  // 吞噬成本（与服务端 DEVOUR_COST 一致：白→绿20 … 橙→红400）
  const DEVOUR_COST_FRONT = [0, 20, 40, 80, 150, 260, 400];
  // 新品质词条数档位（white→red，对齐 BaseItem QUALITY.words）
  const DEVOUR_WORDS_FRONT = [0, 1, 2, 2, 3, 3, 4];
  function devourPool() {
    const pool = equipItems();
    // 加入穿戴中装备（equip 槽 → 名称 → 展示卡片，uid 用 "equip:名称" 前缀，服务端将自动卸下重算属性）
    const ch = _char || (typeof getCurrentCharacter === 'function' ? getCurrentCharacter() : null);
    const equip = (ch && ch.equip) || {};
    const seen = new Set(pool.map(i => (i.uid || i.id)));
    for (const slot of ['weapon', 'head', 'body', 'hand', 'foot', 'accessory']) {
      const name = equip[slot];
      if (!name || seen.has(name)) continue;
      // ★ 穿戴装备品质/图标/词条：优先取服务端 equipInfo（信息完整，不再硬编码）
      const eq = (window.Warehouse && window.Warehouse.getEquipInfo) ? (window.Warehouse.getEquipInfo()[slot] || null) : null;
      pool.push({ uid: 'equip:' + name, name, itemName: name, itemId: (eq && eq.itemId) || null, type: 'equipment', quality: (eq && eq.quality) || 'gold', icon: (eq && eq.icon) || '🛡', desc: (eq && eq.desc) || '穿戴中装备 · 处理时将自动卸下并重算属性', effects: (eq && eq.effects) || [], durability: (eq && eq.durability) ?? null, maxDurability: (eq && eq.maxDurability) ?? 100, worn: true, wornSlot: slot });
      seen.add('equip:' + name);
    }
    return pool;
  }
  function devourItemByUid(uid) {
    if (!uid) return null;
    return devourPool().find(i => (i.uid || i.id) === uid) || null;
  }
  function renderDevourSlotItem(uid) {
    const it = devourItemByUid(uid);
    if (!it) return '';
    const q = it.quality || 'white';
    return `<div class="ws-devour-slot-item q-${q}">
      ${itemIconHtml(it, 'ws-devour-slot-icon')}
      <span class="ws-devour-slot-name">${esc(it.itemName || it.name)}</span>
      <span class="ws-devour-slot-meta">${QUALITY_LABEL[q] || q}${it.enhanceLevel ? ' +' + it.enhanceLevel : ''}</span>
    </div>`;
  }
  // 吞噬预览：更新中间结果格（晋升后品质/词条）+ 费用行
  function updateDevourPreview() {
    const pv = el('cdDevourPreview');
    const resBody = el('cdDevourResultBody');
    if (!pv && !resBody) return;
    if (!_devourM || !_devourF) {
      if (pv) pv.innerHTML = '';
      if (resBody) resBody.innerHTML = '<span class="ws-devour-slot-empty">＋ 结果预览</span>';
      return;
    }
    const m = devourItemByUid(_devourM), f = devourItemByUid(_devourF);
    if (!m || !f) {
      if (pv) pv.innerHTML = '';
      if (resBody) resBody.innerHTML = '<span class="ws-devour-slot-empty">＋ 结果预览</span>';
      return;
    }
    const order = ['white', 'green', 'blue', 'purple', 'gold', 'orange', 'red'];
    const mRank = Math.max(0, order.indexOf(m.quality));
    const fRank = Math.max(0, order.indexOf(f.quality));
    let err = null;
    if (m.quality === 'black' || f.quality === 'black') err = '黑色装备不参与吞噬';
    else if (fRank > mRank) err = '材料品质不能高于主装备';
    else if (mRank >= 6) err = '已达红色湮灭（最高）';
    if (err) {
      if (resBody) resBody.innerHTML = `<span class="cd-ws-err">${esc(err)}</span>`;
      if (pv) pv.innerHTML = '';
      return;
    }
    const next = order[mRank + 1];
    const cost = DEVOUR_COST_FRONT[mRank] || 0;
    const fuelStats = (f.effects || []).filter(e => e.kind === 'stat')
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, Math.max(1, DEVOUR_WORDS_FRONT[mRank + 1]));
    const pts = _char ? (_char.mysteryPoint ?? 0) : 0;
    const canPay = pts >= cost;
    // 中间结果格：晋升后品质 + 合并词条数
    if (resBody) {
      resBody.innerHTML = `<div class="ws-devour-result-item">
        <span class="ws-devour-result-q q-${next}">${QUALITY_LABEL[next] || next}</span>
        <span class="ws-devour-result-words">并入 ${fuelStats.length} 词条</span>
      </div>`;
    }
    if (pv) {
      pv.innerHTML = `
        <div class="ws-devour-preview-row">消耗 <b class="${canPay ? '' : 'cd-warn'}">${cost} 🪙</b>（当前 ${pts}）· 材料并入：${fuelStats.length ? fuelStats.map(e => `${EFF_STAT_LABEL[e.stat] || e.stat} +${Math.max(1, Math.round((e.value || 2) / 2))}`).join('、') : '无'}</div>
        ${!canPay ? '<div class="cd-ws-err">寂静点数不足！</div>' : ''}
      `;
    }
  }
  // 吞噬格子列表 + 拖拽/点击放入 + 预览
  function bindDevourGrid(pane) {
    const grid = el('cdDevourGrid');
    if (!grid) return;
    const pool = devourPool();
    // ★ 装备池常态显示格子：无装备时也铺满空格子（不再显示空态文案）
    // ★ 复用可复用组件 EquipMaterialGrid（装备/材料格子）：流式 + 空槽补齐铺满 + 拖拽/点击
    const perRow = Math.max(8, Math.floor((grid.clientWidth || (pane.clientWidth - 24) || 1400) / 64));
    const availH = (document.querySelector('.cd-body')?.clientHeight || 919) - 40 - 44 - 160 - 40 - 44 - 30 - 30;
    const rows = Math.max(2, Math.min(5, Math.floor(availH / 64)));
    window.EquipMaterialGrid.render(grid, {
      items: pool, mode: 'equip', cardClass: 'ws-devour-eq', emptyCls: 'ws-devour-empty',
      perRow, rows, availH,
      drag: { mime: 'application/x-devour', data: (uid) => uid },
      onClick: (it) => {
        const uid = it.uid || it.id;
        if (_devourM === uid) _devourM = null;
        else if (!_devourM) _devourM = uid;
        else if (_devourF === uid) _devourF = null;
        else if (!_devourF) _devourF = uid;
        else { _devourM = uid; _devourF = null; }
        renderWorkshop();
      }
    });
    // 投放格：接收拖放
    const bindSlot = (slotId, setFn) => {
      const slot = el(slotId);
      if (!slot) return;
      slot.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('application/x-devour');
        if (!raw) return;
        setFn(raw);
        renderWorkshop();
      });
    };
    bindSlot('cdDevourSlotM', (uid) => { _devourM = uid; if (_devourF === uid) _devourF = null; });
    bindSlot('cdDevourSlotF', (uid) => { _devourF = uid; if (_devourM === uid) _devourM = null; });
    // 点击格内物品 → 移出
    const mBody = el('cdDevourSlotMBody'), fBody = el('cdDevourSlotFBody');
    if (mBody) mBody.addEventListener('click', () => { _devourM = null; renderWorkshop(); });
    if (fBody) fBody.addEventListener('click', () => { _devourF = null; renderWorkshop(); });
    updateDevourPreview();
  }

  let _wsTab = 'forge';   // ★ 工坊子分栏：forge 锻造 / devour 吞噬
  let _forgeItem = null;  // ★ DNF 锻造炉当前放入的装备
  let _devourM = null;    // ★ 吞噬主装备 uid
  let _devourF = null;    // ★ 吞噬材料 uid

  // ★ 锻造炉装备列表：背包 + 仓库 + 穿戴中（合并、去重、非黑色成长装备）
  function forgeEquipList() {
    const pool = [...(_items.items || []), ...(_items.warehouse || [])]
      .filter(i => (i.type === 'equipment' || i.type === 'perm') && !(i.quality === 'black' || i.bind));
    // 穿戴中的装备（equip 槽位 → 物品名），从物品池按 itemName 匹配并入
    const ch = _char || (typeof getCurrentCharacter === 'function' ? getCurrentCharacter() : null);
    const equipObj = (ch && ch.equip) || {};
    const equipped = Object.entries(equipObj).filter(([, v]) => v);
    const seen = new Set(pool.map(i => i.itemName || i.name));
    for (const [slot, nm] of equipped) {
      if (seen.has(nm)) continue;
      // ★ 穿戴装备品质/图标/词条/耐久：优先取服务端 equipInfo（信息完整，不再硬编码）
      const eq = (window.Warehouse && window.Warehouse.getEquipInfo) ? (window.Warehouse.getEquipInfo()[slot] || null) : null;
      pool.push({ uid: 'equip:' + nm, itemName: nm, name: nm, itemId: (eq && eq.itemId) || null, type: 'equipment', quality: (eq && eq.quality) || 'gold', icon: (eq && eq.icon) || '🛡', desc: (eq && eq.desc) || '穿戴中装备 · 处理时将自动卸下并重算属性', effects: (eq && eq.effects) || [], durability: (eq && eq.durability) ?? null, maxDurability: (eq && eq.maxDurability) ?? 100, worn: true });
      seen.add(nm);
    }
    return pool;
  }

  // ★ 装备图片 + emoji 兜底（优先 /assets/items/{itemId}.png）
  function itemIconHtml(it, cls) {
    const itemId = it.itemId || (typeof it.id === 'string' && it.id.startsWith('G-') ? it.id : '');
    if (itemId) {
      return `<span class="${cls}"><img src="/assets/items/${esc(itemId)}.png" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="forge-emoji" style="display:none">${esc(it.icon || '📦')}</span></span>`;
    }
    return `<span class="${cls}">${esc(it.icon || '📦')}</span>`;
  }

  // ★ 强化成功率（与后端 workshopHandler.ENHANCE_RATE 一致）
  const ENHANCE_RATE_FRONT = { 0: 100, 1: 100, 2: 100, 3: 95, 4: 90, 5: 85, 6: 80, 7: 72, 8: 65, 9: 58, 10: 50, 11: 42, 12: 35, 13: 28, 14: 22 };

  // ★ 锻造主属性判定（与服务端 workshopHandler._mainAttr 一致）：武器按 weaponKind，其余 con
  function forgeMainAttr(it) {
    if (it.weaponKind === 'melee') return 'str';
    if (it.weaponKind === 'ranged') return 'dex';
    if (it.weaponKind === 'spell') return 'int';
    return 'con';
  }

  // ★ 锻造炉右侧信息栏：当前装备信息 + 强化后（+1）信息预览（含物品图片）
  function renderForgeInfo(it) {
    if (!it) return '<span class="forge-info-empty">放入装备后显示强化信息</span>';
    const q = it.quality || 'white';
    const level = it.enhanceLevel || 0;
    const statLine = (effs) => (effs || []).filter(e => e.kind === 'stat')
      .map(e => `${EFF_STAT_LABEL[e.stat] || e.stat} +${e.value || 0}`).join(' · ');
    const stats = statLine(it.effects);
    // ★ 强化后（+1）预览：主属性词条 +2（有则累加，无则新增）、强化等级 +1、费用、成功率
    const mStat = forgeMainAttr(it);
    const exist = (it.effects || []).find(e => e.kind === 'stat' && e.stat === mStat);
    const nextEffects = (it.effects || []).map(e => e === exist ? { ...e, value: (e.value || 0) + 2 } : e);
    if (!exist) nextEffects.push({ kind: 'stat', stat: mStat, value: 2 });
    const nextLevel = level + 1;
    const nextCost = 20 + level * 10;
    const canUp = level < 15;
    const rate = ENHANCE_RATE_FRONT[level] ?? 100;
    const nextStats = statLine(nextEffects);
    return `<div class="forge-info-card q-${q}">
      <div class="forge-info-cols">
        <div class="forge-info-cur">
          <div class="forge-info-name">${esc(it.itemName || it.name)}${it.worn ? '（穿戴中）' : ''}</div>
          <div class="forge-info-meta">品质 <b>${QUALITY_LABEL[q] || q}</b> · 强化 <b>+${level}</b></div>
          <div class="forge-info-stats">${stats || '无属性词条'}</div>
          ${it.durability != null ? `<div class="forge-info-meta">🔧 耐久 ${it.durability}/${it.maxDurability ?? 100}</div>` : ''}
        </div>
        <div class="forge-info-mid">
          <div class="forge-info-rate">${canUp ? `强化成功率<br><b>${rate}%</b>` : '已达上限'}</div>
          <div class="forge-info-arrow">➜</div>
          <div class="forge-info-cost">${canUp ? `${nextCost} 🪙` : '+15'}</div>
        </div>
        <div class="forge-info-next">
          <div class="forge-info-next-title">强化后（+${nextLevel}）</div>
          <div class="forge-info-stats">${nextStats || '无属性词条'}</div>
          <div class="forge-info-next-cost">主属性 +2 · ${nextCost} 🪙</div>
        </div>
      </div>
      ${!canUp ? '<div class="forge-info-max">已达强化上限 +15</div>' : '<div class="forge-info-hint">🔧 修复 15 🪙</div>'}
    </div>`;
  }

  // ★ 锻造炉中央格定位（按地图编辑器标点：col28~32 / row26~31，网格 60×57）——确保不超出四点界限
  const FORGE_SLOT_GRID = { col0: 28, col1: 33, row0: 26, row1: 31, cols: 60, rows: 57 };  // ★ 5列×5行=正方形（向右扩宽 1 列）
  let _forgeImgNatural = null;
  function loadForgeImgNatural(cb) {
    if (_forgeImgNatural) return cb(_forgeImgNatural);
    const im = new Image();
    im.onload = () => { _forgeImgNatural = { w: im.naturalWidth, h: im.naturalHeight }; cb(_forgeImgNatural); };
    im.onerror = () => { _forgeImgNatural = { w: 1146, h: 1089 }; cb(_forgeImgNatural); };  // 兜底默认尺寸
    im.src = '/assets/ui/forge_furnace3.png';
  }
  // 计算 background contain 实际显示区域，把格子精确放到标点矩形内
  function positionForgeSlot() {
    const furnace = document.querySelector('.forge-furnace');
    const slot = el('forgeSlot');
    if (!furnace || !slot) return;
    loadForgeImgNatural((nat) => {
      const cw = furnace.clientWidth, ch = furnace.clientHeight;
      if (!cw || !ch) return;
      const iw = nat.w || 1146, ih = nat.h || 1089;
      const s = Math.min(cw / iw, ch / ih);
      const dw = iw * s, dh = ih * s;
      const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
      const G = FORGE_SLOT_GRID;
      const left = dx + (G.col0 / G.cols) * dw;
      const width = ((G.col1 - G.col0) / G.cols) * dw;
      const top = dy + (G.row0 / G.rows) * dh;
      const height = ((G.row1 - G.row0) / G.rows) * dh;
      slot.style.left = Math.round(left) + 'px';
      slot.style.width = Math.round(width) + 'px';
      slot.style.top = Math.round(top) + 'px';
      slot.style.height = Math.round(height) + 'px';
    });
  }
  // 窗口缩放时重新定位锻造格（仅 forge 面板可见时）
  let _forgeResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_forgeResizeTimer);
    _forgeResizeTimer = setTimeout(() => { if (el('forgeSlot') && el('forgeSlot').offsetParent) positionForgeSlot(); }, 150);
  });

  function renderWorkshop() {
    const pane = el('cdPaneWorkshop');
    if (!pane) return;
    const eqs = equipItems();
    const pts = _char ? (_char.mysteryPoint ?? 0) : 0;
    pane.innerHTML = `
      <div class="cd-ws-head">
        <span class="cd-ws-pts">🪙 寂静点数：<b>${pts}</b></span>
      </div>
      <div class="cd-ws-tabs">
        <button class="cd-ws-tab ${_wsTab === 'forge' ? 'active' : ''}" data-wstab="forge">⚒ 锻造</button>
        <button class="cd-ws-tab ${_wsTab === 'devour' ? 'active' : ''}" data-wstab="devour">🫀 吞噬</button>
      </div>
      <div class="cd-ws-pane" data-wsbody="forge" ${_wsTab === 'forge' ? '' : 'style="display:none"'}>
        <!-- ★ DNF 锻造炉：大炉区（占 2/5 屏）+ 中间物品格（拖入/点击放入） + 下方铺满仓库格子 -->
        <div class="forge">
          <div class="forge-furnace" style="background-image:url('/assets/ui/forge_furnace3.png')">
            <div class="forge-body">
              <div class="forge-slot ${_forgeItem ? 'has' : ''}" id="forgeSlot" title="从下方装备拖动或点击放入">
                ${_forgeItem ? `
                  <div class="forge-slot-item q-${_forgeItem.quality || 'white'}">
                    ${itemIconHtml(_forgeItem, 'forge-slot-icon')}
                  </div>` : '<span class="forge-slot-empty">⬇ 拖入或点击下方装备</span>'}
              </div>
            </div>
            <div class="forge-actions">
              <button class="forge-act enhance" data-act="enhance" ${_forgeItem ? '' : 'disabled'}>⚒ 强化</button>
              <button class="forge-act repair" data-act="repair" ${_forgeItem ? '' : 'disabled'}>🔧 修复</button>
              <button class="forge-act disasm" data-act="disasm" ${_forgeItem ? '' : 'disabled'}>💥 分解</button>
              ${_forgeItem ? '<button class="forge-act clear" data-act="clear">✖ 取出</button>' : ''}
            </div>
            <div class="forge-info" id="forgeInfo">
              ${_forgeItem ? renderForgeInfo(_forgeItem) : '<span class="forge-info-empty">⬆ 放入装备后显示强化信息</span>'}
            </div>
          </div>
          <div class="forge-list">
            <div class="cd-pane-title">🎒 可锻造装备（背包 · 仓库 · 穿戴中 · 可拖入锻造炉）</div>
            <div class="forge-grid" id="cdForgeGrid"></div>
          </div>
        </div>
      </div>
      <div class="cd-ws-pane" data-wsbody="devour" ${_wsTab === 'devour' ? '' : 'style="display:none"'}>
        <div class="cd-pane-title">🫀 吞噬晋升（白 ~ 红色品质 · 材料品质 ≤ 主装备）</div>
        <div class="ws-devour">
          <div class="ws-devour-slots">
            <!-- 主装备（左） -->
            <div class="ws-devour-slot ${_devourM ? 'has' : ''}" id="cdDevourSlotM" title="拖入主装备">
              <span class="ws-devour-slot-label">主装备</span>
              <div class="ws-devour-slot-body" id="cdDevourSlotMBody">
                ${_devourM ? renderDevourSlotItem(_devourM) : '<span class="ws-devour-slot-empty">⬇ 拖入主装备</span>'}
              </div>
            </div>
            <!-- 吞噬材料（中） -->
            <div class="ws-devour-slot ${_devourF ? 'has' : ''}" id="cdDevourSlotF" title="拖入材料">
              <span class="ws-devour-slot-label">吞噬材料</span>
              <div class="ws-devour-slot-body" id="cdDevourSlotFBody">
                ${_devourF ? renderDevourSlotItem(_devourF) : '<span class="ws-devour-slot-empty">⬇ 拖入材料</span>'}
              </div>
            </div>
            <!-- 吞噬结果（右） -->
            <div class="ws-devour-slot ws-devour-result" id="cdDevourResult">
              <span class="ws-devour-slot-label">吞噬结果</span>
              <div class="ws-devour-slot-body" id="cdDevourResultBody">
                <span class="ws-devour-slot-empty" id="cdDevourResultEmpty">＋ 结果预览</span>
              </div>
            </div>
          </div>
          <div class="ws-devour-preview" id="cdDevourPreview"></div>
          <div class="ws-devour-actions">
            <button class="btn-primary" id="cdDevourGo">🫀 吞噬晋升</button>
            <button class="ws-devour-clear" id="cdDevourClear">✖ 清空</button>
          </div>
        </div>
        <div class="cd-pane-title">🎒 可吞噬装备（背包 · 仓库 · 可拖入上方格子 / 点击放入）</div>
        <div class="ws-devour-grid" id="cdDevourGrid"></div>
      </div>
      <div id="cdWsResult" class="cd-ws-result"></div>
    `;
    // ★ 子分栏切换
    pane.querySelectorAll('.cd-ws-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _wsTab = tab.dataset.wstab;
        pane.querySelectorAll('.cd-ws-tab').forEach(t => t.classList.toggle('active', t === tab));
        pane.querySelectorAll('.cd-ws-pane').forEach(p => { p.style.display = p.dataset.wsbody === _wsTab ? '' : 'none'; });
      });
    });
    // 吞噬：格子列表 + 拖拽/点击放入 + 预览
    bindDevourGrid(pane);
    // 事件
    const result = (msg, ok) => { const r = el('cdWsResult'); if (r) r.innerHTML = `<div class="${ok ? 'cd-ws-ok' : 'cd-ws-err'}">${esc(msg)}</div>`; };
    const bindAct = (cls, emitName, payloadFn) => {
      document.querySelectorAll('.cd-act.' + cls).forEach(btn => {
        btn.addEventListener('click', () => {
          window.socket.emit(emitName, payloadFn(btn.dataset.uid));
        });
      });
    };
    bindAct('enhance', 'workshop.enhance', (uid) => ({ itemUid: uid }));
    bindAct('repair', 'workshop.repair', (uid) => ({ itemUid: uid }));
    bindAct('disasm', 'workshop.disassemble', (uid) => ({ itemUid: uid }));
    // ★ 商店/拍卖/寄售已迁移至独立「商店」标签（renderShopModule），工坊仅保留锻造/吞噬
    // ★ DNF 锻造炉交互：点击装备放入炉中 + 拖拽放入 / 操作按钮 / 取出（格子委托 EquipMaterialGrid 组件）
    const forgeList = pane.querySelector('.forge-grid');
    if (forgeList) {
      const list = forgeEquipList();
      // ★ 左右布局：右半为格子列表，宽度约 pane 一半
      const perRow = Math.max(8, Math.floor((pane.clientWidth || 1400) / 2 / 64));
      // forge-list 可用高度 = 详情内容区 - 头部40 - 分栏44 - 标题30 - padding
      const availH = (document.querySelector('.cd-body')?.clientHeight || 919) - 40 - 44 - 30 - 30;
      const rows = Math.max(4, Math.min(10, Math.floor(availH / 64)));
      window.EquipMaterialGrid.render(forgeList, {
        items: list, mode: 'equip', cardClass: 'forge-eq', emptyCls: 'forge-empty',
        perRow, rows, availH,
        drag: { mime: 'application/x-forge', data: (uid) => uid },
        onClick: (it) => { _forgeItem = it; renderWorkshop(); }
      });
    }
    // 锻造炉中央格：接收拖入
    const forgeSlot = el('forgeSlot');
    if (forgeSlot) {
      forgeSlot.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      forgeSlot.addEventListener('drop', (e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('application/x-forge');
        if (!raw) return;
        const pool = forgeEquipList();
        const it = pool.find(i => (i.uid || i.id) === raw);
        if (it) { _forgeItem = it; renderWorkshop(); }
      });
    }
    if (forgeSlot && _forgeItem) {
      // 操作按钮
      const actBtn = (cls, emitName, payload) => {
        pane.querySelectorAll('.forge-act.' + cls).forEach(btn => {
          btn.addEventListener('click', () => {
            if (!_forgeItem) { result('请先放入装备', false); return; }
            const isWorn = !!_forgeItem.worn;
            if (isWorn && (cls === 'enhance' || cls === 'repair' || cls === 'disasm')) {
              result('穿戴中的装备请先卸下再锻造', false); return;
            }
            window.socket.emit(emitName, payload());
          });
        });
      };
      actBtn('enhance', 'workshop.enhance', () => ({ itemUid: _forgeItem.uid }));
      actBtn('repair', 'workshop.repair', () => ({ itemUid: _forgeItem.uid }));
      actBtn('disasm', 'workshop.disassemble', () => ({ itemUid: _forgeItem.uid }));
      const clearBtn = pane.querySelector('.forge-act.clear');
      if (clearBtn) clearBtn.addEventListener('click', () => { _forgeItem = null; renderWorkshop(); });
    }
    // 吞噬按钮 + 清空
    const dg = el('cdDevourGo');
    if (dg) dg.addEventListener('click', () => {
      if (!_devourM || !_devourF) { result('请选择主装备与吞噬材料', false); return; }
      if (_devourM === _devourF) { result('主装备与吞噬材料不能是同一件', false); return; }
      window.socket.emit('workshop.devour', { itemUid: _devourM, fuelUid: _devourF });
    });
    const dc = el('cdDevourClear');
    if (dc) dc.addEventListener('click', () => { _devourM = null; _devourF = null; renderWorkshop(); });
    // ★ 锻造格按标点精确定位（不超出四点界限）
    positionForgeSlot();
  }

  // ==================== 标签·任务系统（完整：可接/进行中/可提交/记录） ====================
  function renderTasks() {
    const pane = el('cdPaneTasks');
    if (!pane) return;
    // 委托 questBoard 模块渲染（接受/提交/奖励/记录），并注入当前角色背包上下文
    if (window.QuestBoard) {
      window.QuestBoard.open(pane);
      return;
    }
    // 兜底：旧版仅展示 taskHistory
    const history = (_char.taskHistory || []).slice().reverse();
    pane.innerHTML = `
      <div class="cd-pane-title">🎯 任务记录</div>
      ${history.length
        ? `<div class="cd-arc-list">${history.map(t => `
          <div class="cd-arc-row cd-arc-arch">
            <div class="cd-arc-arch-title">${esc(t.title || '')}<span class="cd-arc-arch-src">${esc(t.type || '')} · ${esc(t.time || '')}</span></div>
          </div>`).join('')}</div>`
        : '<div class="cd-empty">暂无任务记录——进入副本后，完成主线 / 支线任务（收集线索、联系并营救陈慧、清除修格斯等）将自动归档于此</div>'}
    `;
  }

  // ==================== 标签5 档案记录 ====================
  const ARCH_CAT_LABEL = { npcQuotes: '🗣 NPC 证词', books: '📜 古籍/文本', monsters: '🐙 怪物图鉴', anomalies: '🌀 异象见闻' };
  function renderArchive() {
    const pane = el('cdPaneArchive');
    if (!pane) return;
    const copies = (_char.copiesHistory || []).slice().reverse();
    const clears = (_char.clearedCopies || []).slice().reverse();
    const losses = (_char.sanLossHistory || []).slice().reverse();
    const perm = _char.permanentSanLoss || 0;
    const arc = _char.archive || {};
    const archCount = (arc.npcQuotes || []).length + (arc.books || []).length + (arc.monsters || []).length + (arc.anomalies || []).length;
    const clearCount = copies.length || clears.length;
    const tier = tierForCopies(clears.length);   // ★ 阶位依据真实通关数

    // 轮回记录（优先 copiesHistory，兼容旧 clearedCopies）
    let loopHtml;
    if (copies.length) {
      loopHtml = `<div class="cd-arc-list">${copies.map(h => `
        <div class="cd-arc-row cd-arc-copy">
          <div class="cd-arc-copy-top"><span>🏁 ${esc(h.copyName || '')}</span><span class="cd-grade">${esc(h.grade || '')} · ${h.totalScore ?? 0} 分</span></div>
          <div class="cd-arc-copy-meta">${esc(h.time || '')}${h.permanentSanLoss ? ` · <span class="cd-warn">永久SAN -${h.permanentSanLoss}</span>` : ''}${h.expGained ? ` · 经验+${h.expGained}` : ''}</div>
        </div>`).join('')}</div>`;
    } else if (clears.length) {
      loopHtml = `<div class="cd-arc-list">${clears.map(n => `<div class="cd-arc-row">🏁 ${esc(n)}</div>`).join('')}</div>`;
    } else {
      loopHtml = '<div class="cd-empty">暂无通关记录</div>';
    }

    // 素材档案库（四分类）
    const archSections = Object.keys(ARCH_CAT_LABEL).map(k => {
      const list = arc[k] || [];
      if (!list.length) return '';
      return `<div class="cd-pane-title">${ARCH_CAT_LABEL[k]}（${list.length}）</div>
        <div class="cd-arc-list">${list.slice().reverse().map(x => `
          <div class="cd-arc-row cd-arc-arch" title="${esc(x.content || '')}">
            <div class="cd-arc-arch-title">${esc(x.title || '')}<span class="cd-arc-arch-src">${esc(x.source || '')}</span></div>
            <div class="cd-arc-arch-content">${esc(x.content || '')}</div>
          </div>`).join('')}</div>`;
    }).join('');

    pane.innerHTML = `
      <div class="arc-tabs">
        <button class="arc-tab ${_archiveTab === 'loop' ? 'active' : ''}" data-artab="loop">🌀 轮回记录</button>
        <button class="arc-tab ${_archiveTab === 'archive' ? 'active' : ''}" data-artab="archive">🗂 素材档案库</button>
        <button class="arc-tab ${_archiveTab === 'san' ? 'active' : ''}" data-artab="san">⚠️ SAN 损耗明细</button>
      </div>
      <div class="arc-panel" data-arpanel="loop" ${_archiveTab === 'loop' ? '' : 'style="display:none"'}>
        <div class="cd-arc-cards">
          <div class="cd-arc-card"><span>阶位</span><b>${TIER_NAMES[tier]}</b></div>
          <div class="cd-arc-card"><span>副本游玩总次数</span><b>${clearCount}</b></div>
          <div class="cd-arc-card"><span>素材档案条目</span><b>${archCount}</b></div>
          <div class="cd-arc-card"><span>累计永久 SAN 上限损耗</span><b class="${perm > 0 ? 'cd-warn' : ''}">${perm}</b></div>
        </div>
        ${loopHtml}
      </div>
      <div class="arc-panel" data-arpanel="archive" ${_archiveTab === 'archive' ? '' : 'style="display:none"'}>
        <div class="cd-pane-title">🗂 素材档案库（跨副本永久保存 · 自动收录）</div>
        ${archSections || '<div class="cd-empty">暂无档案收录——收集线索、NPC 证词、识破怪物后将自动归档</div>'}
      </div>
      <div class="arc-panel" data-arpanel="san" ${_archiveTab === 'san' ? '' : 'style="display:none"'}>
        <div class="cd-pane-title">⚠️ SAN 损耗明细（临时 / 永久）</div>
        ${losses.length ? `<div class="cd-arc-list">${losses.map(l => `<div class="cd-arc-row">${l.type === 'permanent' ? '🔒永久' : '🔹临时'} -${l.amount}（${esc(l.source || '')}）→ maxSan ${l.maxSanAfter ?? '?'} · ${esc((l.time || '').slice(0, 16))}</div>`).join('')}</div>` : '<div class="cd-empty">暂无 SAN 损耗记录</div>'}
      </div>`;
    // ★ 档案记录子功能 tab 切换
    pane.querySelectorAll('.arc-tab').forEach(tab => {
      tab.addEventListener('click', () => { _archiveTab = tab.dataset.artab; renderArchive(); });
    });
  }

  // ==================== 事件接入 ====================
  function init() {
    const back = el('cdBack');
    if (back) back.addEventListener('click', () => window.CharDetail.close());
    const enter = el('cdEnterCopy');
    if (enter) enter.addEventListener('click', () => {
      // ★ 健壮性：_char 可能因刷新/后退丢失 → 从 currentCharacter 兜底
      const ch = (typeof getCurrentCharacter === 'function' && getCurrentCharacter()) || null;
      const uid = (_char && _char.uid) || (ch && ch.uid);
      if (!uid) { (window.showToast || function (m) { alert(m); })('请先选择角色'); return; }
      // ★ 防御：清除静默选择标记（防止残留 'detail'/'setup' 导致 selectCharacter 又回到详情页而非副本选择页）
      _pendingSkillModal = null;
      window.socket.emit('selectCharacter', { characterUid: uid });
    });
    document.querySelectorAll('.cd-tab').forEach(t => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });
    // 背包/仓库数据（格子渲染由 warehouse.js 处理；这里仅刷新工坊装备列表）
    window.socket.on('inventoryData', (data) => {
      if (!pageCharDetail || !pageCharDetail.classList.contains('active')) return;
      _items = { items: data.items || [], warehouse: data.warehouse || [] };
      if (_curTab === 'workshop') renderWorkshop();
      if (_curTab === 'shop') renderShopModule();
    });
    // 工坊结果
    window.socket.on('workshopResult', ({ ok, msg }) => {
      if (!pageCharDetail || !pageCharDetail.classList.contains('active')) return;
      (window.showToast || function (m) { alert(m); })(msg || (ok ? '操作成功' : '操作失败'));
      // 刷新属性（强化可能影响）与背包；锻造炉内物品已变化 → 清空重选
      _forgeItem = null;
      _devourM = null;
      _devourF = null;
      window.socket.emit('getInventory');
      window.socket.emit('getCharacterList', { uid: currentUser?.uid });
      renderWorkshop();
    });
    // ★ 角色列表返回 → 同步详情 _char（吞噬/强化/购买后穿戴槽/点数/属性即时刷新）
    window.socket.on('characterList', ({ characters }) => {
      if (!pageCharDetail || !pageCharDetail.classList.contains('active') || !_char) return;
      const found = (characters || []).find(c => c.uid === _char.uid);
      if (found) {
        _char = found;
        renderOverview();
        if (_curTab === 'workshop') renderWorkshop();
      }
    });
    // 属性变动刷新（characterUpdate）
    window.socket.on('characterUpdate', ({ uid, attr, mysteryPoint }) => {
      if (!pageCharDetail || !pageCharDetail.classList.contains('active')) return;
      if (mysteryPoint !== undefined && _char) _char.mysteryPoint = mysteryPoint;
      if (_curTab === 'workshop') renderWorkshop();
      renderOverview();
    });
    // ★ 商店数据
    window.socket.on('shopData', ({ items, points, tier }) => {
      _shopCache = { items, points, tier };
      if (_char && points !== undefined) _char.mysteryPoint = points;
      if (pageCharDetail && pageCharDetail.classList.contains('active')) {
        if (_curTab === 'workshop') renderWorkshop();
        if (_curTab === 'shop') renderShopModule();
      }
    });
    // ★ 商店购买结果
    window.socket.on('shopPurchase', ({ msg, ok }) => {
      if (!pageCharDetail || !pageCharDetail.classList.contains('active')) return;
      (window.showToast || function (m) { alert(m); })(msg || (ok ? '购买成功' : '购买失败'));
      window.socket.emit('getInventory');
      if (ok && window.socket) window.socket.emit('getShopItems');
      if (_curTab === 'shop') renderShopModule();
    });
    // ★ 寄售结果
    window.socket.on('consignResult', ({ ok, msg }) => {
      if (!pageCharDetail || !pageCharDetail.classList.contains('active')) return;
      (window.showToast || function (m) { alert(m); })(msg || (ok ? '寄售成功' : '寄售失败'));
      if (window.socket) window.socket.emit('consign.listings');
      window.socket.emit('getInventory');
      if (ok) window.socket.emit('getShopItems');
      if (_curTab === 'shop') renderShopModule();
    });
    // ★ 拍卖数据（列表）
    window.socket.on('auctionData', ({ listings }) => {
      _auctionCache = { listings: listings || [] };
      if (pageCharDetail && pageCharDetail.classList.contains('active')) {
        if (_curTab === 'workshop') renderWorkshop();
        if (_curTab === 'shop') renderShopModule();
      }
    });
    // ★ 寄售数据（列表）
    window.socket.on('consignData', ({ listings }) => {
      _consignCache = { listings: listings || [] };
      if (pageCharDetail && pageCharDetail.classList.contains('active') && _curTab === 'shop') renderShopModule();
    });
    // ★ 拍卖操作结果
    window.socket.on('auctionResult', ({ ok, msg }) => {
      if (!pageCharDetail || !pageCharDetail.classList.contains('active')) return;
      (window.showToast || function (m) { alert(m); })(msg || (ok ? '操作成功' : '操作失败'));
      if (window.socket) window.socket.emit('auction.listings');
      if (window.socket) window.socket.emit('consign.listings');
      window.socket.emit('getInventory');
      if (ok) window.socket.emit('getShopItems');
      if (_curTab === 'shop') renderShopModule();
    });
    // ★ 市场变化广播（他人挂单/成交/撤回 → 刷新当前列表）
    window.socket.on('marketUpdate', () => {
      if (!pageCharDetail || !pageCharDetail.classList.contains('active') || _curTab !== 'shop') return;
      if (window.socket) window.socket.emit('auction.listings');
      if (window.socket) window.socket.emit('consign.listings');
      window.socket.emit('getShopItems');
    });
    // ★ 拍卖成交播报（大厅）
    window.socket.on('auctionSold', ({ msg }) => {
      if (window.showToast) window.showToast(msg);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
