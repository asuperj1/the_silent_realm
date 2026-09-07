/**
 * 技能树页面模块（角色面板 / 结算奖励 共用）
 * 依赖：window.socket、window.getCurrentCharacter()
 * 事件：getSkillTree / skillTreeData / unlockSkill
 */
(function() {
  let overlay = null;
  let currentTree = null;

  function showModal(modal, show) {
    if (!modal) return;
    if (show) modal.classList.add('active');
    else modal.classList.remove('active');
  }

  function gradeBadge(grade) {
    const map = { normal: ['普通', '#9aa0a6'], fine: ['优秀', '#4cc9f0'], good: ['精良', '#7c5cff'], epic: ['史诗', '#c77dff'], s: ['S级', '#ffd700'] };
    const [label, color] = map[grade] || ['普通', '#9aa0a6'];
    return `<span class="skill-grade" style="color:${color};border-color:${color}33;background:${color}1a">${label}</span>`;
  }

  function createDOM(embedParent) {
    if (document.getElementById('skillTreeOverlay')) return;
    const o = document.createElement('div');
    o.id = 'skillTreeOverlay';
    o.className = 'modal skill-tree-overlay' + (embedParent ? ' embed' : '');
    o.innerHTML = `
      <div class="modal-content skill-tree-box">
        <div class="skill-tree-head">
          <h2>🌳 流派技能树</h2>
          <div id="stPoints" class="st-points">✦ 技能精点：0</div>
        </div>
        <div id="stCareer" class="st-career"></div>
        <div id="stPassive" class="st-passive"></div>
        <div id="stInnate" class="st-innate"></div>
        <div id="stTree" class="st4-tree"></div>
        <div class="st4-legend">
          <span><i class="lg-dot unlocked"></i>已解锁</span>
          <span><i class="lg-dot ready"></i>可解锁</span>
          <span><i class="lg-dot locked"></i>锁定/前置</span>
          <span><i class="lg-dot ult"></i>大招</span>
          <span><i class="lg-dot equipped"></i>出战</span>
        </div>
        <div class="modal-actions">
          <button id="btnStToSetup" class="btn-primary">⚔ 技能搭配</button>
          <button id="btnStClose" class="btn-secondary">关闭</button>
        </div>
      </div>
    `;
    if (embedParent && typeof embedParent === 'string') {
      const p = document.getElementById(embedParent);
      if (p) { p.appendChild(o); o.dataset.embedParent = embedParent; }
    } else {
      document.body.appendChild(o);
    }
    overlay = o;
    document.getElementById('btnStClose').addEventListener('click', () => showModal(overlay, false));
    document.getElementById('btnStToSetup').addEventListener('click', () => {
      showModal(overlay, false);
      window.SkillSetup.open();
    });
  }

  const iconMapCache = {};   // ★ 按职业缓存图标映射，避免切换职业后串用旧职业图标

  async function loadIconMap(treeId) {
    if (iconMapCache[treeId]) return iconMapCache[treeId];
    try {
      const resp = await fetch('/api/skill-icons-map');
      if (resp.ok) { const d = await resp.json(); if (d.success) iconMapCache[treeId] = d.map[treeId] || null; }
    } catch (e) {}
    return iconMapCache[treeId];
  }

  // ★ 稀有度配色（暗黑4 风格：normal灰 / fine青 / good紫 / epic品红 / s大招金橙）
  const GRADE_COLOR = { normal: '#8a93a3', fine: '#4cc9f0', good: '#7c5cff', epic: '#c77dff', s: '#ffb020' };

  // ★ 技能详情浮层：HTML 转义 + 效果标签中文映射
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const DETAIL_LABEL = {
    target: { single: '单体', all: '全体', allies: '友方全体', self: '自身', enemies: '敌方全体' },
    type: { attack: '攻击', heal: '治疗', defense: '防御', control: '控制', taunt: '嘲讽', buff: '增益', debuff: '减益' },
    element: { physical: '物理', holy: '神圣', fire: '火焰', ice: '寒冰', poison: '毒素', arcane: '奥术', lightning: '雷电', shadow: '暗影', earth: '大地' }
  };

  // ==================== ★ 暗黑破坏神2 风格折线形布局（动态菱形树，支持任意技能数） ====================
  // 大招（最后一项）置顶；第一个技能为底部根；其余按层分叉（每层 ≤2 个，左右对称）
  // 返回 { pos: [{x,y}...], links: [[from,to]...] }
  function treeLayout(skills) {
    const n = skills.length;
    const pos = [];
    const links = [];
    if (n === 0) return { pos, links, layerCount: 0 };
    if (n === 1) { pos[0] = { x: 50, y: 50 }; return { pos, links, layerCount: 1 }; }
    // 大招置顶（y=14：节点高约 88px，中心 14% 处顶部不越界）
    pos[n - 1] = { x: 50, y: 14 };
    // 底部根
    pos[0] = { x: 50, y: 86 };
    const midCount = n - 2;
    // ★ 中间层数（每层 ≤2，左右对称）；y 在大招(14)与根(86)之间动态均匀分布，支持任意技能数不再同层堆叠
    const midLayers = Math.max(1, Math.ceil(midCount / 2));
    const layers = [[0]];
    let idx = 1;
    const TOP = 14, BOT = 86;
    for (let li = 0; li < midLayers; li++) {
      // 从靠近根的层（li=0）到靠近大招的层（li=midLayers-1）均匀分布
      const t = (li + 1) / (midLayers + 1);
      const y = BOT + (TOP - BOT) * t;
      const remaining = midCount - (idx - 1);
      const count = Math.min(2, remaining);
      const xs = count === 1 ? [50] : [24, 76];
      const layer = [];
      for (let k = 0; k < count; k++) { pos[idx] = { x: xs[k], y }; layer.push(idx); idx++; }
      layers.push(layer);
    }
    // 相邻层连接：上层每节点连到最近下层；下层每节点至少出一条线
    for (let l = 0; l < layers.length - 1; l++) {
      const lower = layers[l];
      const upper = layers[l + 1];
      const nearestLower = (up) => lower.reduce((best, lo) => Math.abs(pos[lo].x - pos[up].x) < Math.abs(pos[best].x - pos[up].x) ? lo : best, lower[0]);
      const nearestUpper = (lo) => upper.reduce((best, up) => Math.abs(pos[up].x - pos[lo].x) < Math.abs(pos[best].x - pos[lo].x) ? up : best, upper[0]);
      for (const up of upper) links.push([nearestLower(up), up]);
      for (const lo of lower) {
        if (!links.some(lk => lk[0] === lo && upper.includes(lk[1]))) links.push([lo, nearestUpper(lo)]);
      }
    }
    // 最上层所有节点 → 大招
    const top = layers[layers.length - 1];
    for (const t of top) links.push([t, n - 1]);
    // ★ 网格高度：中间层 y 在大招(14)~根(86)间均匀分布，相邻层间距 = 72/(midLayers+1)%
    //   需层距像素 ≥ 112px（节点高约 92~105px），故 gridH = 156 * (midLayers+1)，6 技能(2 中间层)≈467px、9 技能(4 层)≈780px
    const gridH = Math.max(430, Math.ceil(156 * (midLayers + 1)));
    return { pos, links, gridH };
  }

  // Z 形折线：a → 垂直走一半 → 水平 → 垂直到 b（暗黑2 折线风格）
  function zPath(a, b) {
    const my = a.y + (b.y - a.y) * 0.5;
    return `M ${a.x} ${a.y} L ${a.x} ${my} L ${b.x} ${my} L ${b.x} ${b.y}`;
  }

  // 单节点 HTML（暗黑折线网格内的绝对定位节点）
  function nodeHtml(sk, i, pos, unlockedCount, currentTree, iconMap) {
    const isUlt = sk.grade === 's';
    const ultReady = isUlt ? unlockedCount >= 2 : true;   // ★ 大招需同列已解锁≥2（与服务端校验一致）
    const canBuy = sk.unlocked ? false : (currentTree.skillPoints >= sk.cost && ultReady);
    const stateCls = sk.unlocked ? 'unlocked' : (canBuy ? 'ready' : 'locked');
    const icon = (iconMap && iconMap[sk.name]) || '';
    const gradeColor = GRADE_COLOR[sk.grade] || '#8a93a3';
    const lockReason = sk.unlocked ? '' : (
      isUlt && !ultReady ? `大招需同流派已解锁≥2（当前${unlockedCount}）`
        : currentTree.skillPoints < sk.cost ? `精点不足（需 ${sk.cost}）`
        : ''
    );
    const tip = `${sk.name}${sk.unlocked ? '（已解锁）' : ''}${isUlt ? ' ★大招' : ''}\n${lockReason || (canBuy ? '点击解锁' : '')}`;
    return `
      <div class="st4-node st4-dnode ${stateCls} ${sk.equipped ? 'equipped' : ''} ${isUlt ? 'ult' : ''} ${i === 0 ? 'root' : ''}"
           data-name="${sk.name}" data-canbuy="${canBuy}" data-lock="${lockReason}" title="${tip}"
           style="--stg:${gradeColor}; left:${pos.x}%; top:${pos.y}%">
        <div class="st4-ring">
          ${isUlt ? '<span class="st4-ultmark">★</span>' : `<span class="st4-rank">${i + 1}</span>`}
          ${icon ? `<img class="st4-icon" src="${icon}" alt="">` : '<span class="st4-emoji">⚔</span>'}
          ${sk.unlocked ? '<span class="st4-check">✔</span>' : ''}
          ${sk.equipped ? '<span class="st4-eq">战</span>' : ''}
        </div>
        <div class="st4-name">${sk.name}</div>
        <div class="st4-cost">${sk.unlocked ? '已解锁' : (sk.cost + '✦')}</div>
      </div>`;
  }

  async function render() {
    // ★ 空态：职业无技能树系统 → 居中占位提示（嵌入页不空白、居中放置）
    if (!currentTree || !currentTree.schools || !currentTree.schools.length) {
      const pts = document.getElementById('stPoints'); if (pts) pts.textContent = '✦ 技能精点：0';
      const car = document.getElementById('stCareer'); if (car) car.textContent = '';
      const pv = document.getElementById('stPassive'); if (pv) pv.innerHTML = '';
      const tree = document.getElementById('stTree');
      if (tree) tree.innerHTML = '<div class="cd-empty">当前职业暂无技能树系统</div>';
      return;
    }
    const iconMap = await loadIconMap(currentTree.id) || null;
    document.getElementById('stPoints').textContent = `✦ 技能精点：${currentTree.skillPoints}`;
    document.getElementById('stCareer').textContent = `${currentTree.name} · 主属性 ${currentTree.mainAttr.toUpperCase()} · 资源「${currentTree.resource}」`;

    // 被动
    const pv = document.getElementById('stPassive');
    pv.innerHTML = `<div class="st-passive-row">
      <span class="st-icon">✨</span>
      <div><strong>被动 · ${currentTree.passive.name}</strong>
      <div class="st-passive-desc">（常驻被动，开局自带，无需解锁）</div></div>
    </div>`;

    // ★ 必备技能（innate）：像被动一样常驻、开局自带，从技能树单列展示（点击查看效果）
    const innateEl = document.getElementById('stInnate');
    if (innateEl) {
      const innate = currentTree.innate || [];
      innateEl.innerHTML = innate.map(sk => `
        <div class="st-innate-item" data-name="${escHtml(sk.name)}" title="点击查看效果">
          <span class="st-innate-icon">⚔</span>
          <div class="st-innate-info">
            <strong>必备 · ${escHtml(sk.name)}</strong>
            <div class="st-passive-desc">${escHtml((sk.detail && sk.detail.desc) || '')}</div>
          </div>
        </div>`).join('');
      innateEl.querySelectorAll('.st-innate-item').forEach(el => {
        el.addEventListener('click', () => showSkillDetail({ dataset: { name: el.dataset.name, canbuy: 'false' } }));
      });
    }

    // ★ 暗黑2 折线形技能树：每个流派一个网格，节点按动态菱形树绝对定位 + SVG Z 形折线；大招在顶部
    const tree = document.getElementById('stTree');
    tree.innerHTML = currentTree.schools.map(school => {
      const skills = school.skills;
      const unlockedCount = skills.filter(sk => sk.unlocked).length;
      const { pos, links: treeLinks, gridH } = treeLayout(skills);
      // 节点（按 pos 位置绝对定位）
      const nodes = skills.map((sk, i) => nodeHtml(sk, i, pos[i] || { x: 50, y: 50 }, unlockedCount, currentTree, iconMap)).join('');
      // Z 形折线（SVG，随容器缩放）
      const links = treeLinks.map(([a, b]) => {
        const on = (skills[a] && skills[b]) ? (skills[a].unlocked && skills[b].unlocked) : false;
        return `<path class="st4-dlink ${on ? 'on' : ''}" d="${zPath(pos[a], pos[b])}"/>`;
      }).join('');
      return `
        <div class="st4-col">
          <div class="st4-school-title">${school.name}</div>
          <div class="st4-grid" style="height:${gridH}px">
            <svg class="st4-svg" viewBox="0 0 100 100" preserveAspectRatio="none">${links}</svg>
            ${nodes}
          </div>
          <div class="st4-progress">解锁 ${unlockedCount}/${skills.length}</div>
        </div>`;
    }).join('');

    // ★ 点击节点 → 查看技能具体效果（详情浮层，内含解锁按钮）
    tree.querySelectorAll('.st4-node').forEach(node => {
      node.addEventListener('click', (e) => { e.stopPropagation(); showSkillDetail(node); });
    });
  }

  // ---- 点击技能查看具体效果（详情浮层） ----
  function findSkillByName(name) {
    if (!currentTree) return null;
    for (const sc of currentTree.schools) {
      const f = sc.skills.find(sk => sk.name === name);
      if (f) return f;
    }
    const g = (currentTree.innate || []).find(sk => sk.name === name);
    if (g) return g;
    return null;
  }
  function closeSkillDetail() {
    if (!overlay) return;
    const d = overlay.querySelector('.st4-detail');
    if (d) d.remove();
  }
  function showSkillDetail(node) {
    if (!overlay || !currentTree) return;
    const name = (node && node.dataset) ? node.dataset.name : ((node && node.name) || '');
    const sk = findSkillByName(name);
    if (!sk) return;
    closeSkillDetail();
    const d = sk.detail || null;
    const gradeColor = GRADE_COLOR[sk.grade] || '#8a93a3';
    // 消耗行（精点 / AP / 冷却）
    const meta = [`✦ 精点 ${sk.cost}`];
    if (d && d.ap != null) meta.push(`⚡ AP ${d.ap}`);
    if (d && d.cd != null) meta.push(`⏳ 冷却 ${d.cd} 回合`);
    // 类型 / 目标 / 元素标签
    const tags = [];
    if (d && d.type) tags.push(DETAIL_LABEL.type[d.type] || d.type);
    if (d && d.target) tags.push(DETAIL_LABEL.target[d.target] || d.target);
    if (d && d.element) tags.push(DETAIL_LABEL.element[d.element] || d.element);
    const tagHtml = tags.length ? `<div class="st4-detail-tags">${tags.map(t => `<span class="st4-detail-tag">${escHtml(t)}</span>`).join('')}</div>` : '';
    // 状态 / 操作
    const canbuy = (node && node.dataset) ? node.dataset.canbuy : 'false';
    let actionHtml = '';
    if (sk.unlocked) {
      actionHtml = `<div class="st4-detail-state st4-detail-ok">✔ 已解锁${sk.equipped ? ' · 出战中' : ''}</div>`;
    } else if (canbuy === 'true') {
      actionHtml = `<button class="st4-detail-unlock" data-name="${escHtml(sk.name)}">🔓 解锁（${sk.cost}✦）</button>`;
    } else {
      actionHtml = `<div class="st4-detail-state st4-detail-lock">🔒 ${escHtml((node && node.dataset && node.dataset.lock) || '前置未满足')}</div>`;
    }
    const detailDiv = document.createElement('div');
    detailDiv.className = 'st4-detail';
    // ★ 王者荣耀风格：头部大图标 + 名称 + 稀有度 + 状态副标题
    const iconImg = (node && node.querySelector) ? node.querySelector('.st4-ring img.st4-icon') : null;
    const iconHtml = iconImg ? iconImg.outerHTML : `<span class="st4-detail-emoji">${sk.grade === 's' ? '★' : '⚔'}</span>`;
    const stateSub = sk.unlocked ? '✔ 已解锁' : (node.dataset.canbuy === 'true' ? '可解锁' : '未解锁');
    detailDiv.innerHTML = `
      <div class="st4-detail-mask"></div>
      <div class="st4-detail-card">
        <button class="st4-detail-close" title="关闭">✕</button>
        <div class="st4-detail-head">
          <div class="st4-detail-icon">${iconHtml}</div>
          <div class="st4-detail-id">
            <div class="st4-detail-name" style="color:${gradeColor}">${escHtml(sk.name)}</div>
            <div class="st4-detail-sub">${gradeBadge(sk.grade)}<span class="st4-detail-state-tag">${escHtml(stateSub)}</span></div>
          </div>
        </div>
        <div class="st4-detail-desc">${escHtml((d && d.desc) || '（暂无效果描述）')}</div>
        ${tagHtml}
        <div class="st4-detail-meta">${meta.join('　')}</div>
        ${actionHtml}
      </div>`;
    overlay.appendChild(detailDiv);
    detailDiv.querySelector('.st4-detail-close').addEventListener('click', closeSkillDetail);
    detailDiv.querySelector('.st4-detail-mask').addEventListener('click', closeSkillDetail);
    const unlockBtn = detailDiv.querySelector('.st4-detail-unlock');
    if (unlockBtn) unlockBtn.addEventListener('click', () => {
      window.socket.emit('unlockSkill', { skillName: unlockBtn.dataset.name });
      closeSkillDetail();
    });
  }

  function init() {
    if (document.getElementById('skillTreeOverlay')) return;
    createDOM();
    if (window.socket) {
      window.socket.on('skillTreeData', (data) => {
        if (!data.enabled) {
          currentTree = null;
          (window.showToast || function(m){ alert(m); })('当前职业暂无技能树系统');
          render();   // ★ 嵌入页显示居中空态，而非留白
          return;
        }
        currentTree = data.tree;
        render();
      });
      window.socket.on('error', ({ msg }) => {
        if (msg && /精点|解锁|技能/.test(msg) && overlay && overlay.classList.contains('active')) {
          (window.showToast || function(m){ alert(m); })(msg);
          window.socket.emit('getSkillTree');
        }
      });
    }
  }

  window.SkillTree = {
    init,
    open: () => {
      init();
      if (overlay) {
        overlay.classList.remove('embed');
        if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
      }
      window.socket.emit('getSkillTree');
      showModal(overlay, true);
    },
    openEmbed: (containerId) => {
      init();
      if (overlay) {
        overlay.classList.add('embed');   // ★ 关键：置为占满内嵌（否则仍是全屏 fixed 浮窗）
        if (overlay.dataset.embedParent !== containerId) {
          const p = document.getElementById(containerId);
          if (p) { p.appendChild(overlay); overlay.dataset.embedParent = containerId; }
        }
      }
      window.socket.emit('getSkillTree');
      showModal(overlay, true);
    },
    close: () => { if (overlay) showModal(overlay, false); }
  };
})();
