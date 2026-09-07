/**
 * 属性分配模块 v6 — 自定义步进器 + 进度条（重做）
 *
 * 替代 noUiSlider：更直观的 +/- 步进 + 金色进度条 + 剩余点数实时提示
 *   - 单项范围 40-100
 *   - 六项总和 ≤ 260（剩余点数实时显示，耗尽后 + 禁用）
 *   - 进度条 fill = (val-40)/60*100%
 *
 * 暴露：window.AttrSlider.init() / .openModal() / .getValues()
 */
(function () {
  const TOTAL_POINTS = 260;
  const MIN = 40, MAX = 100;
  // ★ P0 六维属性：力量/敏捷/体力/智力/魅力/幸运（2026-08-23）
  const ATTRS = ['str', 'dex', 'con', 'int', 'cha', 'lck'];
  // ★ 幸运初始随机 1~10（每账号每角色随机），上限 10，不参与手动分配
  const INITIAL_VALUES = { str: 40, dex: 40, con: 40, int: 40, cha: 40, lck: Math.floor(Math.random() * 10) + 1 };

  const _values = Object.assign({}, INITIAL_VALUES);
  let _freePointsSpan = null;
  let _initialized = false;

  function _sumAll() { return ATTRS.reduce((s, k) => s + _values[k], 0); }
  function _remaining() { return TOTAL_POINTS - _sumAll(); }

  function _cap(key) { return key.charAt(0).toUpperCase() + key.slice(1); }

  /** 同步所有行：数值文本 + 进度条 + 按钮禁用态 + 剩余点数 */
  function _refreshUI() {
    const r = _remaining();
    if (_freePointsSpan) {
      _freePointsSpan.textContent = r;
      _freePointsSpan.style.color = r <= 0 ? '#e74c3c' : '#d4b860';
    }
    for (const k of ATTRS) {
      const v = _values[k];
      const valEl = document.getElementById('val' + _cap(k));
      if (valEl) valEl.textContent = v;
      const fill = document.getElementById('fill' + _cap(k));
      if (fill) fill.style.width = (k === 'lck' ? (v / 10) * 100 : (v - MIN) / (MAX - MIN) * 100) + '%';
      const row = document.querySelector('.attr-row[data-key="' + k + '"]');
      if (row) {
        const plus = row.querySelector('.plus');
        const minus = row.querySelector('.minus');
        if (plus) plus.disabled = (v >= MAX) || (r <= 0) || k === 'lck';
        if (minus) minus.disabled = (v <= MIN) || k === 'lck';
      }
    }
  }

  /** 步进：delta = +1 / -1，带边界与剩余点数约束 */
  function _change(key, delta) {
    if (key === 'lck') return;   // ★ 幸运初始随机 1~10，上限 10，不参与手动分配
    const target = _values[key] + delta;
    if (delta > 0 && _remaining() <= 0) return;   // 无剩余点数
    if (target < MIN || target > MAX) return;      // 边界
    _values[key] = target;
    _refreshUI();
  }

  /* ======== 初始化 ======== */
  function init() {
    if (_initialized) return;
    _freePointsSpan = document.getElementById('freePoints');
    document.querySelectorAll('.attr-row').forEach(row => {
      const key = row.dataset.key;
      if (!key || ATTRS.indexOf(key) < 0) return;
      const plus = row.querySelector('.plus');
      const minus = row.querySelector('.minus');
      if (plus) plus.addEventListener('click', () => _change(key, +1));
      if (minus) minus.addEventListener('click', () => _change(key, -1));
    });
    _refreshUI();
    _initialized = true;
    console.log('[AttrSlider v6] 步进器初始化完成');
  }

  function openModal() {
    if (!_initialized) init();
    for (const k of ATTRS) _values[k] = INITIAL_VALUES[k];
    _refreshUI();
  }

  function getValues() { return Object.assign({}, _values); }

  window.AttrSlider = { init, openModal, getValues };
})();

