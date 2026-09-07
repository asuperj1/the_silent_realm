/**
 * questBoard.js — 完整任务系统前端模块（接受 / 提交 / 奖励 / 记录）
 * 集成点：详情页「任务」标签 + 房间大厅「📋 任务板」按钮（进入副本前）
 * 依赖：window.socket、window.showToast、window.showConfirm
 * 事件：getQuestBoard / questBoard / acceptQuest / submitQuest / questRewarded
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => { if (window.showToast) window.showToast(m); };
  let _bound = false;
  let _data = null;            // 最近一次 questBoard 数据
  let _activeContainer = null; // 当前活跃渲染容器（详情页任务标签 或 大厅弹窗）
  let _activeTab = 'available'; // ★ 任务模块子功能：available 可接取 / doing 进行中 / record 任务记录

  // 奖励文本
  function rewardText(r) {
    const parts = [];
    if (r.exp) parts.push('经验+' + r.exp);
    if (r.mysteryPoint) parts.push('寂静点数+' + r.mysteryPoint);
    if (r.skillPoints) parts.push('技能精点+' + r.skillPoints);
    return parts.join(' · ') || '无';
  }

  // 状态徽标
  function statusBadge(st) {
    const map = { available: ['可接取', 'stq-avail'], doing: ['进行中', 'stq-doing'], done: ['可提交', 'stq-done'], claimed: ['已领取', 'stq-claimed'] };
    const [label, cls] = map[st] || ['未知', ''];
    return `<span class="stq-badge ${cls}">${label}</span>`;
  }

  // 任务卡片 HTML
  function questCard(q) {
    const t = q.target || {};
    const need = t.count || 1;
    const prog = Math.min(q.progress || 0, need);
    const pct = Math.min(100, Math.round((prog / need) * 100));
    let actBtn = '';
    if (q.status === 'available') {
      actBtn = `<button class="stq-btn accept" data-act="accept" data-id="${esc(q.id)}">📥 接受任务</button>`;
    } else if (q.status === 'doing') {
      actBtn = `<button class="stq-btn" disabled>进行中…</button>`;
    } else if (q.status === 'done') {
      actBtn = `<button class="stq-btn submit" data-act="submit" data-id="${esc(q.id)}">🎁 提交领取奖励</button>`;
    } else if (q.status === 'claimed') {
      actBtn = `<button class="stq-btn" disabled>已领取</button>`;
    }
    return `
      <div class="stq-card ${q.status === 'done' ? 'stq-card-done' : ''}">
        <div class="stq-head">
          <span class="stq-type">${esc(q.type || '')}</span>
          <span class="stq-title">${esc(q.title || '')}</span>
          ${statusBadge(q.status)}
        </div>
        <div class="stq-desc">${esc(q.desc || '')}</div>
        <div class="stq-progress-row">
          <span class="stq-reward">🎁 ${rewardText(q.reward || {})}</span>
          ${q.status === 'doing' || q.status === 'done'
            ? `<div class="stq-bar"><div class="stq-bar-fill" style="width:${pct}%"></div></div><span class="stq-count">${prog}/${need}</span>`
            : ''}
        </div>
        <div class="stq-actions">${actBtn}</div>
      </div>`;
  }

  // 渲染任务板到容器（★ 子功能：可接取任务 / 进行中任务 / 任务记录 三个子 tab）
  function renderTo(container, data) {
    if (!container) return;
    if (!data) {
      container.innerHTML = '<div class="cd-empty">任务板加载中…</div>';
      return;
    }
    const quests = data.quests || [];
    const history = data.history || [];
    const avail = quests.filter(q => q.status === 'available');
    const active = quests.filter(q => q.status === 'doing' || q.status === 'done' || q.status === 'claimed');
    const panelOf = (key) => {
      if (key === 'available') {
        return `<div class="stq-section-title">🎯 可接取任务 <span class="stq-count-hint">${avail.length}</span></div>
          <div class="stq-list">${avail.length ? avail.map(questCard).join('') : '<div class="cd-empty">暂无更多可接取任务</div>'}</div>`;
      }
      if (key === 'doing') {
        return `<div class="stq-section-title">📜 进行中任务 <span class="stq-count-hint">${active.length}</span></div>
          <div class="stq-list">${active.length ? active.map(questCard).join('') : '<div class="cd-empty">尚未接受任何任务——进入副本前先接取任务吧</div>'}</div>`;
      }
      return `<div class="stq-section-title">🏅 任务记录 <span class="stq-count-hint">${history.length}</span></div>
        ${history.length
          ? `<div class="stq-history">${history.map(h => `
              <div class="stq-hrow">
                <span class="stq-h-title">${esc(h.title || '')}</span>
                <span class="stq-h-meta">${esc(h.type || '')} · ${esc(h.time || '')} · 🎁 ${rewardText(h.reward || {})}</span>
              </div>`).join('')}</div>`
          : '<div class="cd-empty">暂无已完成任务记录</div>'}`;
    };
    container.innerHTML = `
      <div class="stq-board">
        <div class="stq-tabs">
          <button class="stq-tab ${_activeTab === 'available' ? 'active' : ''}" data-stab="available">🎯 可接取任务</button>
          <button class="stq-tab ${_activeTab === 'doing' ? 'active' : ''}" data-stab="doing">📜 进行中任务</button>
          <button class="stq-tab ${_activeTab === 'record' ? 'active' : ''}" data-stab="record">🏅 任务记录</button>
        </div>
        <div class="stq-panel" data-stpanel="available" ${_activeTab === 'available' ? '' : 'style="display:none"'}>${panelOf('available')}</div>
        <div class="stq-panel" data-stpanel="doing" ${_activeTab === 'doing' ? '' : 'style="display:none"'}>${panelOf('doing')}</div>
        <div class="stq-panel" data-stpanel="record" ${_activeTab === 'record' ? '' : 'style="display:none"'}>${panelOf('record')}</div>
      </div>`;
    // 子功能 tab 切换
    container.querySelectorAll('.stq-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _activeTab = tab.dataset.stab;
        renderAll();
      });
    });
    // 事件绑定（接受 / 提交）
    container.querySelectorAll('.stq-btn[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        if (act === 'accept') {
          window.socket.emit('acceptQuest', { questId: id });
        } else if (act === 'submit') {
          const ok = await (window.showConfirm ? window.showConfirm('确定提交该任务并领取奖励吗？') : Promise.resolve(confirm('确定提交该任务并领取奖励吗？')));
          if (ok) window.socket.emit('submitQuest', { questId: id });
        }
      });
    });
  }

  // ==================== 渲染到当前活跃容器 ====================
  function renderAll() {
    if (_activeContainer) renderTo(_activeContainer, _data);
  }

  // 请求任务板
  function request() {
    if (window.socket && window.socket.connected) window.socket.emit('getQuestBoard');
  }

  function init() {
    if (_bound) return;
    _bound = true;
    if (window.socket) {
      window.socket.on('questBoard', (data) => {
        _data = data;
        renderAll();
      });
      window.socket.on('questRewarded', ({ title, reward }) => {
        toast(`🎉 任务完成【${title}】：${rewardText(reward || {})}`);
      });
      window.socket.on('error', ({ msg }) => {
        if (msg && /任务/.test(msg)) toast('⚠️ ' + msg);
      });
    }
  }

  window.QuestBoard = {
    init,
    /** 渲染到容器并请求数据（详情页任务标签 / 大厅弹窗） */
    open(container) {
      init();
      if (container) _activeContainer = container;
      renderTo(container, _data);
      request();
    },
    /** 关闭容器（详情页离开标签 / 大厅弹窗关闭时调用） */
    close(container) {
      if (_activeContainer === container) _activeContainer = null;
    }
  };
})();
