/**
 * settingsPanel.js — 全局设置面板（音效开关 / 主音量 / 恢复默认）
 *
 * 入口：任意带 class="btn-settings-open" 的按钮（副本外各页 header 右上角 + 副本界面左上角）
 * 面板：#settingsModal（index.html 内），独立弹窗界面
 * 依赖：window.Sfx（sound.js，静音/音量）
 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }

  function openSettings() {
    const modal = $('settingsModal');
    if (!modal) return;
    // 打开时同步 UI 与 Sfx 当前状态
    const sfx = window.Sfx;
    const muted = sfx ? sfx.isMuted() : false;
    const vol = sfx ? sfx.getVolume() : 0.8;
    const tg = $('setSfxToggle');
    if (tg) { tg.textContent = muted ? '已关闭' : '已开启'; tg.classList.toggle('off', muted); }
    const r = $('setVolume');
    if (r) r.value = String(Math.round(vol * 100));
    const v = $('setVolumeVal');
    if (v) v.textContent = Math.round(vol * 100) + '%';
    modal.classList.add('active');
  }
  function closeSettings() {
    const m = $('settingsModal');
    if (m) m.classList.remove('active');
  }

  function bind() {
    // ★ 事件委托：副本外 header 右上角 + 副本界面左上角 所有 .btn-settings-open 统一触发
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.btn-settings-open')) openSettings();
    });
    const close = $('btnCloseSettings');
    if (close) close.addEventListener('click', closeSettings);
    const modal = $('settingsModal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeSettings(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

    // 音效开关
    const tg = $('setSfxToggle');
    if (tg) tg.addEventListener('click', () => {
      const sfx = window.Sfx; if (!sfx) return;
      const muted = sfx.toggleMute();
      tg.textContent = muted ? '已关闭' : '已开启';
      tg.classList.toggle('off', muted);
      if (!muted && sfx.alert) sfx.alert(); // 开启时试听
    });
    // 主音量滑块
    const r = $('setVolume');
    if (r) r.addEventListener('input', () => {
      const sfx = window.Sfx; if (!sfx) return;
      const v = (parseInt(r.value, 10) || 0) / 100;
      sfx.setVolume(v);
      const val = $('setVolumeVal');
      if (val) val.textContent = Math.round(v * 100) + '%';
    });
    // 恢复默认
    const rs = $('setReset');
    if (rs) rs.addEventListener('click', () => {
      const sfx = window.Sfx; if (!sfx) return;
      if (sfx.isMuted()) sfx.toggleMute();
      sfx.setVolume(0.8);
      const t2 = $('setSfxToggle'); if (t2) { t2.textContent = '已开启'; t2.classList.remove('off'); }
      const r2 = $('setVolume'); if (r2) r2.value = '80';
      const v2 = $('setVolumeVal'); if (v2) v2.textContent = '80%';
      if (sfx.alert) sfx.alert();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
