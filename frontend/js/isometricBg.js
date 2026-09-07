/**
 * isometricBg.js — 等距瓦片动态背景引擎
 *
 * 分层渲染 11 张 OFDN 等距 PNG 瓦片，驱动 10.5s 无缝循环动画。
 * 用于副本选择页面 (#pageCopySelect) 全屏背景。
 *
 * 暴露：window.IsometricBg = { init(canvasId), start(), stop(), resize() }
 */
(function() {
  'use strict';

  // ==================== 瓦片路径 ====================
  const TILE_DIR = 'assets/isometric_tile/';
  const TILE_NAMES = [
    'OFDN Isometric Tile 01.png', 'OFDN Isometric Tile 02.png',
    'OFDN Isometric Tile 03.png', 'OFDN Isometric Tile 04.png',
    'OFDN Isometric Tile 05.png', 'OFDN Isometric Tile 06.png',
    'OFDN Isometric Tile 07.png', 'OFDN Isometric Tile 08.png',
    'OFDN Isometric Tile 09.png', 'OFDN Isometric Tile 10.png',
    'OFDN Isometric Tile 11.png'
  ];
  // 0-4:地面 5-6:山体 7-10:异象

  // ==================== 时序常量（3x 加速：10.5s → 3.5s 完整循环） ====================
  const PHASE_DURATION = 700;    // 每 phase 0.7s
  const STATIC_DURATION = 500;   // 静态 0.5s
  const FADE_DURATION = 200;     // 交叉淡入淡出 0.2s
  const CYCLE_DURATION = 3500;   // 完整循环 3.5s
  const GROUND_CYCLE = [0, 1, 2, 3, 4]; // Tile 索引（01~05）
  const ANOMALY_MAP = [7, 8, 9, 10, -1]; // Tile08/09/10/11/空

  // ==================== 状态 ====================
  let canvas, ctx;
  let tiles = [];          // 预加载的 Image 对象
  let loaded = false;
  let running = false;
  let rafId = null;
  let canvasW = 0, canvasH = 0;

  // 动画变量
  let startTime = 0;
  let groundOffsetX = 0, groundOffsetY = 0;

  // 瓦片天然尺寸（加载后设定）
  let tileW = 256, tileH = 256;

  // ★ T-1: delta 钳制 — 防止标签页后台恢复时大跳帧
  let _lastElapsed = 0;
  let _elapsedAcc = 0;

  // ★ T-1: 粒子轨道预计算
  const PARTICLE_COUNT = 8;
  let _particles = null;
  function _initParticles() {
    _particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      _particles.push({
        angleSpeed: 0.0006 + Math.random() * 0.0003,
        phase: i * Math.PI * 0.25,
        distBase: 0.65 + Math.random() * 0.15,
        distAmp: 0.15 + Math.random() * 0.1,
        distFreq: 0.002 + Math.random() * 0.001,
        alphaSpeed: 0.004 + Math.random() * 0.002,
        alphaPhase: i * 1.3
      });
    }
  }

  // ★ T-1: 红色流光瓦片离屏缓存
  let _anomalyOffscreen = null;
  let _anomalyOffscreenCtx = null;
  let _anomalyCacheKey = '';

  // ==================== 图片预加载 ====================
  function loadTiles() {
    return Promise.all(TILE_NAMES.map((name, i) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          tiles[i] = img;
          if (i < 5 && img.naturalWidth > 0) {
            tileW = img.naturalWidth;
            tileH = img.naturalHeight;
          }
          resolve();
        };
        img.onerror = () => {
          console.warn('[IsometricBg] 瓦片加载失败:', name);
          tiles[i] = null;
          resolve(); // 不阻塞其他瓦片
        };
        img.src = TILE_DIR + name;
      });
    }));
  }

  // ==================== 主绘制循环（ADR-005: 纯黑底+暗角，旧渲染逻辑已注释保留） ====================
  function draw(timestamp) {
    if (!running) return;
    if (!startTime) { startTime = timestamp; _lastElapsed = 0; _elapsedAcc = 0; }
    rafId = requestAnimationFrame(draw);

    // delta 钳制，防止标签页后台恢复跳帧（最大 100ms 步进）
    const rawElapsed = timestamp - startTime;
    const delta = Math.min(rawElapsed - _lastElapsed, 100);
    _elapsedAcc += delta;
    _lastElapsed = rawElapsed;

    // 纯黑底
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // 四角暗角（极淡 vignette）
    const vignette = ctx.createRadialGradient(canvasW/2, canvasH/2, canvasW*0.45, canvasW/2, canvasH/2, canvasW*0.9);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // 顶部25%灰度条（UI预留区域过渡）
    const topGrad = ctx.createLinearGradient(0, 0, 0, canvasH * 0.25);
    topGrad.addColorStop(0, 'rgba(8,6,5,0.7)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, canvasW, canvasH * 0.25);
  }

  /* ====== ADR-005: 以下旧渲染逻辑注释保留，便于回滚 ======

  // ==================== 山体远景 ====================
  function drawMountains() {
    ctx.save();
    ctx.globalAlpha = 0.4;

    // Tile06 左上区域
    if (tiles[5]) {
      const mw = canvasW * 0.65;
      const mh = canvasH * 0.4;
      ctx.drawImage(tiles[5], -mw * 0.1, -mh * 0.05, mw, mh);
    }
    // Tile07 右上区域
    if (tiles[6]) {
      const mw = canvasW * 0.55;
      const mh = canvasH * 0.38;
      ctx.drawImage(tiles[6], canvasW - mw * 0.85, -mh * 0.02, mw, mh);
    }
    ctx.restore();

    // 雾气漂移
    drawMist();
  }

  function drawMist() {
    const now = performance.now();
    const fogOffset = (now * 0.04) % canvasW;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const x = ((fogOffset + i * canvasW * 0.38) % canvasW) - canvasW * 0.05;
      const grad = ctx.createLinearGradient(x, 0, x + canvasW * 0.25, 0);
      grad.addColorStop(0, 'rgba(30,20,35,0.18)');
      grad.addColorStop(0.5, 'rgba(25,18,30,0.08)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, canvasW * 0.25, canvasH * 0.45);
    }
    ctx.restore();
  }

  // ==================== 地面基底 ====================
  function drawGroundLayer(curIdx, nextIdx, fadeT, cycleT) {
    ctx.save();

    // 快速斜向偏移（3x 加速）
    groundOffsetX = ((cycleT * 0.012) % canvasW + canvasW) % canvasW;
    groundOffsetY = ((cycleT * 0.0075) % canvasH + canvasH) % canvasH;

    // 菱形等距网格铺满画布
    const tw = tileW * 0.8;
    const th = tileH * 0.8;
    const stepX = tw * 0.75;
    const stepY = th * 0.5;

    // 当前 tile
    const curTile = tiles[GROUND_CYCLE[curIdx]];
    // 下一个 tile
    const nextTile = tiles[GROUND_CYCLE[nextIdx]];

    const cols = Math.ceil(canvasW / stepX) + 3;
    const rows = Math.ceil(canvasH / stepY) + 3;
    const startCol = Math.floor(-groundOffsetX / stepX) - 1;
    const startRow = Math.floor(-groundOffsetY / stepY) - 1;

    for (let row = startRow; row < startRow + rows; row++) {
      for (let col = startCol; col < startCol + cols; col++) {
        const dx = col * stepX + (row % 2) * stepX * 0.5 + groundOffsetX % stepX;
        const dy = row * stepY + groundOffsetY % stepY;

        // 超出画布则跳过
        if (dx > canvasW + tw || dx + tw < -tw || dy > canvasH + th || dy + th < -th) continue;

        // 重叠1px消除缝隙
        if (curTile) {
          ctx.globalAlpha = 1 - fadeT;
          ctx.drawImage(curTile, dx - 1, dy - 1, tw + 2, th + 2);
        }
      }
    }

    // 下一 phase tile 叠加（交叉淡入淡出时可见）
    if (fadeT > 0 && nextTile) {
      for (let row = startRow; row < startRow + rows; row++) {
        for (let col = startCol; col < startCol + cols; col++) {
          const dx = col * stepX + (row % 2) * stepX * 0.5 + groundOffsetX % stepX;
          const dy = row * stepY + groundOffsetY % stepY;
          if (dx > canvasW + tw || dx + tw < -tw || dy > canvasH + th || dy + th < -th) continue;
          ctx.globalAlpha = fadeT;
          ctx.drawImage(nextTile, dx - 1, dy - 1, tw + 2, th + 2);
        }
      }
    }

    // ---- 径向遮罩：隐藏方尖碑下方地面瓦片 ----
    const maskCx = canvasW / 2;
    const maxDim = Math.min(canvasW, canvasH);
    const anomalyW = maxDim * 0.3;
    const maskRadius = anomalyW * 0.75;
    const verticalRange = canvasH * 0.45;
    const verticalBase = canvasH * 0.28;
    const maskCy = verticalBase + verticalRange / 2;

    const maskGrad = ctx.createRadialGradient(maskCx, maskCy, maskRadius * 0.55, maskCx, maskCy, maskRadius);
    maskGrad.addColorStop(0, 'rgba(10,9,8,1)');
    maskGrad.addColorStop(0.65, 'rgba(10,9,8,0.85)');
    maskGrad.addColorStop(1, 'rgba(10,9,8,0)');
    ctx.fillStyle = maskGrad;
    ctx.fillRect(maskCx - maskRadius, maskCy - maskRadius, maskRadius * 2, maskRadius * 2);

    ctx.restore();
  }

  // ==================== 中央异象层 ====================
  function drawAnomalyLayer(curIdx, nextIdx, fadeT, timestamp) {
    const curAnomaly = ANOMALY_MAP[curIdx];
    const nextAnomaly = ANOMALY_MAP[nextIdx];

    const maxDim = Math.min(canvasW, canvasH);
    const anomalyW = maxDim * 0.3;
    // 计算缩放
    let scale = 1;
    if (tiles[7]) {
      scale = anomalyW / tiles[7].naturalWidth;
    }

    const aw = anomalyW;
    const ah = anomalyW; // 保持正方形
    const cx = (canvasW - aw) / 2;
    // 垂直范围：30%~75% 之间，顶部25%留给UI
    const verticalRange = canvasH * 0.45;
    const verticalBase = canvasH * 0.28;
    const floatOffset = Math.sin(timestamp * 0.001) * canvasH * 0.02;
    const cy = verticalBase + verticalRange / 2 - ah / 2 + floatOffset;

    ctx.save();

    // 当前异象
    if (curAnomaly >= 0 && tiles[curAnomaly]) {
      ctx.globalAlpha = 1 - fadeT;
      drawAnomalyTile(curAnomaly, cx, cy, aw, ah, timestamp);
    }

    // 下一异象（交叉淡入淡出）
    if (fadeT > 0 && nextAnomaly >= 0 && tiles[nextAnomaly]) {
      ctx.globalAlpha = fadeT;
      drawAnomalyTile(nextAnomaly, cx, cy, aw, ah, timestamp);
    }

    ctx.restore();
  }

  function drawAnomalyTile(idx, x, y, w, h, timestamp) {
    ctx.drawImage(tiles[idx], x, y, w, h);

    // ★ T-3: 红色流光辐射增强（Tile09=8 和 Tile11=10 有红色区域）
    if (idx === 8 || idx === 10) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const r = Math.min(w, h) * 0.48;

      // 第1层：核心白热脉冲（内→外，高亮中心）
      const pulse1 = 0.2 + Math.sin(timestamp * 0.005) * 0.15;
      const grad1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.3);
      grad1.addColorStop(0, `rgba(255,80,20,${pulse1 + 0.55})`);
      grad1.addColorStop(0.4, `rgba(220,40,15,${pulse1 + 0.2})`);
      grad1.addColorStop(1, 'rgba(180,20,10,0)');
      ctx.fillStyle = grad1;
      ctx.fillRect(x, y, w, h);

      // 第2层：猩红辐射中圈（r×0.15 → r×0.9）
      const pulse2 = 0.1 + Math.sin(timestamp * 0.0035 + Math.PI * 0.7) * 0.12;
      const grad2 = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r * 0.9);
      grad2.addColorStop(0, `rgba(200,20,10,${pulse2 + 0.35})`);
      grad2.addColorStop(0.5, `rgba(160,15,20,${pulse2 + 0.15})`);
      grad2.addColorStop(1, 'rgba(100,10,15,0)');
      ctx.fillStyle = grad2;
      ctx.fillRect(x, y, w, h);

      // 第3层：暗红余晖远圈（r×0.5 → r×2.0）
      const pulse3 = 0.06 + Math.sin(timestamp * 0.0028 + Math.PI * 0.3) * 0.08;
      const grad3 = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.0);
      grad3.addColorStop(0, `rgba(120,10,20,${pulse3 + 0.2})`);
      grad3.addColorStop(0.5, `rgba(60,5,10,${pulse3 + 0.08})`);
      grad3.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad3;
      ctx.fillRect(cx - r * 2.0, cy - r * 2.0, r * 4.0, r * 4.0);

      // 第4层：远端光晕（r×1.5 → r×2.8）
      const pulse4 = 0.03 + Math.sin(timestamp * 0.002 + Math.PI * 0.5) * 0.05;
      const grad4 = ctx.createRadialGradient(cx, cy, r * 1.5, cx, cy, r * 2.8);
      grad4.addColorStop(0, `rgba(60,5,10,${pulse4 + 0.1})`);
      grad4.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad4;
      ctx.fillRect(cx - r * 2.8, cy - r * 2.8, r * 5.6, r * 5.6);

      // ★ 放射状光线（12条楔形射线旋转）
      const rayCount = 12;
      for (let i = 0; i < rayCount; i++) {
        const rayAngle = (timestamp * 0.0004 + i * Math.PI * 2 / rayCount) % (Math.PI * 2);
        const rayAlpha = 0.06 + Math.sin(timestamp * 0.003 + i) * 0.04;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rayAngle);
        const rayGrad = ctx.createLinearGradient(0, 0, r * 2.2, 0);
        rayGrad.addColorStop(0, `rgba(240,60,20,${rayAlpha + 0.12})`);
        rayGrad.addColorStop(0.25, `rgba(200,30,15,${rayAlpha + 0.06})`);
        rayGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rayGrad;
        ctx.fillRect(0, -4, r * 2.2, 8);
        ctx.restore();
      }

      // ★ 双扫掠光带（加宽，不同相位）
      ctx.save();
      ctx.globalCompositeOperation = 'color-dodge';
      for (let s = 0; s < 2; s++) {
        const sweepPhase = s * h * 0.7;
        const sweepY = ((timestamp * 0.06 + sweepPhase) % (h * 1.4)) - h * 0.2 + y;
        const sweepH = h * 0.28;
        const sweepGrad = ctx.createLinearGradient(0, sweepY - sweepH, 0, sweepY + sweepH);
        sweepGrad.addColorStop(0, 'rgba(200,30,20,0)');
        sweepGrad.addColorStop(0.4, 'rgba(240,50,20,0.22)');
        sweepGrad.addColorStop(0.6, 'rgba(240,50,20,0.22)');
        sweepGrad.addColorStop(1, 'rgba(200,30,20,0)');
        ctx.fillStyle = sweepGrad;
        ctx.fillRect(x, sweepY - sweepH, w, sweepH * 2);
      }
      ctx.restore();

      // ★ T-1: 粒子 — 使用预计算轨道
      if (!_particles) _initParticles();
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = _particles[i];
        const angle = (timestamp * p.angleSpeed + p.phase) % (Math.PI * 2);
        const dist = r * (p.distBase + Math.sin(timestamp * p.distFreq) * p.distAmp);
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist * 0.8;
        const alpha = 0.15 + Math.sin(timestamp * p.alphaSpeed + p.alphaPhase) * 0.12;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240,60,30,${alpha})`;
        ctx.fill();
      }
    }
  }

  // ==================== T-4: 红色锯齿光带背景 ====================
  function drawRedZigzagBands(timestamp) {
    const bandCount = 12;
    const bandSpacing = canvasH / (bandCount + 1);
    const zigzagAmplitude = 18;
    const zigzagPeriod = 80;

    ctx.save();
    ctx.globalAlpha = 0.22;

    for (let b = 0; b < bandCount; b++) {
      const baseY = bandSpacing * (b + 1);

      ctx.beginPath();
      ctx.moveTo(0, baseY);

      for (let x = 0; x <= canvasW; x += zigzagPeriod * 0.5) {
        const seg = Math.floor(x / (zigzagPeriod * 0.5));
        const dir = (seg % 2 === 0) ? 1 : -1;
        const y = baseY + dir * zigzagAmplitude;
        ctx.lineTo(x, y);
      }

      const bandGrad = ctx.createLinearGradient(0, baseY - 6, 0, baseY + 6);
      bandGrad.addColorStop(0, 'rgba(60,10,12,0)');
      bandGrad.addColorStop(0.4, 'rgba(140,20,18,0.35)');
      bandGrad.addColorStop(0.6, 'rgba(140,20,18,0.35)');
      bandGrad.addColorStop(1, 'rgba(60,10,12,0)');
      ctx.strokeStyle = bandGrad;
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRedBandGlints(timestamp) {
    const bandCount = 12;
    const bandSpacing = canvasH / (bandCount + 1);
    const glintSpeed = 0.06;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let b = 0; b < bandCount; b++) {
      const baseY = bandSpacing * (b + 1);

      // 主亮斑
      const glintX = ((timestamp * glintSpeed + b * 200) % (canvasW + 300)) - 150;
      const glintGrad = ctx.createRadialGradient(glintX, baseY, 0, glintX, baseY, 45);
      glintGrad.addColorStop(0, 'rgba(255,80,40,0.65)');
      glintGrad.addColorStop(0.25, 'rgba(220,40,20,0.28)');
      glintGrad.addColorStop(0.6, 'rgba(120,15,10,0.06)');
      glintGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glintGrad;
      ctx.fillRect(glintX - 45, baseY - 45, 90, 90);

      // 次级亮斑（延迟画布1/3宽度）
      const glintX2 = ((glintX + canvasW * 0.33) % (canvasW + 300)) - 150;
      const glintGrad2 = ctx.createRadialGradient(glintX2, baseY, 0, glintX2, baseY, 30);
      glintGrad2.addColorStop(0, 'rgba(255,60,30,0.35)');
      glintGrad2.addColorStop(0.4, 'rgba(180,30,15,0.1)');
      glintGrad2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glintGrad2;
      ctx.fillRect(glintX2 - 30, baseY - 30, 60, 60);
    }

    ctx.restore();
  }

  ====== ADR-005: 旧渲染逻辑注释保留结束 ====== */

  // ==================== 公开 API ====================
  let _resizeHandler = null;

  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) {
      console.error('[IsometricBg] Canvas 元素未找到:', canvasId);
      return;
    }
    ctx = canvas.getContext('2d');

    resize();

    // ★ 防止 resize 监听器泄漏：先移除旧监听再绑定新监听
    if (_resizeHandler) {
      window.removeEventListener('resize', _resizeHandler);
    }
    _resizeHandler = () => {
      clearTimeout(window._isoResizeTimer);
      window._isoResizeTimer = setTimeout(resize, 100);
    };
    window.addEventListener('resize', _resizeHandler);

    // ADR-005: 不再预加载瓦片，直接标记就绪
    loaded = true;
  }

  function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    canvasW = parent ? parent.clientWidth : window.innerWidth;
    canvasH = parent ? parent.clientHeight : window.innerHeight;
    canvas.width = canvasW;
    canvas.height = canvasH;
  }

  function start() {
    if (!canvas) return;
    _doStart();
  }

  function _doStart() {
    if (running) return;
    running = true;
    startTime = 0;
    _lastElapsed = 0;
    _elapsedAcc = 0;
    rafId = requestAnimationFrame(draw);
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ★ 获取方尖碑边界（供环形卡片布局使用）
  function getAnomalyBounds() {
    if (!canvas) return { cx: 0, cy: 0, width: 0, height: 0 };
    const maxDim = Math.min(canvasW, canvasH);
    const aw = maxDim * 0.3;
    const ah = aw;
    const anomalyCx = canvasW / 2;
    const verticalRange = canvasH * 0.45;
    const verticalBase = canvasH * 0.28;
    const anomalyCy = verticalBase + verticalRange / 2;
    return { cx: anomalyCx, cy: anomalyCy, width: aw, height: ah };
  }

  // ★ 设置循环速度倍率（方便外部微调）
  let _speedMultiplier = 1;
  function setCycleSpeed(multiplier) {
    _speedMultiplier = Math.max(0.5, Math.min(3, multiplier));
  }

  window.IsometricBg = { init, start, stop, resize, getAnomalyBounds, setCycleSpeed };

  // ADR-005: 不再预加载瓦片，直接派发就绪事件（加载完成=立即）
  loaded = true;
  window.dispatchEvent(new CustomEvent('isometricReady', {
    detail: getAnomalyBounds()
  }));
})();
