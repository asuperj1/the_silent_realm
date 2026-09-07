/**
 * 副本结算总结页面模块
 * 依赖：全局 window.socket
 * 在副本结束后自动弹出居中结算弹窗，展示评分、经验、属性加点
 */

(function() {
  let settlementOverlay = null;

  // 工具函数
  function showModal(modal, show) {
    if (!modal) return;
    if (show) modal.classList.add('active');
    else modal.classList.remove('active');
  }

  // ★ XSS 防护：HTML 转义（结算旁白为服务端/AI 文本，必须转义后再插入）
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 创建结算弹窗 DOM（仅执行一次）
  function createSettlementDOM() {
    if (document.getElementById('settlementOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'settlementOverlay';
    overlay.className = 'modal settlement-overlay';
    overlay.innerHTML = `
      <div class="modal-content settlement-box">
        <h2>📜 副本结算</h2>
        <div id="settleGrade"></div>
        <div id="settleExp"></div>
        <div id="settleLevel"></div>
        <div id="settleReward"></div>
        <div id="settleSkillReward" class="settle-skill-reward"></div>
        <div id="settleNarrative"></div>
        <div id="settleReview"></div>
        <div id="settleItems"></div>
        <div class="modal-actions">
          <button id="btnSettleBack">返回大厅</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    settlementOverlay = overlay;

    // 绑定滑块与按钮事件
    bindSettlementEvents();
  }

  function bindSettlementEvents() {
    // ★ 副本结算不再提供加点（已由调查员大厅「属性分配」全面替代）——仅保留返回大厅
    const backBtn = document.getElementById('btnSettleBack');
    if (backBtn) backBtn.addEventListener('click', () => {
      showModal(settlementOverlay, false);
      // ★ 返回大厅：服务端结算时已删除副本房间 → 刷新角色列表并切回调查员档案大厅（修复：此前只关弹窗不跳转导致卡在副本页）
      const uid = (window._currentUser && window._currentUser.uid) || (window.currentUser && window.currentUser.uid) || localStorage.getItem('playerUID');
      if (window.socket && uid) window.socket.emit('getCharacterList', { uid });
      if (typeof showPage === 'function') showPage(document.getElementById('pageCharacters'));
    });
  }

  function renderSettlement(data) {
    const {
      grade,
      totalScore,
      expGained,
      currentLevel,
      expToNext,
      freeAttributePoints,
      currentAttr,
      rewards,
      newItems,
      // 副本专属字段
      endingNarrative,
      trait,
      easterEgg,
      review // ★ P3 副本回顾（线索/真相/对讲机/回合/陈慧）
    } = data;

    // S/A/B/C/D 等级颜色映射
    const gradeStyle = {
      'S': { color: '#ffd700', glow: '0 0 20px rgba(255,215,0,0.6)', icon: '🏆' },
      'A': { color: '#00ccff', glow: '0 0 14px rgba(0,204,255,0.4)', icon: '⭐' },
      'B': { color: '#88cc88', glow: '0 0 10px rgba(136,204,136,0.3)', icon: '✅' },
      'C': { color: '#cc9933', glow: '0 0 8px rgba(204,153,51,0.3)', icon: '⚠️' },
      'D': { color: '#cc4444', glow: '0 0 8px rgba(204,68,68,0.3)', icon: '💀' }
    };
    const gs = gradeStyle[grade] || gradeStyle['B'];

    const gradeEl = document.getElementById('settleGrade');
    gradeEl.innerHTML = `<span style="font-size:28px;">${gs.icon}</span> 副本评级：<span style="color:${gs.color};text-shadow:${gs.glow};font-size:22px;font-weight:bold;">${grade}</span>（总分 ${totalScore}）`;

    document.getElementById('settleExp').textContent = `获得经验：+${expGained}`;
    document.getElementById('settleLevel').textContent = `当前等级：${currentLevel}，下一级还需 ${expToNext} 经验`;

    // 奖励行：诡秘点数 + 特质 + 彩蛋
    let rewardText = `获得诡秘点数：${rewards?.mysteryPoint || 0}`;
    if (trait) rewardText += `　|　特质：【${trait}】`;
    if (easterEgg) rewardText += `　|　🎁 ${easterEgg}`;
    document.getElementById('settleReward').textContent = rewardText;

    // ★ 技能精点奖励（技能树系统）
    const skillRewardDiv = document.getElementById('settleSkillReward');
    if (data.skillTreeEnabled && data.skillPointsGained >= 0) {
      const gs2 = gradeStyle[grade] || gradeStyle['B'];
      skillRewardDiv.innerHTML = `
        <div class="skill-reward-box" style="border-left:3px solid ${gs2.color}">
          <div class="skill-reward-line">✦ 技能精点奖励：<b style="color:#ffd700">+${data.skillPointsGained}</b>（评级 ${grade}）</div>
          <div class="skill-reward-line">当前技能精点存量：<b>${data.skillPointsTotal}</b></div>
          <button id="btnSettleGoTree" class="btn-settle-tree">🌳 前往技能树解锁技能</button>
        </div>
      `;
      const goTree = document.getElementById('btnSettleGoTree');
      if (goTree) goTree.addEventListener('click', () => {
        showModal(settlementOverlay, false);
        if (window.SkillTree) window.SkillTree.open();
      });
    } else {
      skillRewardDiv.innerHTML = '';
    }

    // 结局叙事文本（独立区域，不覆盖道具）
    // ★ XSS 修复：AI 生成旁白可能含 HTML，先转义再换行转 <br>
    const narrDiv = document.getElementById('settleNarrative');
    if (endingNarrative) {
      narrDiv.innerHTML = `<div class="ending-narrative" style="margin:12px 0;padding:12px;border-left:3px solid ${gs.color};background:rgba(0,0,0,0.3);font-style:italic;line-height:1.8;color:#c0b090;white-space:pre-wrap;">${escapeHtml(endingNarrative)}</div>`;
    } else {
      narrDiv.innerHTML = '';
    }

    // ★ 副本结算不再提供自由属性加点（已由调查员大厅「属性分配」全面替代）——直接跳过属性面板

    // 新获得道具
    // ★ XSS 修复：道具名统一转义
    const itemsDiv = document.getElementById('settleItems');
    if (newItems && newItems.length > 0) {
      itemsDiv.innerHTML = '<h4>获得道具</h4>' + newItems.map(item => `<span class="settle-item">${escapeHtml(item.name)}</span>`).join(', ');
    } else {
      itemsDiv.innerHTML = '';
    }

    // ★ P3 副本回顾：一局探索时间线（线索/真相/对讲机/回合/陈慧）
    const reviewDiv = document.getElementById('settleReview');
    if (reviewDiv && review) {
      const truthPct = Math.round((Math.min(3, review.truthTier || 0) / 3) * 100);
      const clueHtml = (review.clues || []).map(c =>
        `<span class="review-clue">${c.icon || '📜'} ${escapeHtml(c.name)}</span>`
      ).join('');
      reviewDiv.innerHTML = `
        <div class="settle-review">
          <div class="review-head">🧭 副本回顾</div>
          <div class="review-grid">
            <div class="review-cell"><span class="rv-label">探索回合</span><b class="rv-val">${Number(review.turns) || 0}</b></div>
            <div class="review-cell"><span class="rv-label">真相层级</span><b class="rv-val">${escapeHtml(review.truthLabel)}</b></div>
            ${review.walkieStage > 0 ? `<div class="review-cell"><span class="rv-label">对讲机支线</span><b class="rv-val">${escapeHtml(review.walkieLabel)}</b></div>` : ''}
            <div class="review-cell"><span class="rv-label">陈慧</span><b class="rv-val">${review.chenHuiRescued ? '✅ 已救出' : (review.chenHuiAlive ? '存活' : '💀 陨落')}</b></div>
          </div>
          <div class="review-progress"><div class="review-progress-fill" style="width:${truthPct}%"></div></div>
          <div class="review-clues-title">📜 收集到的线索</div>
          ${clueHtml ? `<div class="review-clues">${clueHtml}</div>` : '<div class="review-empty">本局未收集到线索</div>'}
        </div>`;
    } else if (reviewDiv) {
      reviewDiv.innerHTML = '';
    }
  }

  // 监听结算事件
  if (window.socket) {
    window.socket.on('copySettlement', (data) => {
      createSettlementDOM();
      renderSettlement(data);
      showModal(settlementOverlay, true);
    });

    window.socket.on('pointsApplied', () => {
      (window.showAlert || function(m){ alert(m); })('属性分配成功！');
      if (settlementOverlay) showModal(settlementOverlay, false);
    });
  }

  // 暴露全局接口
  window.Settlement = {
    show: (data) => {
      createSettlementDOM();
      renderSettlement(data);
      showModal(settlementOverlay, true);
    }
  };
})();