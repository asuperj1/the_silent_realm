/**
 * 属性分配模块（分配升级获得的属性点 attrPoints）
 * 依赖：window.socket、window.getCurrentCharacter()
 * 事件：applyAttrPoints / attrPointsApplied
 */
(function() {
  let overlay = null;
  // ★ P0 六维属性：力量/敏捷/体力/智力/魅力/幸运（2026-08-23）
  const ATTRS = [
    ['str', '💪', '力量'], ['dex', '👟', '敏捷'], ['con', '🛡️', '体力'],
    ['int', '🧠', '智力'], ['cha', '🎭', '魅力'], ['lck', '🍀', '幸运']
  ];
  let alloc = { str: 0, dex: 0, con: 0, int: 0, cha: 0, lck: 0 };
  let remainPoints = 0;

  function showModal(m, show) { if (!m) return; m.classList.toggle('active', show); }

  function createDOM(embedParent) {
    if (document.getElementById('attrAllocateOverlay')) return;
    const o = document.createElement('div');
    o.id = 'attrAllocateOverlay';
    o.className = 'modal attr-alloc-overlay' + (embedParent ? ' embed' : '');
    o.innerHTML = `
      <div class="modal-content attr-alloc-box">
        <h2>📊 属性分配</h2>
        <p class="alloc-hint">将升级获得的属性点分配到六项属性（可分配 <b id="allocPoints" style="color:#ffd700">0</b> 点）</p>
        <div id="allocRows" class="alloc-rows"></div>
        <div class="modal-actions">
          <button id="btnAllocConfirm" class="btn-primary">确认分配</button>
          <button id="btnAllocClose" class="btn-secondary">关闭</button>
        </div>
      </div>
    `;
    if (embedParent && typeof embedParent === 'string') {
      const p = document.getElementById(embedParent);
      if (p) { p.appendChild(o); o.dataset.embedParent = embedParent; }
    } else {
      document.body.appendChild(o);
    }
    overlay = o;
    document.getElementById('btnAllocClose').addEventListener('click', () => showModal(overlay, false));
    document.getElementById('btnAllocConfirm').addEventListener('click', () => {
      const total = Object.values(alloc).reduce((a, b) => a + b, 0);
      if (total <= 0) { (window.showToast || function(m){ alert(m); })('请先分配属性点'); return; }
      if (total > remainPoints) { (window.showToast || function(m){ alert(m); })('可分配点数不足'); return; }
      window.socket.emit('applyAttrPoints', { allocated: alloc });
    });
  }

  // ★ 每行最大可分配数：受属性上限（普通 100 / 幸运 10）与剩余点数双重约束
  function maxAllocFor(key, attr) {
    const val = attr[key] || 0;
    const spent = Object.values(alloc).reduce((a, b) => a + b, 0);
    // ★ 幸运特殊：初始随机 1~10，上限 10（其余属性上限 100）
    const cap = key === 'lck' ? 10 : 100;
    const byCap = cap - val;
    const byPool = remainPoints - (spent - (alloc[key] || 0));
    return Math.max(0, Math.min(byCap, byPool));
  }

  // ★ 单行 DOM 增量更新（拖动中避免整表重建，保证手感流畅）
  function updateRow(row, key, attr) {
    if (!row) return;
    const val = attr[key] || 0;
    const delta = alloc[key] || 0;
    const maxA = maxAllocFor(key, attr);
    const pct = Math.min(100, ((val + delta) / 100) * 100);
    const fill = row.querySelector('.attr-fill');
    const thumb = row.querySelector('.attr-thumb');
    const deltaEl = row.querySelector('.val');
    const plus = row.querySelector('.plus');
    const minus = row.querySelector('.minus');
    if (fill) fill.style.width = pct + '%';
    if (thumb) thumb.style.left = pct + '%';
    if (deltaEl) deltaEl.textContent = delta > 0 ? '+' + delta : '0';
    if (plus) plus.disabled = maxA <= 0;
    if (minus) minus.disabled = delta <= 0;
  }

  // ★ 读取当前角色属性快照
  function currentAttr() {
    const ch = window.getCurrentCharacter && window.getCurrentCharacter();
    return (ch && ch.attr) || {};
  }

  function render() {
    if (!overlay) return;
    const ptsEl = document.getElementById('allocPoints');
    // ★ 顶部可分配点数随分配动态变化：剩余 = 总点 − 已分配总和
    if (ptsEl) ptsEl.textContent = remainPoints - Object.values(alloc).reduce((s, v) => s + v, 0);
    const rows = document.getElementById('allocRows');
    if (!rows) return;
    const confirmBtn = document.getElementById('btnAllocConfirm');
    // ★ 空态：无可分配属性点 → 居中占位提示（嵌入页不空白、居中放置）
    if (remainPoints <= 0) {
      rows.innerHTML = '<div class="cd-empty">暂无可分配的属性点（升级可获得）</div>';
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }
    if (confirmBtn) confirmBtn.disabled = false;
    const attr = currentAttr();
    rows.innerHTML = ATTRS.map(([key, icon, label]) => {
      const val = attr[key] || 0;
      const delta = alloc[key] || 0;
      const maxA = maxAllocFor(key, attr);
      const disabled = maxA <= 0;
      // ★ 滑块位置 = 已分配量 / 可分配量（与数值严格同步，杜绝视觉脱节）
      const ratio = disabled ? 0 : Math.min(1, delta / maxA);
      const pct = ratio * 100;
      return `
        <div class="attr-row alloc-row ${disabled ? 'attr-disabled-row' : ''}" data-key="${key}">
          <span class="attr-icon">${icon}</span><span class="attr-label">${label}</span>
          <button class="attr-step minus" type="button" ${delta <= 0 ? 'disabled' : ''}>−</button>
          <div class="attr-slider" role="slider" tabindex="0" aria-label="${label}">
            <div class="attr-track ${disabled ? 'attr-disabled' : ''}" data-track-for="${key}">
              <div class="attr-fill" style="width:${pct}%"></div>
              <div class="attr-thumb" style="left:${pct}%"></div>
            </div>
            <div class="attr-slider-readout">
              <span class="attr-newval">${val + delta}</span>
              <span class="attr-delta">${delta > 0 ? '+' + delta : '+0'}</span>
            </div>
          </div>
          <button class="attr-step plus" type="button" ${maxA <= 0 ? 'disabled' : ''}>＋</button>
          <div class="attr-quick-actions">
            <button class="attr-quick clear" type="button" ${delta <= 0 ? 'disabled' : ''}>清零</button>
            <button class="attr-quick max" type="button" ${maxA <= 0 || delta >= maxA ? 'disabled' : ''}>分满</button>
          </div>
        </div>
      `;
    }).join('');
    // ★ 事件委托（容器级）：render 重建 DOM 也不丢失绑定
    bindRowsDelegate(rows);
  }

  // ★ 事件委托：统一绑定 + / − / 拉条拖动 / 键盘（容器级，防重建失效）
  let _rowsBound = false;
  function bindRowsDelegate(rows) {
    if (!rows) return;
    if (_rowsBound) return;   // 容器级只绑一次
    _rowsBound = true;

    // +/− 按钮与快捷档位（点击）
    rows.addEventListener('click', (e) => {
      const q = e.target.closest('.attr-quick');
      if (q) {
        const row = q.closest('.alloc-row');
        if (!row || q.disabled) return;
        const key = row.dataset.key;
        if (q.classList.contains('clear')) alloc[key] = 0;
        else if (q.classList.contains('max')) alloc[key] = maxAllocFor(key, currentAttr());
        render();
        return;
      }
      const btn = e.target.closest('.attr-step');
      if (!btn) return;
      const row = btn.closest('.alloc-row');
      if (!row) return;
      const key = row.dataset.key;
      if (btn.classList.contains('plus')) stepAlloc(key, +1);
      else if (btn.classList.contains('minus')) stepAlloc(key, -1);
    });

    // 拉条拖动：Pointer Events（统一触摸/鼠标）
    // ★ 丝滑优化：rAF 节流 + 拖动开始缓存 rect + 滑块位置始终跟随鼠标（跟手，速度受鼠标控制）
    let drag = null;   // { key, row, track, rect, raf, lastClientX }
    // ★ 拖动气泡：显示当前目标分配值（跟随滑块）
    const updateBubble = (row, target, maxA, ratio) => {
      const track = row.querySelector('.attr-track');
      if (!track) return;
      let bub = row.querySelector('.attr-bubble');
      if (!bub) {
        bub = document.createElement('span');
        bub.className = 'attr-bubble';
        track.appendChild(bub);
      }
      const tr = track.getBoundingClientRect();
      bub.textContent = '+' + target;
      bub.style.left = Math.max(0, Math.min(tr.width, ratio * tr.width)) + 'px';
      bub.style.display = '';
    };
    const applyDrag = () => {
      if (!drag) return;
      drag.raf = null;
      const key = drag.key;
      const a = currentAttr();
      const rect = drag.rect;
      const ratio = Math.max(0, Math.min(1, (drag.lastClientX - rect.left) / rect.width));
      const maxA = maxAllocFor(key, a);
      // ★ 目标分配值：鼠标比例映射到可分配量并取整（严格 0..maxA）
      const target = Math.max(0, Math.min(maxA, Math.round(ratio * maxA)));
      alloc[key] = target;
      const row = drag.row;
      // ★ 滑块位置回弹到「分配量 / 可分配量」——与数值严格同步（杜绝视觉脱节）
      const r2 = maxA > 0 ? target / maxA : 0;
      const thumb = row.querySelector('.attr-thumb');
      const fill = row.querySelector('.attr-fill');
      if (thumb) thumb.style.left = (r2 * 100) + '%';
      if (fill) fill.style.width = (r2 * 100) + '%';
      // ★ readout：左新值 = 当前+加点；右 +delta（拖动中实时更新）
      const newValEl = row.querySelector('.attr-newval');
      if (newValEl) newValEl.textContent = (a[key] || 0) + target;
      const deltaEl = row.querySelector('.attr-delta');
      if (deltaEl) deltaEl.textContent = (target > 0 ? '+' + target : '+0');
      // ★ 顶部可分配点数随拉条实时变化
      const ptsEl = document.getElementById('allocPoints');
      if (ptsEl) ptsEl.textContent = remainPoints - Object.values(alloc).reduce((s, v) => s + v, 0);
      // 按钮态实时刷新（拖动中不整表重建）
      const plus = row.querySelector('.plus');
      const minus = row.querySelector('.minus');
      const clearBtn = row.querySelector('.attr-quick.clear');
      const maxBtn = row.querySelector('.attr-quick.max');
      if (plus) plus.disabled = maxA <= 0;
      if (minus) minus.disabled = target <= 0;
      if (clearBtn) clearBtn.disabled = target <= 0;
      if (maxBtn) maxBtn.disabled = maxA <= 0 || target >= maxA;
      updateBubble(row, target, maxA, ratio);
    };
    const scheduleDrag = (clientX) => {
      if (!drag) return;
      drag.lastClientX = clientX;
      if (drag.raf) return;                       // 已有排程 → 丢弃本次（rAF 合并）
      drag.raf = requestAnimationFrame(applyDrag);
    };

    rows.addEventListener('pointerdown', (e) => {
      const track = e.target.closest('.attr-track');
      if (!track) return;
      if (track.classList.contains('attr-disabled')) return;   // ★ 不可分配行不响应拖动
      e.preventDefault();
      const key = track.dataset.trackFor;
      if (!key) return;
      const rect = track.getBoundingClientRect();
      drag = { key, row: track.closest('.alloc-row'), track, rect, lastClientX: e.clientX };
      track.classList.add('dragging');   // ★ 拖动态（滑块放大 + 气泡）
      scheduleDrag(e.clientX);                    // 立即排程一次（点击定位）
      try { track.setPointerCapture(e.pointerId); } catch (err) {}
    });

    rows.addEventListener('pointermove', (e) => {
      if (!drag) return;
      scheduleDrag(e.clientX);                    // ★ rAF 节流，保持 60fps 流畅
    });

    rows.addEventListener('pointerup', (e) => {
      if (!drag) return;
      drag.lastClientX = e.clientX;
      if (drag.raf) { cancelAnimationFrame(drag.raf); drag.raf = null; }
      applyDrag();                                // 落点精确
      drag.track.classList.remove('dragging');
      const bub = drag.row.querySelector('.attr-bubble');
      if (bub) bub.remove();
      drag = null;
      render();                                   // 拖动结束统一刷新（保持按钮状态一致）
    });
    rows.addEventListener('pointercancel', () => {
      if (drag && drag.raf) cancelAnimationFrame(drag.raf);
      if (drag) {
        drag.track.classList.remove('dragging');
        const bub = drag.row.querySelector('.attr-bubble');
        if (bub) bub.remove();
      }
      drag = null;
      render();
    });

    // 键盘微调（可达性；Shift 步进 5）
    rows.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        const row = e.target.closest('.alloc-row');
        if (!row) return;
        e.preventDefault();
        const key = row.dataset.key;
        const step = e.shiftKey ? 5 : 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') stepAlloc(key, +step);
        else stepAlloc(key, -step);
      }
    });
  }

  function stepAlloc(key, dir) {
    const attr = currentAttr();
    const maxA = maxAllocFor(key, attr);
    if (dir > 0) { if (maxA <= 0) return; alloc[key] = Math.min(maxA, (alloc[key] || 0) + dir); }
    // ★ dir 为负（−1/−5）：相减，不能写 `- dir`（负数相减变相加，导致减号键加点）
    else { alloc[key] = Math.max(0, (alloc[key] || 0) + dir); }
    render();
  }

  function init() {
    if (document.getElementById('attrAllocateOverlay')) return;
    createDOM();
    if (window.socket) {
      window.socket.on('attrPointsApplied', (data) => {
        const ch = window.getCurrentCharacter && window.getCurrentCharacter();
        if (ch) { ch.attr = data.attr; ch.attrPoints = data.attrPoints; }
        (window.showToast || function(m){ alert(m); })('属性分配成功！');
        alloc = { str: 0, dex: 0, con: 0, int: 0, cha: 0, lck: 0 };
        showModal(overlay, false);
        if (window.CharDetail && window.CharDetail.refreshCurrent) window.CharDetail.refreshCurrent();
      });
      window.socket.on('error', ({ msg }) => {
        if (msg && /属性点/.test(msg) && overlay && overlay.classList.contains('active')) {
          (window.showToast || function(m){ alert(m); })(msg);
        }
      });
    }
  }

  window.AttrAllocate = {
    init,
    open: () => {
      init();
      const ch = window.getCurrentCharacter && window.getCurrentCharacter();
      if (!ch) { (window.showToast || function(m){ alert(m); })('请先选择角色'); return; }
      if (overlay) {
        overlay.classList.remove('embed');
        if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
      }
      alloc = { str: 0, dex: 0, con: 0, int: 0, cha: 0, lck: 0 };
      remainPoints = ch.attrPoints || 0;
      if (remainPoints <= 0) (window.showToast || function(m){ alert(m); })('暂无可分配的属性点（升级可获得）');
      render();     // ★ 空态由 render 居中占位（非仅 toast）
      showModal(overlay, true);
    },
    openEmbed: (containerId, force) => {
      init();
      const ch = window.getCurrentCharacter && window.getCurrentCharacter();
      if (!ch) { (window.showToast || function(m){ alert(m); })('请先选择角色'); return; }
      if (overlay) {
        overlay.classList.add('embed');   // ★ 关键：置为占满内嵌（否则仍是全屏 fixed 浮窗）
        if (overlay.dataset.embedParent !== containerId) {
          const p = document.getElementById(containerId);
          if (p) { p.appendChild(overlay); overlay.dataset.embedParent = containerId; }
        }
      }
      alloc = { str: 0, dex: 0, con: 0, int: 0, cha: 0, lck: 0 };
      remainPoints = ch.attrPoints || 0;
      render();
      showModal(overlay, true);
    },
    close: () => { if (overlay) showModal(overlay, false); }
  };
})();
