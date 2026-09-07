/**
 * goldParticles.js — 金尘粒子系统 (ADR-005 T-6)
 *
 * 独立 Canvas 渲染 30-50 个悬浮金尘粒子，缓慢漂浮 + 柔和辉光。
 * 支持双实例：副本选择页专用 + 全局（角色/大厅/登录页）。
 *
 * 暴露：window.GoldParticles = { init(canvasId), start(), stop(), resize(),
 *                                globalInit(canvasId), globalStart(), globalStop() }
 */
(function() {
  'use strict';

  // ==================== 常量 ====================
  const PARTICLE_COUNT = 40;          // 粒子数量
  const PARTICLE_MIN_RADIUS = 1.0;
  const PARTICLE_MAX_RADIUS = 3.0;

  // ==================== 状态 ====================
  let canvas, ctx;
  let canvasW = 0, canvasH = 0;
  let running = false;
  let rafId = null;
  let particles = [];

  // ==================== 粒子初始化 ====================
  function _spawnParticle() {
    return {
      x: Math.random() * canvasW,
      y: Math.random() * canvasH,
      r: PARTICLE_MIN_RADIUS + Math.random() * (PARTICLE_MAX_RADIUS - PARTICLE_MIN_RADIUS),
      vx: (Math.random() - 0.5) * 0.3,      // 水平漂移
      vy: -0.15 - Math.random() * 0.35,      // 微弱上升
      alpha: 0.2 + Math.random() * 0.5,      // 透明度
      alphaSpeed: 0.002 + Math.random() * 0.006,
      alphaPhase: Math.random() * Math.PI * 2,
      color: Math.random() < 0.3
        ? [220, 170, 80]   // 亮金
        : [180, 130, 50],  // 暗金
      glowRadius: 4 + Math.random() * 6
    };
  }

  function _initParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(_spawnParticle());
    }
  }

  // ==================== 主绘制循环 ====================
  function draw(timestamp) {
    if (!running) return;
    rafId = requestAnimationFrame(draw);

    ctx.clearRect(0, 0, canvasW, canvasH);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      // 运动更新
      p.x += p.vx + (Math.sin(timestamp * 0.0005 + i) * 0.1);
      p.y += p.vy + (Math.cos(timestamp * 0.0007 + i * 1.3) * 0.08);

      // 边界回弹 + 重置到顶部
      if (p.x < 0) p.x = canvasW;
      if (p.x > canvasW) p.x = 0;
      if (p.y < -20) {
        p.y = canvasH + 20;
        p.x = Math.random() * canvasW;
      }
      if (p.y > canvasH + 20) {
        p.y = -20;
        p.x = Math.random() * canvasW;
      }

      // 透明度呼吸
      const alpha = p.alpha + Math.sin(timestamp * p.alphaSpeed + p.alphaPhase) * 0.25;
      const clampedAlpha = Math.max(0.1, Math.min(1, alpha));

      // 绘制粒子（带辉光）
      const [cr, cg, cb] = p.color;
      ctx.save();
      ctx.globalAlpha = clampedAlpha;

      // 外圈柔和辉光
      const glowGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.glowRadius);
      glowGrad.addColorStop(0, `rgba(${cr},${cg},${cb},0.6)`);
      glowGrad.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.2)`);
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // 内核亮点
      ctx.fillStyle = `rgba(${cr + 40},${Math.min(cg + 20, 255)},${cb},${clampedAlpha + 0.2})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // ==================== 公开 API ====================
  let _resizeHandler = null;

  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) {
      console.error('[GoldParticles] Canvas 未找到:', canvasId);
      return;
    }
    ctx = canvas.getContext('2d');
    resize();

    if (_resizeHandler) {
      window.removeEventListener('resize', _resizeHandler);
    }
    _resizeHandler = () => {
      clearTimeout(window._goldResizeTimer);
      window._goldResizeTimer = setTimeout(resize, 150);
    };
    window.addEventListener('resize', _resizeHandler);
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
    if (running) return;
    running = true;
    _initParticles();
    rafId = requestAnimationFrame(draw);
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  window.GoldParticles = { init, start, stop, resize };

  // ==================== 全局实例（跨页面复用） ====================
  let gCanvas, gCtx;
  let gRunning = false;
  let gRafId = null;
  let gParticles = [];
  let gW = 0, gH = 0;
  let _gResizeHandler = null;

  function _gSpawnParticle() {
    return {
      x: Math.random() * gW,
      y: Math.random() * gH,
      r: PARTICLE_MIN_RADIUS + Math.random() * (PARTICLE_MAX_RADIUS - PARTICLE_MIN_RADIUS),
      vx: (Math.random() - 0.5) * 0.25,
      vy: -0.12 - Math.random() * 0.3,
      alpha: 0.15 + Math.random() * 0.4,
      alphaSpeed: 0.002 + Math.random() * 0.005,
      alphaPhase: Math.random() * Math.PI * 2,
      color: Math.random() < 0.3
        ? [220, 170, 80]
        : [180, 130, 50],
      glowRadius: 4 + Math.random() * 6
    };
  }

  function _gInitParticles() {
    gParticles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      gParticles.push(_gSpawnParticle());
    }
  }

  function _gDraw(timestamp) {
    if (!gRunning) return;
    gRafId = requestAnimationFrame(_gDraw);

    gCtx.clearRect(0, 0, gW, gH);

    for (let i = 0; i < gParticles.length; i++) {
      const p = gParticles[i];
      p.x += p.vx + (Math.sin(timestamp * 0.0004 + i) * 0.08);
      p.y += p.vy + (Math.cos(timestamp * 0.0006 + i * 1.3) * 0.06);
      if (p.x < 0) p.x = gW;
      if (p.x > gW) p.x = 0;
      if (p.y < -20) { p.y = gH + 20; p.x = Math.random() * gW; }
      if (p.y > gH + 20) { p.y = -20; p.x = Math.random() * gW; }

      const alpha = p.alpha + Math.sin(timestamp * p.alphaSpeed + p.alphaPhase) * 0.2;
      const clampedAlpha = Math.max(0.08, Math.min(1, alpha));

      const [cr, cg, cb] = p.color;
      gCtx.save();
      gCtx.globalAlpha = clampedAlpha;

      const glowGrad = gCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.glowRadius);
      glowGrad.addColorStop(0, `rgba(${cr},${cg},${cb},0.5)`);
      glowGrad.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.15)`);
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      gCtx.fillStyle = glowGrad;
      gCtx.beginPath();
      gCtx.arc(p.x, p.y, p.glowRadius, 0, Math.PI * 2);
      gCtx.fill();

      gCtx.fillStyle = `rgba(${cr + 40},${Math.min(cg + 20, 255)},${cb},${clampedAlpha + 0.15})`;
      gCtx.beginPath();
      gCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      gCtx.fill();

      gCtx.restore();
    }
  }

  function globalInit(canvasId) {
    gCanvas = document.getElementById(canvasId);
    if (!gCanvas) {
      console.warn('[GoldParticles] 全局 Canvas 未找到:', canvasId);
      return;
    }
    gCtx = gCanvas.getContext('2d');
    _gResize();
    if (_gResizeHandler) window.removeEventListener('resize', _gResizeHandler);
    _gResizeHandler = () => {
      clearTimeout(window._goldGlobalResizeTimer);
      window._goldGlobalResizeTimer = setTimeout(_gResize, 150);
    };
    window.addEventListener('resize', _gResizeHandler);
  }

  function _gResize() {
    if (!gCanvas) return;
    gW = window.innerWidth;
    gH = window.innerHeight;
    gCanvas.width = gW;
    gCanvas.height = gH;
  }

  function globalStart() {
    if (!gCanvas || gRunning) return;
    gRunning = true;
    _gInitParticles();
    gRafId = requestAnimationFrame(_gDraw);
  }

  function globalStop() {
    gRunning = false;
    if (gRafId) { cancelAnimationFrame(gRafId); gRafId = null; }
    // ★ 清空画布，避免粒子静止残留覆盖在副本/其他页面
    if (gCtx && gCanvas) {
      gCtx.clearRect(0, 0, gCanvas.width, gCanvas.height);
    }
  }

  window.GoldParticles.globalInit = globalInit;
  window.GoldParticles.globalStart = globalStart;
  window.GoldParticles.globalStop = globalStop;

})();
