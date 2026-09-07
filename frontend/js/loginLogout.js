/**
 * loginLogout.js — 统一退出登录方法
 *
 * 提供全局 window.doLogout() 供所有页面调用。
 * 职责：清空 Token、销毁房间数据、清除缓存后强制跳转标准登录页。
 *
 * 使用方式：
 *   <script src="/js/loginLogout.js"></script>
 *   然后任意处调用：window.doLogout();
 */

(function () {
  'use strict';

  /**
   * 统一退出登录
   * - 清除所有 localStorage 认证数据
   * - 清除 sessionStorage
   * - 销毁房间状态
   * - 强制跳转寂静之地标准登录页
   */
  function doLogout() {
    // 1. 清除认证令牌
    localStorage.removeItem('token');
    localStorage.removeItem('coc_token');
    localStorage.removeItem('coc_username');
    localStorage.removeItem('playerUID');

    // 2. 清除房间 & 对局快照
    localStorage.removeItem('coc_roomId');
    localStorage.removeItem('coc_gameState');
    localStorage.removeItem('coc_resume_characterUid');

    // 3. 清除头像缓存
    localStorage.removeItem('coc_avatars');

    // 4. ★ 标记退出回流场景 → 扉页展示"欢迎回来"文案
    localStorage.setItem('coc_cover_scene', 'logout_return');

    // 5. 清除所有 sessionStorage（含扉页通过标记）
    try { sessionStorage.clear(); } catch (e) { /* noop */ }

    // 6. ★ 跳转扉页（由扉页自动引导至登录页）
    try {
      window.location.replace('/');
    } catch (e) {
      window.location.href = '/';
    }
  }

  // 暴露全局
  window.doLogout = doLogout;

  // ★ 也暴露为 ES 模块兼容（供 type="module" 使用）
  if (typeof window.__loginLogoutExports === 'undefined') {
    window.__loginLogoutExports = { doLogout };
  }

  console.log('[loginLogout] 统一退出登录工具已加载');
})();
