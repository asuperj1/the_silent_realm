/**
 * client-vote.js — 投票系统（2026-08-23 从 client.js 拆分）
 * 依赖：client.js 先加载（socket / 公共 UI 工具）
 */
function openVoteModal() {
  voteOptions = ['赞成', '反对', '弃权'];
  if (voteTitleInput) voteTitleInput.value = '';
  if (voteTimerInput) voteTimerInput.value = '30';
  if (voteForm) voteForm.style.display = '';
  if (voteInProgress) voteInProgress.style.display = 'none';
  if (voteTitlebarText) voteTitlebarText.textContent = '🗳 发起投票';
  if (voteMini) voteMini.style.display = 'none';
  renderVoteOptions();
  resetVoteBoxPosition();
  showModal(modalVote, true);
}
function renderVoteOptions() {
  if (!voteOptionsContainer) return;
  voteOptionsContainer.innerHTML = '';
  voteOptions.forEach((opt, index) => {
    const div = document.createElement('div'); div.className = 'vote-option-row';
    const color = VOTE_COLORS[index % VOTE_COLORS.length];
    div.innerHTML = `<span class="vote-option-color" style="background:${color}"></span><input type="text" class="vote-option-input" value="${escapeHtml(opt)}" data-index="${index}" placeholder="选项文本"><button class="btn-remove-option" data-index="${index}">✕</button>`;
    div.querySelector('.btn-remove-option').addEventListener('click', () => {
      if (voteOptions.length > 2) { voteOptions.splice(index, 1); renderVoteOptions(); }
    });
    div.querySelector('.vote-option-input').addEventListener('input', e => { voteOptions[index] = e.target.value; });
    voteOptionsContainer.appendChild(div);
  });
}
function submitVote() {
  const title = voteTitleInput?.value.trim() || '';
  if (!title) { showToast('请输入投票议题'); return; }
  const duration = parseInt(voteTimerInput?.value) || 30;
  const options = voteOptions.filter(o => o.trim() !== '');
  if (options.length < 2) { showToast('至少需要两个选项'); return; }
  socket.emit('teamVote', { title, options, duration });
  appendLog(publicLog, `【投票发起】${title}，选项：${options.join('、')}，倒计时 ${duration} 秒`, '系统');
  // 等待服务端 voteStart 广播后展示进度界面
}
// 显示投票进行中界面（王者投降风格：彩色进度条 + 已投/总数，点击选项投票）
function showVoteInProgress(data) {
  if (!modalVote) return;
  if (voteForm) voteForm.style.display = 'none';
  if (voteInProgress) voteInProgress.style.display = '';
  if (voteTitlebarText) voteTitlebarText.textContent = '🗳 投票中';
  if (vpTitle) vpTitle.textContent = (data && data.title) || '投票进行中';
  _voteState = {
    voteId: data && data.voteId, options: (data && data.options) || [],
    total: (data && data.total) || 0, voters: 0,
    tally: ((data && data.options) || []).map(() => 0), myVoted: false
  };
  renderVoteProgress();
  if (data && data.duration != null) startVoteCountdown(data.duration);
  showModal(modalVote, true);
}
function renderVoteProgress() {
  if (!vpOptions || !_voteState) return;
  const st = _voteState;
  vpOptions.innerHTML = '';
  st.options.forEach((opt, i) => {
    const color = VOTE_COLORS[i % VOTE_COLORS.length];
    const votes = (st.tally && st.tally[i]) || 0;
    const pct = st.total ? Math.round((votes / st.total) * 100) : 0;
    const div = document.createElement('div');
    div.className = 'vp-option';
    div.style.setProperty('--vp-color', color);
    div.innerHTML = `
      <div class="vp-option-head"><span class="vp-option-name">${escapeHtml(opt)}</span><span class="vp-option-num">${votes}/${st.total}</span></div>
      <div class="vp-track"><div class="vp-fill" style="width:${pct}%"></div></div>
      <div class="vp-option-pct">${pct}%</div>`;
    div.querySelector('.vp-track').addEventListener('click', () => {
      if (st.myVoted || !st.voteId) return;
      st.myVoted = true;
      socket.emit('vote', { voteId: st.voteId, optionIndex: i });
      div.classList.add('vp-mine');
      showToast('已投票：' + opt);
    });
    vpOptions.appendChild(div);
  });
  if (vpVoters) vpVoters.textContent = `已投 ${st.voters} / ${st.total}`;
}
function startVoteCountdown(duration) {
  let remaining = Math.max(1, parseInt(duration) || 30);
  if (vpCountdown) vpCountdown.textContent = remaining + 's';
  clearInterval(activeVoteTimer);
  activeVoteTimer = setInterval(() => {
    remaining--;
    if (vpCountdown) vpCountdown.textContent = Math.max(0, remaining) + 's';
    if (remaining <= 0) { clearInterval(activeVoteTimer); activeVoteTimer = null; }
  }, 1000);
}
// 关闭弹窗（隐藏）
function cancelVote() {
  clearInterval(activeVoteTimer);
  activeVoteTimer = null;
  showModal(modalVote, false);
  if (voteMini) voteMini.style.display = 'none';
}
// 最小化到角落小条 / 恢复
function minimizeVote() {
  showModal(modalVote, false);
  if (voteMini) {
    voteMini.style.display = 'flex';
    if (voteMiniText) voteMiniText.textContent = '🗳 ' + ((_voteState && _voteState.title) || '投票进行中');
  }
}
function restoreVote() {
  if (voteMini) voteMini.style.display = 'none';
  showModal(modalVote, true);
}
// 拖动弹窗（标题栏拖拽）
// ★ 幂等守卫：防止断线重连重复绑定 document 级拖拽监听
let _voteDragBound = false;
function enableVoteDrag() {
  if (_voteDragBound) return; _voteDragBound = true;
  if (!voteTitlebar || !voteBox) return;
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  voteTitlebar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    const r = voteBox.getBoundingClientRect();
    ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
    voteBox.style.position = 'fixed';
    voteBox.style.left = ox + 'px'; voteBox.style.top = oy + 'px';
    voteBox.style.margin = '0';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    voteBox.style.left = Math.max(0, Math.min(window.innerWidth - 100, ox + (e.clientX - sx))) + 'px';
    voteBox.style.top = Math.max(0, Math.min(window.innerHeight - 50, oy + (e.clientY - sy))) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}
function resetVoteBoxPosition() {
  if (!voteBox) return;
  voteBox.style.position = '';
  voteBox.style.left = '';
  voteBox.style.top = '';
  voteBox.style.margin = '';
}
// 投票进度 / 结果接收
socket.on('voteStart', (d) => { showVoteInProgress(d); });
socket.on('voteUpdate', (d) => {
  if (_voteState && d.voteId === _voteState.voteId) {
    _voteState.voters = d.voters || 0;
    _voteState.total = d.total != null ? d.total : _voteState.total;
    _voteState.tally = d.tally || _voteState.tally;
    renderVoteProgress();
  }
});
socket.on('voteResult', ({ tally, total, winner, summary }) => {
  clearInterval(activeVoteTimer);
  activeVoteTimer = null;
  if (_voteState && tally) { _voteState.tally = tally; _voteState.total = total != null ? total : _voteState.total; renderVoteProgress(); }
  if (summary) appendLog(publicLog, '投票结果: ' + summary, '队伍');
  // 稍作停留展示结果后自动关闭
  setTimeout(() => {
    showModal(modalVote, false);
    if (voteMini) voteMini.style.display = 'none';
    _voteState = null;
  }, 2600);
});
