/**
 * coverAnim.js — 扉页动画控制
 * 职责：尘埃粒子、音频控制、强制扉页展示（3秒自动跳转）、缓存破坏
 * 
 * 核心规则：
 * - 每次加载扉页都会重新请求图片（禁止缓存）
 * - 3秒自动跳转至登录页（可点击/按键跳过）
 * - 登录页检测 ?from=cover 参数，缺则重定向回扉页
 */

(function() {
  'use strict';

  // ==================== 扉页强制配置 ====================
  const COVER_DURATION = 2000; // 固定播放时长 2 秒
  const LOGIN_URL = '/login.html?from=cover';

  // ★ 场景识别：首次进站 vs 退出回流（延迟到 DOM ready 后应用）

  // ==================== 缓存破坏：每次加载重新请求图片 ====================
  const coverImg = document.getElementById('coverQuoteImg');
  if (coverImg) {
    // 追加时间戳参数，强制浏览器重新加载图片
    const originalSrc = coverImg.getAttribute('src');
    coverImg.setAttribute('src', originalSrc + '?t=' + Date.now());
  }

  // ==================== 尘埃粒子系统 ====================
  const canvas = document.getElementById('dustCanvas');
  const ctx = canvas.getContext('2d');

  let particles = [];
  const PARTICLE_COUNT = 80;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  class DustParticle {
    constructor() {
      this.reset(true);
    }

    reset(initial) {
      this.x = Math.random() * canvas.width;
      // 初始随机分布在整个屏幕高度
      this.y = initial ? Math.random() * canvas.height : -10 - Math.random() * 40;
      this.size = Math.random() * 2.5 + 0.5;
      this.speed = Math.random() * 0.35 + 0.08;
      this.opacity = Math.random() * 0.45 + 0.08;
      this.wobble = Math.random() * Math.PI * 2;
      this.wobbleSpeed = (Math.random() - 0.5) * 0.015;
      this.wobbleAmp = Math.random() * 0.6 + 0.1;
    }

    update() {
      this.y += this.speed;
      this.wobble += this.wobbleSpeed;
      this.x += Math.sin(this.wobble) * this.wobbleAmp * 0.3;

      // 超出屏幕底部，回到顶部
      if (this.y > canvas.height + 10) {
        this.y = -10;
        this.x = Math.random() * canvas.width;
      }
      // 水平循环
      if (this.x < -10) this.x = canvas.width + 10;
      if (this.x > canvas.width + 10) this.x = -10;
    }

    draw(ctx) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(201, 160, 58, ${this.opacity})`;
      ctx.fill();
    }
  }

  function initParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(new DustParticle());
    }
  }

  function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.update();
      p.draw(ctx);
    }

    requestAnimationFrame(animateParticles);
  }

  // ==================== 音频控制 ====================
  const ambientAudio = document.getElementById('ambientAudio');
  const btnMute = document.getElementById('btnMute');
  const muteIcon = btnMute.querySelector('.mute-icon');

  let isMuted = true; // 默认静音（浏览器自动播放策略）

  function tryAutoPlay() {
    // 用户首次交互后尝试播放
    if (isMuted) return;
    ambientAudio.volume = 0.25;
    ambientAudio.play().catch(() => {
      // 浏览器阻止自动播放，保持静音
      isMuted = true;
      muteIcon.textContent = '🔇';
      btnMute.classList.add('muted');
    });
  }

  btnMute.addEventListener('click', (e) => {
    e.stopPropagation();
    isMuted = !isMuted;

    if (isMuted) {
      ambientAudio.pause();
      muteIcon.textContent = '🔇';
      btnMute.classList.add('muted');
    } else {
      ambientAudio.volume = 0.25;
      ambientAudio.play().catch(() => {
        // 如果播放失败（无音频文件），静默处理
      });
      muteIcon.textContent = '🔊';
      btnMute.classList.remove('muted');
    }
  });

  // ==================== 点击跳转 + 倒计时自动跳转 ====================
  const coverContainer = document.getElementById('coverContainer');
  const coverHint = document.getElementById('coverHint');
  const coverCountdown = document.getElementById('coverCountdown');

  let isTransitioning = false;
  let countdownSeconds = Math.ceil(COVER_DURATION / 1000);
  let countdownInterval = null;

  function updateCountdown() {
    if (coverCountdown) {
      coverCountdown.textContent = countdownSeconds + ' 秒后自动进入';
    }
  }

  function startCountdown() {
    updateCountdown();
    countdownInterval = setInterval(() => {
      countdownSeconds--;
      if (countdownSeconds <= 0) {
        clearInterval(countdownInterval);
        goToLogin();
      } else {
        updateCountdown();
      }
    }, 1000);
  }

  function goToLogin() {
    if (isTransitioning) return;
    isTransitioning = true;

    // 清除倒计时
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    // 更新提示文字
    if (coverHint) {
      coverHint.textContent = '— 正在进入寂静之地 —';
    }
    if (coverCountdown) {
      coverCountdown.textContent = '';
    }

    // 淡出扉页
    coverContainer.classList.add('fade-out');

    // 淡出音效
    if (!isMuted && ambientAudio) {
      const fadeAudio = setInterval(() => {
        if (ambientAudio.volume > 0.02) {
          ambientAudio.volume = Math.max(0, ambientAudio.volume - 0.02);
        } else {
          ambientAudio.pause();
          clearInterval(fadeAudio);
        }
      }, 50);
    }

    // 跳转到登录页（缩短淡出等待）
    setTimeout(() => {
      window.location.href = LOGIN_URL;
    }, 400);
  }

  // 点击任意位置跳转
  document.body.addEventListener('click', goToLogin);

  // 键盘任意键也可进入
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goToLogin();
    }
  });

  // ==================== 初始化 ====================
  function init() {
    resizeCanvas();
    initParticles();
    animateParticles();

    // ★ 场景文案：根据 localStorage 中的 coc_cover_scene 区分首次进站 / 退出回流
    const coverScene = localStorage.getItem('coc_cover_scene') || 'first_visit';
    localStorage.removeItem('coc_cover_scene');
    const coverHintEl = document.getElementById('coverHint');
    const coverSubtitleEl = document.querySelector('.cover-subtitle');
    if (coverScene === 'logout_return') {
      if (coverHintEl) coverHintEl.textContent = '— 调查员，欢迎再次回到寂静之地 —';
      if (coverSubtitleEl) coverSubtitleEl.textContent = 'Call of Cthulhu · Return';
    }

    // 启动倒计时自动跳转
    startCountdown();

    // 尝试自动播放（大部分浏览器会阻止，需用户手势）
    ambientAudio.volume = 0.25;
    ambientAudio.play().then(() => {
      isMuted = false;
      muteIcon.textContent = '🔊';
      btnMute.classList.remove('muted');
    }).catch(() => {
      // 自动播放被阻止，等待用户点击静音开关
    });
  }

  // 窗口大小变化时重设
  window.addEventListener('resize', resizeCanvas);

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
