/**
 * 仓库系统面板模块（副本外统一管理角色所有物品）
 * 依赖：window.socket、window.getCurrentCharacter()
 * 事件：getInventory / inventoryData / equipItem / unequipItem / equipChanged / useItem
 * 规则：装备类 → 装备/卸下；消耗品类 → 使用；其他 → 展示
 */
(function() {
  let overlay = null;
  let inventory = [];

  function showModal(m, show) { if (!m) return; m.classList.toggle('active', show); }

  function createDOM() {
    if (document.getElementById('itemConfigOverlay')) return;
    const o = document.createElement('div');
    o.id = 'itemConfigOverlay';
    o.className = 'modal item-config-overlay';
    o.innerHTML = `
      <div class="modal-content item-config-box">
        <h2>🎒 仓库</h2>
        <p class="alloc-hint" id="icHint"></p>
        <!-- 装备槽（背包 equip-bar 样式） -->
        <div class="ic-equip-bar">
          <div class="ic-slot" data-slot="weapon">
            <span class="ic-slot-label">🗡 武器</span>
            <div class="ic-slot-value" id="icWeapon">空</div>
            <button class="ic-unequip" data-slot="weapon" style="display:none">卸下</button>
          </div>
          <div class="ic-slot" data-slot="accessory">
            <span class="ic-slot-label">🧿 饰品</span>
            <div class="ic-slot-value" id="icAccessory">空</div>
            <button class="ic-unequip" data-slot="accessory" style="display:none">卸下</button>
          </div>
        </div>
        <!-- 物品网格（背包 inventory-grid 样式） -->
        <div class="ic-inv-body">
          <div class="inventory-grid" id="icInventory"></div>
        </div>
        <div class="modal-actions">
          <button id="btnIcClose" class="btn-secondary">关闭</button>
        </div>
      </div>
    `;
    document.body.appendChild(o);
    overlay = o;
    document.getElementById('btnIcClose').addEventListener('click', () => showModal(overlay, false));
  }

  function render() {
    if (!overlay) return;
    const ch = window.getCurrentCharacter && window.getCurrentCharacter();
    const equip = (ch && ch.equip) || {};
    const setSlot = (slot, name) => {
      const valEl = document.getElementById(slot === 'weapon' ? 'icWeapon' : 'icAccessory');
      const btn = overlay.querySelector(`.ic-unequip[data-slot="${slot}"]`);
      if (valEl) valEl.textContent = name || '空';
      if (btn) btn.style.display = name ? '' : 'none';
    };
    setSlot('weapon', equip.weapon);
    setSlot('accessory', equip.accessory);

    const box = document.getElementById('icInventory');
    if (!inventory.length) {
      box.innerHTML = '<div class="empty-inventory">仓库暂无物品，可前往副本商店购买</div>';
    } else {
      // ★ 背包网格卡片样式
      box.innerHTML = inventory.map(it => {
        const isEquip = it.type === 'equip';
        const isConsumable = it.type === 'consumable';
        const typeLabel = isEquip ? '装备' : isConsumable ? '消耗品' : '其他';
        const actionBtn = isEquip
          ? '<button class="ic-act-btn">装备</button>'
          : isConsumable
            ? '<button class="ic-act-btn use">使用</button>'
            : '';
        return `
          <div class="inventory-item ${isEquip ? 'equippable' : ''} ${isConsumable ? 'usable' : ''}" data-id="${it.id}">
            <span class="inv-item-name">${it.name}</span>
            <small class="inv-item-type">${typeLabel}</small>
            ${actionBtn}
          </div>
        `;
      }).join('');
      // 装备
      box.querySelectorAll('.inventory-item.equippable').forEach(item => {
        const btn = item.querySelector('.ic-act-btn');
        if (btn) btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const name = item.querySelector('.inv-item-name').textContent;
          const slot = name.includes('挂坠') ? 'accessory' : 'weapon';
          window.socket.emit('equipItem', { itemId: item.dataset.id, slot });
        });
      });
      // 消耗品使用
      box.querySelectorAll('.inventory-item.usable').forEach(item => {
        const btn = item.querySelector('.ic-act-btn.use');
        if (btn) btn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.socket.emit('useItem', { itemId: item.dataset.id });
        });
      });
    }
    // 卸下按钮
    overlay.querySelectorAll('.ic-unequip').forEach(btn => {
      btn.onclick = () => window.socket.emit('unequipItem', { slot: btn.dataset.slot });
    });
  }

  function init() {
    if (document.getElementById('itemConfigOverlay')) return;
    createDOM();
    if (window.socket) {
      window.socket.on('inventoryData', (data) => {
        inventory = data.items || [];
        const ch = window.getCurrentCharacter && window.getCurrentCharacter();
        if (ch) ch.inventory = inventory;
        render();
        if (window.CluePanel?.refresh) window.CluePanel.refresh();
      });
      window.socket.on('equipChanged', (data) => {
        const ch = window.getCurrentCharacter && window.getCurrentCharacter();
        if (ch) { ch.equip = data.equip; ch.inventory = data.items; }
        inventory = data.items || [];
        render();
        if (window.CluePanel?.refresh) window.CluePanel.refresh();
      });
    }
  }

  window.ItemConfig = {
    init,
    open: () => {
      init();
      const ch = window.getCurrentCharacter && window.getCurrentCharacter();
      if (!ch) { (window.showToast || function(m){ alert(m); })('请先选择角色'); return; }
      const hint = document.getElementById('icHint');
      if (hint) hint.textContent = `副本外统一管理「${ch.name}」的全部物品：装备、使用消耗品`;
      render();
      showModal(overlay, true);
      window.socket.emit('getInventory');
    },
    close: () => { if (overlay) showModal(overlay, false); }
  };
})();
