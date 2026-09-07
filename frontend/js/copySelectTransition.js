/**
 * copySelectTransition.js — 飞页过渡动画引擎
 *
 * 副本选择页 → 游戏页的羊皮纸封合过渡效果。
 * 4 阶段异步动画（~1.3s），与登录扉页的暗金流光风格统一。
 *
 * 暴露：window.CopySelectTransition = { play(onComplete) }
 *
 * 注意：飞页 overlay 在 body 级别（position:fixed; z-index:9999），
 * 不依赖 #pageCopySelect 生命周期。
 */
(function() {
  'use strict';

  // ==================== DOM 注入（惰性创建，首次调用时注入 body） ====================
  let _overlay = null;
  let _hasInjected = false;

  function ensureOverlay() {
    if (_overlay) return _overlay;

    _overlay = document.createElement('div');
    _overlay.id = 'copyParchmentOverlay';
    _overlay.className = 'parchment-transition-overlay';
    _overlay.innerHTML = `
      <div class="parchment-transition-stage">
        <div class="parchment-transition-left"></div>
        <div class="parchment-transition-right"></div>
        <div class="parchment-transition-spine"></div>
      </div>
      <!-- 书脊闪光金色流光 -->
      <div class="parchment-transition-beams">
        <div class="gold-beam tl"></div>
        <div class="gold-beam tr"></div>
        <div class="gold-beam bl"></div>
        <div class="gold-beam br"></div>
        <div class="gold-beam-diag d1"></div>
        <div class="gold-beam-diag d2"></div>
      </div>
    `;
    document.body.appendChild(_overlay);
    _hasInjected = true;
    return _overlay;
  }

  // ==================== 过渡流程 ====================
  /**
   * 播放飞页过渡动画
   * @param {Function} onComplete - 过渡完成后回调（执行页面切换）
   */
  function play(onComplete) {
    const overlay = ensureOverlay();
    const left = overlay.querySelector('.parchment-transition-left');
    const right = overlay.querySelector('.parchment-transition-right');
    const spine = overlay.querySelector('.parchment-transition-spine');
    const beams = overlay.querySelector('.parchment-transition-beams');

    // 重置动画状态
    overlay.classList.remove('closing', 'done');
    if (left) { left.style.animation = 'none'; left.offsetHeight; }
    if (right) { right.style.animation = 'none'; right.offsetHeight; }

    // ★ 阶段0：显示遮罩（0ms）
    overlay.classList.add('active');

    // ★ 阶段1：飞页翻开（0ms → 400ms）—— 从中间向两侧打开
    requestAnimationFrame(() => {
      if (left) left.style.animation = 'parchmentLeftOpen 0.4s ease-in forwards';
      if (right) right.style.animation = 'parchmentRightOpen 0.4s ease-in forwards';
    });

    // ★ 阶段2：飞页封合（450ms → 900ms）—— 两页从两侧翻入覆盖画面
    setTimeout(() => {
      overlay.classList.add('closing');
      if (left) { left.style.animation = 'none'; left.offsetHeight; left.style.animation = 'parchmentLeftSeal 0.45s ease-in forwards'; }
      if (right) { right.style.animation = 'none'; right.offsetHeight; right.style.animation = 'parchmentRightSeal 0.45s ease-in forwards'; }
      // 激活光束
      if (beams) beams.classList.add('active');
    }, 450);

    // ★ 阶段3：书脊闪光（900ms → 1150ms）
    setTimeout(() => {
      if (spine) {
        spine.style.animation = 'none';
        spine.offsetHeight;
        spine.style.animation = 'spineFlash 0.25s ease-out forwards';
      }
    }, 900);

    // ★ 阶段4：遮罩淡出 + 切换页面（1150ms）
    setTimeout(() => {
      overlay.classList.add('done');
      if (beams) beams.classList.remove('active');

      // 执行页面切换回调
      if (typeof onComplete === 'function') {
        onComplete();
      }

      // 清理（延迟确保淡出动画完成）
      setTimeout(() => {
        overlay.classList.remove('active', 'closing', 'done');
        if (left) left.style.animation = '';
        if (right) right.style.animation = '';
        if (spine) spine.style.animation = '';
        if (window.IsometricBg?.stop) window.IsometricBg.stop();
      }, 300);
    }, 1150);
  }

  // ==================== 公开 API ====================
  window.CopySelectTransition = { play };
})();
