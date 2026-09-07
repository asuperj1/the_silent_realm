/**
 * sceneLoader.js — 副本场景动态切换加载逻辑
 *
 * 职责：
 * 1. 维护"副本名 → 场景素材"映射表
 * 2. 监听 Socket 事件，在进入/离开副本房间时切换全屏背景图
 * 3. 根据副本类型叠加专属色调（深海蓝/腐朽绿/迷幻紫……）
 * 4. 提供 API 供其他模块触发场景切换
 *
 * 使用方式：
 *   在 index.html 中：
 *     <link rel="stylesheet" href="css/sceneSwitch.css">
 *     <div id="sceneBackground"></div>
 *     <div id="sceneOverlay" class="default-overlay"></div>
 *     <div id="sceneLabel"></div>
 *     <script src="js/sceneLoader.js"></script>
 *
 * 暴露：window.SceneLoader = { switchTo(copyName), clear(), getCopySceneMap() }
 */

(function() {
  'use strict';

  // ==================== 副本→场景素材映射（运行时由 /api/scenes 加载，单一数据源 config/scenes.json） ====================
  let sceneMap = {};

  // ==================== DOM 元素 ====================
  let sceneBg, sceneOverlay, sceneLabel;

  function ensureDOM() {
    if (!sceneBg) {
      sceneBg = document.getElementById('sceneBackground');
      sceneOverlay = document.getElementById('sceneOverlay');
      sceneLabel = document.getElementById('sceneLabel');

      // 如果 DOM 中不存在，自动创建注入
      if (!sceneBg) {
        sceneBg = document.createElement('div');
        sceneBg.id = 'sceneBackground';
        document.body.prepend(sceneBg);
      }
      if (!sceneOverlay) {
        sceneOverlay = document.createElement('div');
        sceneOverlay.id = 'sceneOverlay';
        sceneOverlay.className = 'default-overlay';
        document.body.prepend(sceneOverlay);
      }
      if (!sceneLabel) {
        sceneLabel = document.createElement('div');
        sceneLabel.id = 'sceneLabel';
        document.body.appendChild(sceneLabel);
      }
    }
  }

  // ==================== 当前状态 ====================
  let currentCopy = null;

  // ==================== 切换到指定副本场景 ====================
  function switchTo(copyName) {
    ensureDOM();

    const scene = sceneMap[copyName];

    if (!scene) {
      // 未知副本：恢复默认暗色背景
      clear();
      console.warn('[SceneLoader] 未知副本:', copyName);
      return;
    }

    // 相同副本不重复切换
    if (currentCopy === copyName) return;
    currentCopy = copyName;

    // ★ 不再设置全屏背景图（#sceneBackground 全屏层），场景图只显示在中间栏下方场景容器（#sceneBg）
    const middleSceneImg = document.getElementById('sceneBg');
    if (middleSceneImg) {
      middleSceneImg.src = scene.bgPath;
      middleSceneImg.style.display = 'block';
    }

    // 色调叠加
    sceneOverlay.className = scene.overlayClass;

    // 场景标签
    sceneLabel.textContent = scene.label;
    sceneLabel.classList.add('visible');
    // 3 秒后自动隐藏标签
    clearTimeout(sceneLabel._hideTimer);
    sceneLabel._hideTimer = setTimeout(() => {
      sceneLabel.classList.remove('visible');
    }, 4000);

    console.log(`[SceneLoader] 切换场景: ${copyName} → ${scene.label}`);
  }

  // ==================== 清除场景（退出副本时） ====================
  function clear() {
    ensureDOM();
    currentCopy = null;
    // ★ 不再操作全屏背景层（#sceneBackground），仅重置色调叠加与场景标签
    sceneOverlay.className = 'default-overlay';
    sceneLabel.classList.remove('visible');
    console.log('[SceneLoader] 已清除场景');
  }

  // ==================== 获取映射表（供服务端查询） ====================
  function getCopySceneMap() {
    return sceneMap;
  }

  // ==================== Socket 事件绑定 ====================
  function bindSocketEvents() {
    const socket = window.socket;
    if (!socket) {
      // socket 可能还没初始化，延迟重试
      setTimeout(bindSocketEvents, 500);
      return;
    }

    // 进入副本（游戏开始）
    socket.on('copyStart', (data) => {
      if (data && data.copyName) {
        switchTo(data.copyName);
      }
    });

    // 加入大厅房间（返回大厅或首次加入）—— 清除场景
    socket.on('roomJoined', (data) => {
      // 如果是大厅房间（非游戏房间），清除场景
      if (data && !data.copyState) {
        clear();
      }
      // 预加载场景图
      if (data && data.copyName) {
        const scene = sceneMap[data.copyName];
        if (scene) {
          const img = new Image();
          img.src = scene.bgPath;
        }
      }
    });

    // 房间被解散
    socket.on('roomDissolved', () => {
      clear();
    });

    // 副本结算后返回
    socket.on('copySettlement', () => {
      // 结算弹窗关闭后清除场景
      setTimeout(() => clear(), 1500);
    });

    console.log('[SceneLoader] Socket 事件已绑定');
  }

  // ==================== 暴露 API ====================
  window.SceneLoader = {
    switchTo,
    clear,
    getCopySceneMap
  };

  // ==================== 初始化 ====================
  function init() {
    ensureDOM();
    // 先绑定 socket 事件，避免事件早于 fetch 完成而丢失
    bindSocketEvents();

    // 运行时加载场景映射（单一数据源：config/scenes.json）
    fetch('/api/scenes')
      .then(res => res.json())
      .then(data => {
        if (data && data.success && data.scenes) {
          sceneMap = data.scenes;
          console.log(`[SceneLoader] 场景映射已加载: ${Object.keys(sceneMap).length} 条`);
        } else {
          sceneMap = {};
          clear();
          console.warn('[SceneLoader] /api/scenes 响应异常，回退空映射');
        }
      })
      .catch(err => {
        sceneMap = {};
        clear();
        console.warn('[SceneLoader] /api/scenes 加载失败，回退空映射:', err.message);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
