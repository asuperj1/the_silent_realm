/**
 * 寂静之地 · 标准登录页逻辑
 *
 * 功能：
 *   1. Canvas 粒子背景动画
 *   2. 登录 / 注册标签切换
 *   3. Socket.IO 连接 → emit login / register
 *   4. 加载动画：羊皮纸飞页 + 暗金流光 → 切入大厅
 *   5. 成功 → localStorage 存 token → 跳转 /index.html?from=login
 */

(function () {
  /* ======== ★ 扉页守卫：非 from=cover 来源，重定向至扉页 ======== */
  const urlParams = new URLSearchParams(window.location.search);
  const fromCover = urlParams.get('from') === 'cover';

  if (!fromCover) {
    // 未经过扉页 → 重定向至扉页（首次进站或直接访问登录页）
    // 但如果是页面刷新（已有 coc_cover_passed 标记），则放行
    const coverPassed = sessionStorage.getItem('coc_cover_passed');
    if (!coverPassed) {
      window.location.replace('/');
      return; // 阻止后续代码执行
    }
  } else {
    // 从扉页跳转而来 → 标记扉页已通过（刷新时不再重定向）
    sessionStorage.setItem('coc_cover_passed', '1');
  }

  /* ======== ★ 心跳预校验 (L3)：表单渲染前确认服务可达 ======== */
  let _serverReady = false;
  let _healthCheckRetries = 0;
  const MAX_HEALTH_RETRIES = 3; // ★ 从5降至3，最多6秒(3×2s)而非15秒

  function _showServerPending(msg) {
    const card = document.querySelector('.auth-card');
    if (card) card.style.opacity = '0.7'; // ★ 降低透明度但不完全遮挡（允许用户看到表单）
    const old = document.getElementById('serverPending');
    if (old) { old.textContent = msg; return; }
    const banner = document.createElement('div');
    banner.id = 'serverPending';
    banner.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);color:#c9a44b;font-size:14px;text-align:center;z-index:500;pointer-events:none;background:rgba(26,24,21,0.9);padding:6px 20px;border-radius:20px;border:1px solid #3a352d;';
    banner.innerHTML = `<span>⏳ ${msg}</span>`;
    document.body.appendChild(banner);
  }
  function _hideServerPending() {
    const banner = document.getElementById('serverPending');
    if (banner) banner.remove();
    const card = document.querySelector('.auth-card');
    if (card) card.style.opacity = '';
  }

  function _doHealthCheck() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000); // ★ 降至1s，快速预检
    fetch('/api/health', { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        clearTimeout(timeout);
        if (data.status === 'ok') {
          _serverReady = true;
          _hideServerPending();
          console.log('[auth] 🟢 心跳预检通过，服务就绪');
        } else {
          _retryHealth();
        }
      })
      .catch(() => {
        clearTimeout(timeout);
        _retryHealth();
      });
  }
  function _retryHealth() {
    _healthCheckRetries++;
    if (_healthCheckRetries >= MAX_HEALTH_RETRIES) {
      _showServerPending('⚠️ 服务器未就绪，可尝试提交但可能失败');
      return;
    }
    _showServerPending(`寂静之地正在苏醒…(${_healthCheckRetries}/${MAX_HEALTH_RETRIES})`);
    setTimeout(_doHealthCheck, 1000); // ★ 降至1s，加速重试
  }

  // 页面加载时立即发起心跳检测（不阻塞表单渲染）
  _doHealthCheck();

  /* ======== Canvas 粒子背景 ======== */
  const canvas = document.getElementById('bgCanvas');
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    initParticles();
  }

  function initParticles() {
    const count = Math.floor((W * H) / 18000);
    particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.8 + 0.3,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        alpha: Math.random() * 0.5 + 0.15
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180,160,120,${p.alpha})`;
      ctx.fill();
    });

    // 连线
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 90) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(180,160,120,${0.06 * (1 - dist / 90)})`;
          ctx.lineWidth = 0.4;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();

  // ★ 初始化全局金色粒子（登录页）
  if (window.GoldParticles?.globalInit) {
    window.GoldParticles.globalInit('globalGoldParticles');
    window.GoldParticles.globalStart();
  }

  /* ======== 加载动画管理 ======== */
  let _animPhase = 'idle';   // 'idle' | 'waiting' | 'closing' | 'aborted'
  let _loadingTimeout = null;
  const LOADING_TIMEOUT_MS = 6000;  // ★ 降至6s，快速失败快速反馈

  /**
   * 阶段一：等待动画（羊皮纸飞页 + 暗金流光循环）
   * 点击登录按钮后立即播放，流光/光环允许无限循环
   */
  function showLoadingAnim() {
    if (_animPhase !== 'idle') return;
    _animPhase = 'waiting';
    document.body.classList.add('login-loading');

    // 按钮流光
    const btnLogin = document.getElementById('btnLogin');
    const btnRegister = document.getElementById('btnRegister');
    if (btnLogin) btnLogin.classList.add('loading-btn');
    if (btnRegister) btnRegister.classList.add('loading-btn');

    // 全屏遮罩 + 羊皮纸
    let overlay = document.getElementById('loginLoadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loginLoadingOverlay';
      overlay.innerHTML = `
        <div class="parchment-stage">
          <div class="parchment-left"></div>
          <div class="parchment-right"></div>
          <div class="parchment-spine"></div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    overlay.classList.add('active');
    overlay.classList.remove('closing');

    // 四角 + 对角光束（循环）
    let beams = document.getElementById('goldBeamsContainer');
    if (!beams) {
      beams = document.createElement('div');
      beams.id = 'goldBeamsContainer';
      beams.className = 'gold-beams';
      beams.innerHTML = `
        <div class="gold-beam tl"></div>
        <div class="gold-beam tr"></div>
        <div class="gold-beam bl"></div>
        <div class="gold-beam br"></div>
        <div class="gold-beam-diag d1"></div>
        <div class="gold-beam-diag d2"></div>
        <div class="gold-beam-diag d3"></div>
        <div class="gold-beam-diag d4"></div>
      `;
      document.body.appendChild(beams);
    }
    beams.classList.add('active');
    beams.classList.remove('closing');

    // 中心光环（循环）
    let ring = document.getElementById('goldRingEl');
    if (!ring) {
      ring = document.createElement('div');
      ring.id = 'goldRingEl';
      ring.className = 'gold-ring';
      document.body.appendChild(ring);
    }
    ring.classList.add('active');
    ring.classList.remove('closing');

    // 超时兜底
    _loadingTimeout = setTimeout(() => {
      abortLoadingAnim('验证超时，请检查网络后重试');
    }, LOADING_TIMEOUT_MS);
  }

  /**
   * 阶段二：收尾动画（流光收拢 + 羊皮纸封合，仅执行一次）
   * 接口返回成功后调用，收尾完成后执行 thenRedirect
   */
  function playClosingAnim(thenRedirect) {
    if (_animPhase !== 'waiting') return;
    _animPhase = 'closing';
    if (_loadingTimeout) { clearTimeout(_loadingTimeout); _loadingTimeout = null; }

    const overlay = document.getElementById('loginLoadingOverlay');
    const beams = document.getElementById('goldBeamsContainer');
    const ring = document.getElementById('goldRingEl');

    // 光束 + 光环立即停止循环
    if (beams) beams.classList.remove('active');
    if (ring) ring.classList.remove('active');

    // 羊皮纸封合动画（单次 CSS animation）
    if (overlay) overlay.classList.add('closing');

    // 卡片淡出
    const card = document.querySelector('.auth-card');
    if (card) card.classList.add('login-fadeout');

    // 等待 CSS 收尾动画完成（缩短至200ms加速跳转）
    setTimeout(() => {
      document.body.classList.remove('login-loading');
      if (overlay) {
        overlay.classList.remove('active', 'closing');
      }
      if (thenRedirect) thenRedirect();
    }, 200);
  }

  /**
   * 强制终止：立刻关停所有动画、解锁按钮、展示错误
   */
  function abortLoadingAnim(reason) {
    if (_animPhase === 'idle' || _animPhase === 'aborted') return;
    _animPhase = 'aborted';
    if (_loadingTimeout) { clearTimeout(_loadingTimeout); _loadingTimeout = null; }

    const overlay = document.getElementById('loginLoadingOverlay');
    const beams = document.getElementById('goldBeamsContainer');
    const ring = document.getElementById('goldRingEl');

    // 立即移除所有动画元素
    if (beams) beams.classList.remove('active', 'closing');
    if (ring) ring.classList.remove('active', 'closing');
    if (overlay) overlay.classList.remove('active', 'closing');

    document.body.classList.remove('login-loading');

    // 解锁按钮
    const btnLogin = document.getElementById('btnLogin');
    const btnRegister = document.getElementById('btnRegister');
    if (btnLogin) { btnLogin.disabled = false; btnLogin.classList.remove('loading-btn'); }
    if (btnRegister) { btnRegister.disabled = false; btnRegister.classList.remove('loading-btn'); }

    // 错误提示
    if (reason) showMsg(reason, 'error');
  }

  /* ======== 标签切换 ======== */
  const tabs = document.querySelectorAll('.tab-bar .tab');
  const loginPanel = document.getElementById('loginPanel');
  const registerPanel = document.getElementById('registerPanel');
  const msgBox = document.getElementById('msgBox');

  // ★ 登录页退出登录按钮：清除所有缓存 → 跳转扉页
  const btnLogoutOnLogin = document.getElementById('btnLogoutOnLogin');
  if (btnLogoutOnLogin) {
    btnLogoutOnLogin.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('coc_token');
      localStorage.removeItem('coc_username');
      localStorage.removeItem('coc_roomId');
      localStorage.removeItem('coc_gameState');
      localStorage.removeItem('coc_avatars');
      sessionStorage.removeItem('coc_cover_passed');
      localStorage.setItem('coc_cover_scene', 'logout_return');
      window.location.replace('/');
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      if (target === 'login') {
        loginPanel.classList.add('active');
        registerPanel.classList.remove('active');
      } else {
        loginPanel.classList.remove('active');
        registerPanel.classList.add('active');
      }
      clearMsg();
    });
  });

  /* ======== 消息 ======== */
  function showMsg(text, type) {
    msgBox.textContent = text;
    msgBox.className = 'msg-box ' + type;
  }
  function clearMsg() { msgBox.textContent = ''; msgBox.className = 'msg-box'; }

  /* ======== Socket 登录 / 注册 ======== */
  const socket = io({ transports: ['websocket', 'polling'] });
  let _pendingAction = null;  // 'login' | 'register'
  let _connectRetryCount = 0; // ★ connect_error 自动重试计数 (L6)
  const MAX_CONNECT_RETRY = 3;

  socket.on('connect', () => {
    console.log('[auth] socket connected:', socket.id);
    _connectRetryCount = 0;
    // ★ 连接建立后重置状态，允许发起请求
    if (_animPhase !== 'idle') {
      console.log('[auth] 连接恢复，重置动画状态');
      _animPhase = 'idle';
    }
  });

  // ★ 连接错误：自动重试最多3次后才给用户提示 (L6)
  socket.on('connect_error', (err) => {
    console.error('[auth] 连接失败:', err.message);
    _connectRetryCount++;
    if (_animPhase === 'waiting') {
      if (_connectRetryCount <= MAX_CONNECT_RETRY) {
        showMsg(`正在连接寂静之地…(${_connectRetryCount}/${MAX_CONNECT_RETRY})`, 'info');
      } else {
        abortLoadingAnim('无法连接到寂静之地，请检查网络后重试');
      }
    } else {
      if (_connectRetryCount <= MAX_CONNECT_RETRY) {
        showMsg(`服务器连接中…(${_connectRetryCount}/${MAX_CONNECT_RETRY})`, 'info');
      } else {
        showMsg('无法连接到服务器，请刷新页面重试', 'error');
      }
    }
  });

  socket.on('disconnect', () => {
    if (_animPhase === 'waiting') {
      abortLoadingAnim('与服务器断开连接，请稍后重试');
    } else {
      showMsg('与服务器断开连接，正在重连…', 'error');
    }
  });

  // ★ 服务端统一用 authSuccess 返回登录/注册成功
  socket.on('authSuccess', (data) => {
    const isRegister = _pendingAction === 'register';
    showMsg(isRegister ? '身份创建成功！正在进入世界…' : '欢迎回来，调查员！', 'success');
    playClosingAnim(() => onAuthSuccess(data));
  });

  // ★ 服务端统一用 authError 返回失败
  socket.on('authError', (data) => {
    const reason = data?.msg || data?.reason || (_pendingAction === 'register' ? '注册失败' : '登录失败');
    abortLoadingAnim(reason);
  });

  function onAuthSuccess(data) {
    // 凭证校验：必须拿到合法 token 才允许跳转
    if (!data?.token) {
      abortLoadingAnim('认证失败：未获取有效凭证，请重试');
      return;
    }
    // ★ 双键存储：兼容 client.js 读取 'token' 键，同时保留 'coc_token' 供 loginLogout 清理
    localStorage.setItem('token', data.token);
    localStorage.setItem('coc_token', data.token);
    if (data?.username) localStorage.setItem('coc_username', data.username);

    // 凭证已落盘，立即跳转大厅
    window.location.replace('/index.html?from=login');
  }

  function disableButtons() {
    document.getElementById('btnLogin').disabled = true;
    document.getElementById('btnRegister').disabled = true;
  }

  // ★ 通用：确保 socket 连接后发送认证请求（含5s超时保护 L1）
  function _emitWhenConnected(eventName, data) {
    const CONNECT_TIMEOUT = 5000;
    if (socket.connected) {
      socket.emit(eventName, data);
      return;
    }
    console.log(`[auth] socket 未连接，等待连接后发送 ${eventName}`);
    _connectRetryCount = 0;
    socket.connect();
    let resolved = false;
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.off('connect', onConnect);
        abortLoadingAnim('服务器未响应，请确认服务已启动后重试');
      }
    }, CONNECT_TIMEOUT);
    function onConnect() {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        socket.emit(eventName, data);
      }
    }
    socket.once('connect', onConnect);
  }

  // 登录提交
  loginPanel.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value.trim();
    if (!user) return showMsg('请输入你的代号', 'error');
    if (!pass) return showMsg('请输入密令', 'error');
    if (user.length < 2) return showMsg('代号至少 2 个字符', 'error');
    if (pass.length < 3) return showMsg('密令至少 3 位', 'error');

    // ★ 服务就绪检查：未就绪时仅提示警告，不阻止提交（用户可自行决定等待或尝试）
    if (!_serverReady) {
      showMsg('服务器可能尚未就绪，正在尝试连接…', 'info');
      // 不 return，允许用户继续提交
    }

    // ★ 重置动画状态（修复上一次错误后 _animPhase='aborted' 导致静默停滞）
    _animPhase = 'idle';
    _pendingAction = 'login';
    disableButtons();
    showMsg('正在验证身份…', 'info');
    showLoadingAnim();

    _emitWhenConnected('login', { username: user, password: pass });
  });

  // 注册提交
  registerPanel.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('regUser').value.trim();
    const pass = document.getElementById('regPass').value.trim();
    if (!user) return showMsg('请输入你的代号', 'error');
    if (!pass) return showMsg('请输入密令', 'error');
    if (user.length < 2) return showMsg('代号至少 2 个字符', 'error');
    if (pass.length < 3) return showMsg('密令至少 3 位', 'error');

    // ★ 服务就绪检查：未就绪时仅提示警告，不阻止提交
    if (!_serverReady) {
      showMsg('服务器可能尚未就绪，正在尝试连接…', 'info');
      // 不 return，允许用户继续提交
    }

    // ★ 重置动画状态
    _animPhase = 'idle';
    _pendingAction = 'register';
    disableButtons();
    showMsg('正在创建身份…', 'info');
    showLoadingAnim();

    _emitWhenConnected('register', { username: user, password: pass });
  });

})();
