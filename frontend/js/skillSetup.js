/**
 * 技能搭配页面模块（进副本前选择出战技能）
 * 依赖：window.socket、window.getCurrentCharacter()
 * 事件：getSkillTree / skillTreeData / saveSkillSetup / skillSetupSaved
 * 规则：被动常驻；主动最多出战 5 个（可从任意流派勾选）
 */
(function() {
  let overlay = null;
  let currentTree = null;
  let chosen = [];   // 已勾选的主动技能名
  let iconMap = null;

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

  function createDOM() {
    if (document.getElementById('skillSetupOverlay')) return;
    const o = document.createElement('div');
    o.id = 'skillSetupOverlay';
    o.className = 'modal skill-setup-overlay';
    o.innerHTML = `
      <div class="modal-content skill-setup-box">
        <h2>⚔ 技能搭配</h2>
        <p class="st-career">进副本前选择出战技能（主动最多 <b>5</b> 个，被动常驻）</p>
        <div id="ssPassive" class="st-passive"></div>
        <div id="ssCounter" class="ss-counter"></div>
        <div id="ssSkillList" class="ss-skill-list"></div>
        <div class="modal-actions">
          <button id="btnSsSave" class="btn-primary">保存出战配置</button>
          <button id="btnSsClose" class="btn-secondary">关闭</button>
        </div>
      </div>
    `;
    document.body.appendChild(o);
    overlay = o;
    document.getElementById('btnSsSave').addEventListener('click', () => {
      window.socket.emit('saveSkillSetup', { equippedSkills: chosen });
    });
    document.getElementById('btnSsClose').addEventListener('click', () => showModal(overlay, false));
  }

  function render() {
    if (!currentTree) return;
    const MAX = 5;
    const pv = document.getElementById('ssPassive');
    pv.innerHTML = `<div class="st-passive-row"><span class="st-icon">✨</span><div><strong>被动（常驻）· ${currentTree.passive.name}</strong></div></div>`;

    // 所有主动技能（平铺全部流派，标注流派）
    const all = [];
    currentTree.schools.forEach(s => s.skills.forEach(sk => {
      if (sk.unlocked) all.push({ ...sk, school: s.name });
    }));
    // 未解锁的技能也展示（置灰不可选），提示去技能树解锁
    const lockedPool = [];
    currentTree.schools.forEach(s => s.skills.forEach(sk => {
      if (!sk.unlocked) lockedPool.push({ ...sk, school: s.name });
    }));

    document.getElementById('ssCounter').textContent = `已选 ${chosen.length}/${MAX}（出战上限）`;

    const list = document.getElementById('ssSkillList');
    const renderAll = [...all, ...lockedPool];
    list.innerHTML = renderAll.map(sk => {
      const locked = !sk.unlocked;
      const checked = chosen.includes(sk.name);
      const icon = (iconMap && iconMap[sk.name]) || '';
      return `
        <label class="ss-row ${checked ? 'checked' : ''} ${locked ? 'locked' : ''}">
          <input type="checkbox" data-name="${sk.name}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}>
          <img class="ss-skill-img" src="${icon}" onerror="this.style.display='none'">
          <span class="ss-school">${sk.school}</span>
          <span class="ss-name">${sk.name} ${gradeBadge(sk.grade)}</span>
          ${locked ? '<span class="ss-lock-hint">🔒 未解锁</span>' : (sk.equipped ? '<span class="st-equipped-tag">出战</span>' : '')}
        </label>
      `;
    }).join('');

    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const name = cb.dataset.name;
        if (cb.checked) {
          if (chosen.length >= MAX) { cb.checked = false; (window.showToast || function(m){ alert(m); })(`最多出战 ${MAX} 个技能`); return; }
          if (!chosen.includes(name)) chosen.push(name);
        } else {
          chosen = chosen.filter(n => n !== name);
        }
        render();
      });
    });
  }

  function init() {
    if (document.getElementById('skillSetupOverlay')) return;
    createDOM();
    if (window.socket) {
      window.socket.on('skillTreeData', async (data) => {
        if (!data.enabled) return;
        currentTree = data.tree;
        try {
          const resp = await fetch('/api/skill-icons-map');
          if (resp.ok) { const d = await resp.json(); if (d.success) iconMap = d.map[currentTree.id] || null; }
        } catch (e) {}
        chosen = currentTree.schools.flatMap(s => s.skills).filter(sk => sk.equipped).map(sk => sk.name);
        render();
      });
      window.socket.on('skillSetupSaved', (data) => {
        (window.showToast || function(m){ alert(m); })('出战配置已保存！');
        chosen = data.equippedSkills.slice();
        showModal(overlay, false);
      });
    }
  }

  window.SkillSetup = {
    init,
    open: () => {
      init();
      window.socket.emit('getSkillTree');
      showModal(overlay, true);
    },
    close: () => { if (overlay) showModal(overlay, false); }
  };
})();
