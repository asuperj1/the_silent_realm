/**
 * bgSwitcher.js — 副本房间背景切换模块
 *
 * 职责：
 * 1. 维护前三副本（废都800、渔村900）的背景图池
 * 2. 监听 copyStart / roomJoined 事件，在对应副本中显示背景切换控件
 * 3. 更新 #sceneBackground 实现全屏背景切换
 * 4. 日之塔1000 及后四副本不介入，维持原有背景
 *
 * 依赖：window.socket、#sceneBackground（由 sceneLoader.js 管理）
 * 暴露：window.BgSwitcher = { setDungeonBg(dungeonName), clear() }
 */

(function() {
  'use strict';

  // ==================== 副本→背景池映射 ====================
  // ★ 青峰山副本的中间栏场景图由 qingfengMap.js 按车厢移动接管，故不在此池。
  const DUNGEON_BG_POOL = {
    '渔村纪元900｜雾潮潮间渔村': [
      { path: 'assets/渔村码头水下触手场景.png', label: '码头水下触手' },
      { path: 'assets/渔村废弃小屋.png', label: '渔村废弃小屋' },
      { path: 'assets/印斯茅斯海底.png', label: '印斯茅斯海底' }
    ]
    // 日之塔1000 及后四副本不在此列，不启用背景切换
  };

  // ==================== DOM 引用 ====================
  let bgSwitcherPanel, bgSwitcherThumbs;
  let currentDungeon = null;
  let currentBgIndex = 0;

  // ==================== 初始化 DOM ====================
  function ensureDOM() {
    bgSwitcherPanel = document.getElementById('bgSwitcherPanel');
    bgSwitcherThumbs = document.getElementById('bgSwitcherThumbs');
    return true;
  }

  // ==================== 设置背景 ====================
  function applyBackground(bgPath) {
    // ★ 场景图只显示在中间栏下方场景容器（#sceneBg），不再铺全屏背景层
    const middleSceneImg = document.getElementById('sceneBg');
    if (middleSceneImg) {
      // 预加载新图片
      const preload = new Image();
      preload.onload = function() {
        // 淡出 → 换图 → 淡入
        middleSceneImg.style.opacity = '0';
        middleSceneImg.style.transition = 'opacity 0.35s ease-in-out';
        // 等待淡出完成后换图
        const onFadeOut = function() {
          middleSceneImg.removeEventListener('transitionend', onFadeOut);
          middleSceneImg.src = bgPath;
          middleSceneImg.onerror = function() {
            this.src = 'assets/placeholder.png';
            console.warn('[BgSwitcher] 场景图加载失败，使用占位图:', bgPath);
          };
          // 淡入
          requestAnimationFrame(() => {
            middleSceneImg.style.opacity = '1';
          });
        };
        middleSceneImg.addEventListener('transitionend', onFadeOut, { once: true });
        // 兜底：如果 transitionend 在 500ms 内未触发，直接换图
        setTimeout(() => {
          middleSceneImg.removeEventListener('transitionend', onFadeOut);
          if (middleSceneImg.style.opacity === '0') {
            onFadeOut();
          }
        }, 500);
      };
      preload.onerror = function() {
        middleSceneImg.src = 'assets/placeholder.png';
        middleSceneImg.style.opacity = '1';
        console.warn('[BgSwitcher] 场景图加载失败，使用占位图:', bgPath);
      };
      preload.src = bgPath;
    }
  }

  // ==================== 自动应用背景（已移除手动缩略图切换） ====================
  function showPanel(dungeonName) {
    const pool = DUNGEON_BG_POOL[dungeonName];
    if (!pool || pool.length === 0) return;
    currentDungeon = dungeonName;
    currentBgIndex = 0;
    // 自动应用默认第一张背景（由 API/副本状态驱动，无手动切换 UI）
    applyBackground(pool[0].path);
  }

  function hidePanel() {
    currentDungeon = null;
  }



  // ==================== Socket 事件绑定 ====================
  function bindSocketEvents() {
    const socket = window.socket;
    if (!socket) {
      setTimeout(bindSocketEvents, 500);
      return;
    }

    // 进入副本 → 显示对应背景池（sceneSwitchEnable=false 时不显示）
    socket.on('copyStart', (data) => {
      if (data && data.copyName) {
        // 副本配置了 sceneSwitchEnable=false 时强制隐藏面板
        if (data.sceneSwitchEnable === false) {
          hidePanel();
          return;
        }
        const pool = DUNGEON_BG_POOL[data.copyName];
        if (pool) {
          showPanel(data.copyName);
        } else {
          hidePanel();
        }
      }
    });

    // 返回大厅 / 首次加入大厅房间 → 隐藏切换面板
    socket.on('roomJoined', (data) => {
      if (data && !data.copyState) {
        hidePanel();
      }
    });

    // 房间解散 / 副本结算 → 隐藏面板
    socket.on('roomDissolved', () => hidePanel());
    socket.on('copySettlement', () => {
      setTimeout(() => hidePanel(), 1500);
    });
    socket.on('leftRoom', () => hidePanel());
  }

  // ==================== 暴露 API ====================
  window.BgSwitcher = {
    /** 手动设置副本背景（供外部模块调用） */
    setDungeonBg(dungeonName) {
      const pool = DUNGEON_BG_POOL[dungeonName];
      if (pool) {
        showPanel(dungeonName);
      }
    },
    /** 清除背景，恢复默认 */
    clear() {
      hidePanel();
    },
    /** 获取当前副本的背景池 */
    getPool(dungeonName) {
      return DUNGEON_BG_POOL[dungeonName] || null;
    }
  };

  // ==================== 自动初始化 ====================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureDOM();
      bindSocketEvents();
    });
  } else {
    ensureDOM();
    bindSocketEvents();
  }

  console.log('[BgSwitcher] 模块已加载，支持副本：', Object.keys(DUNGEON_BG_POOL).join(', '));
})();
