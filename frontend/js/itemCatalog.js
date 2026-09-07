/**
 * itemCatalog.js — 全物品图鉴（游戏内全部物品池总览）
 * 拉取 /api/items/catalog（全局池+品质+清单）+ 各副本 /api/items/dungeon/:id
 * 分组展示：全局物品池 G-* + 各副本清单（含激活状态）——游戏里总的物品
 * 页面：pageItemCatalog
 */
(function() {
  let category = 'all';
  let data = null;   // { global: [], dungeons: [{dungeonId,prefix,name,maxQuality,active,items}] }
  let qualityMap = {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TYPE_LABEL = { plot: '剧情', consumable: '消耗品', material: '材料', equipment: '装备', perm: '强化', equip: '装备', tool: '工具' };
  const ATTR_LABEL = { str: '力量', con: '体质', dex: '敏捷', per: '感知', wil: '意志', hp: '生命', san: '理智' };
  const SLOT_LABEL = { weapon: '武器', head: '头部', body: '身体', hand: '手部', foot: '足部', accessory: '配饰' };

  async function load() {
    const cat = await (await fetch('/api/items/catalog')).json();
    qualityMap = cat.quality || {};
    const dungeons = [];
    for (const d of (cat.dungeons || [])) {
      try {
        const dd = await (await fetch('/api/items/dungeon/' + d.dungeonId)).json();
        dungeons.push({ ...d, active: !!dd.active, items: dd.items || [] });
      } catch (e) { dungeons.push({ ...d, active: false, items: [] }); }
    }
    data = { global: cat.global || [], dungeons };
    render();
  }

  function filtered(list) {
    if (category === 'all') return list;
    return list.filter(it => it.type === category || (it.type === 'equip' && category === 'equipment'));
  }

  function effectText(effs) {
    return (effs || []).map(e => {
      let name = e.label;
      if (!name) {
        if (e.kind === 'stat') name = ATTR_LABEL[e.stat] || e.stat;
        else name = ATTR_LABEL[e.kind] || e.kind;
      }
      return name + (e.value ? (e.value > 0 ? ' +' : ' ') + e.value : '') + (e.duration ? '(' + e.duration + '回合)' : '');
    }).join('；');
  }

  // ★ 物品图标：优先 itemId 图片，emoji 兜底
  function iconHtml(it) {
    const itemId = it.itemId || (typeof it.id === 'string' && it.id.startsWith('G-') ? it.id : '');
    if (itemId) {
      return `<span class="cat-card-icon"><img src="/assets/items/${esc(itemId)}.png" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="cat-emoji" style="display:none">${esc(it.icon || '📦')}</span></span>`;
    }
    return `<span class="cat-card-icon">${esc(it.icon || '📦')}</span>`;
  }

  function cardHTML(it) {
    const qm = qualityMap[it.quality] || { label: '白', color: '#c8c8c8' };
    const eff = effectText(it.effects);
    const tags = (it.tags || []).length ? '<small class="cat-card-tags">' + it.tags.map(t => '#' + t).join(' ') + '</small>' : '';
    return `
      <div class="cat-card q-${it.quality || 'white'}" title="${esc((it.desc || '') + (eff ? '\n' + eff : ''))}">
        ${iconHtml(it)}
        <span class="cat-card-name">${esc(it.itemName || it.name)}
          <small class="inv-item-quality" style="color:${qm.color};border-color:${qm.color}55;background:${qm.color}1a">${qm.label}</small>
        </span>
        <small class="cat-card-type">${TYPE_LABEL[it.type] || it.type}</small>
        <span class="cat-card-meta">
          ${it.stackable ? '<small>堆叠' + (it.maxStack || '') + '</small>' : ''}
          ${it.cooldown ? '<small>冷却' + it.cooldown + '回</small>' : ''}
          ${it.slot ? '<small>槽:' + (SLOT_LABEL[it.slot] || it.slot) + '</small>' : ''}
        </span>
        ${tags}
        <div class="cat-card-desc">${esc(it.desc || '')}</div>
      </div>
    `;
  }

  function render() {
    const loading = document.getElementById('catLoading');
    const sections = document.getElementById('catSections');
    if (!sections) return;
    if (!data) { loading.style.display = ''; return; }
    loading.style.display = 'none';
    let html = '';
    // 全局物品池
    const g = filtered(data.global);
    html += `<div class="cat-sec">
      <div class="cat-sec-title">🌍 全局物品池（G-* · 常驻）<span class="cat-count">${g.length}</span></div>
      <div class="cat-grid">${g.map(cardHTML).join('') || '<div class="empty-inventory">该分类暂无全局物品</div>'}</div>
    </div>`;
    // 各副本清单
    for (const d of data.dungeons) {
      const items = filtered(d.items);
      html += `<div class="cat-sec">
        <div class="cat-sec-title">🏛 ${d.name || d.dungeonId}（${d.prefix}-* · 掉落上限 ${d.maxQuality || 'purple'}）
          ${d.active ? '<span class="cat-active">● 副本激活中</span>' : '<span class="cat-inactive">○ 未激活</span>'}
          <span class="cat-count">${items.length}</span>
        </div>
        <div class="cat-grid">${items.map(cardHTML).join('') || '<div class="empty-inventory">该分类暂无物品</div>'}</div>
      </div>`;
    }
    sections.innerHTML = html;
  }

  // ★ 幂等守卫
  let _catsBound = false;
  function bindCats() {
    if (_catsBound) return; _catsBound = true;
    document.querySelectorAll('#catCats .shop-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#catCats .shop-cat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        category = btn.dataset.cat;
        render();
      });
    });
  }

  function init() {
    const back = document.getElementById('btnCatBack');
    if (back && !back._bound) { back._bound = true; back.addEventListener('click', () => window.ItemCatalog.close()); }
    bindCats();
  }

  window.ItemCatalog = {
    init,
    open: () => {
      init();
      if (typeof showPage === 'function') showPage(document.getElementById('pageItemCatalog'));
      else document.getElementById('pageItemCatalog')?.classList.add('active');
      document.getElementById('catLoading').style.display = '';
      data = null;
      category = 'all';
      document.querySelectorAll('#catCats .shop-cat').forEach(b => b.classList.toggle('active', b.dataset.cat === 'all'));
      // ★ 全物品池（全局 + 各副本）——游戏里总的物品
      load();
    },
    close: () => {
      const p = document.getElementById('pageItemCatalog');
      if (p) p.classList.remove('active');
      if (typeof showPage === 'function') showPage(document.getElementById('pageCharacters'));
    },
    refresh: render
  };
})();
