/**
 * obeliskAnim.js — 方尖碑 GIF 动图引擎
 *
 * 加载单张 GIF 动图（浏览器原生循环播放），
 * 无需手动轮播逻辑。
 * 加载失败回退占位，加载成功自动开始播放。
 *
 * 暴露：window.ObeliskAnim = { init(), start(), stop(), getCurrentFrame(), onFrameChange() }
 */
(function() {
  'use strict';

  const GIF_PATH = 'assets/heibai1.gif';

  // ==================== 状态 ====================
  let container = null;
  let imgEl = null;
  let loaded = false;
  let running = false;
  let listeners = [];

  // ==================== DOM 构建 ====================
  function _buildDOM() {
    if (!container) return;

    container.innerHTML = '';

    const inner = document.createElement('div');
    inner.className = 'obelisk-inner';

    const img = document.createElement('img');
    img.className = 'obelisk-frame';
    img.src = GIF_PATH;
    img.alt = '方尖碑';
    img.onerror = function() {
      console.warn('[ObeliskAnim] GIF 加载失败，回退占位');
      img.style.display = 'none';
    };
    img.onload = function() {
      loaded = true;
      window.dispatchEvent(new CustomEvent('obeliskReady'));
    };
    inner.appendChild(img);
    imgEl = img;

    const base = document.createElement('div');
    base.className = 'obelisk-base';

    container.appendChild(base);
    container.appendChild(inner);
  }

  // ==================== 公开 API ====================
  function init(selector) {
    container = document.querySelector(selector || '#obelisk');
    if (!container) {
      console.error('[ObeliskAnim] 容器未找到:', selector);
      return;
    }
    _buildDOM();
  }

  function start() {
    if (!loaded) {
      const onReady = function() {
        window.removeEventListener('obeliskReady', onReady);
        _doStart();
      };
      window.addEventListener('obeliskReady', onReady);
      return;
    }
    _doStart();
  }

  function _doStart() {
    if (running) return;
    running = true;
    // GIF 由浏览器自动循环播放，无需手动调度
  }

  function stop() {
    running = false;
  }

  function getCurrentFrame() {
    return 0;
  }

  /** 注册帧切换回调：兼容旧接口，GIF 动图不需要此回调 */
  function onFrameChange(fn) {
    if (typeof fn === 'function') {
      listeners.push(fn);
    }
  }

  window.ObeliskAnim = { init, start, stop, getCurrentFrame, onFrameChange };
})();
