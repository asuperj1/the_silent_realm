// questSystem.js — 完整任务系统（接受 / 提交 / 奖励 / 记录）
// 事件：getQuestBoard / acceptQuest / submitQuest
// 进度推进：副本结算时由 gameHandler.settleCopy 调用 advanceQuests(character, settleInfo)
// 角色字段：character.activeQuests=[{id, progress, status:'doing'|'done', acceptedAt}] / character.questHistory=[{id,title,type,time,reward}]
const logger = require('./logger');

// ==================== ★ 任务池定义 ====================
// target.type：escape 逃离副本 / clear 累计通关 / clue 累计线索 / walkie 联系陈慧 / rescue 营救陈慧 / shoggoth 击败修格斯 / grade 达成评价
const QUESTS = [
  // ===== 青峰山主线 =====
  { id: 'qf_main_escape', title: '逃离青峰山列车', type: '主线', copy: '青峰山',
    desc: '找到 8 号车尾的紧急疏散通道，活着离开这列列车。',
    target: { type: 'escape', count: 1 }, reward: { exp: 30, mysteryPoint: 25, skillPoints: 2 } },
  // ===== 青峰山支线 =====
  { id: 'qf_side_clue', title: '拼凑真相', type: '支线', copy: '青峰山',
    desc: '收集列车上的线索（至少 3 条），厘清这列车上发生了什么。',
    target: { type: 'clue', count: 3 }, reward: { exp: 20, mysteryPoint: 15, skillPoints: 1 } },
  { id: 'qf_side_chenhui', title: '联系陈慧', type: '支线', copy: '青峰山',
    desc: '用对讲机联系乘务员陈慧，从她口中获取关键情报。',
    target: { type: 'walkie', count: 1 }, reward: { exp: 15, mysteryPoint: 10 } },
  { id: 'qf_side_rescue', title: '营救陈慧', type: '支线', copy: '青峰山',
    desc: '前往 7 号车设备间，救出被困在门后的陈慧。',
    target: { type: 'rescue', count: 1 }, reward: { exp: 25, mysteryPoint: 18, skillPoints: 1 } },
  { id: 'qf_side_shoggoth', title: '清除修格斯幼体', type: '支线', copy: '青峰山',
    desc: '击败盘踞在 8 号车通道口的修格斯幼体，打通逃生通道。',
    target: { type: 'shoggoth', count: 1 }, reward: { exp: 25, mysteryPoint: 18 } },
  // ===== 通用成就（任意副本） =====
  { id: 'gen_clear_1', title: '初入寂静之地', type: '成就', copy: null,
    desc: '通关任意副本 1 次。',
    target: { type: 'clear', count: 1 }, reward: { exp: 40, mysteryPoint: 30, skillPoints: 3 } },
  { id: 'gen_clear_3', title: '轮回行者', type: '成就', copy: null,
    desc: '累计通关副本 3 次。',
    target: { type: 'clear', count: 3 }, reward: { exp: 60, mysteryPoint: 50, skillPoints: 4 } },
  { id: 'gen_clue_10', title: '真相猎手', type: '成就', copy: null,
    desc: '累计收集线索 10 条。',
    target: { type: 'clue', count: 10 }, reward: { exp: 50, mysteryPoint: 40, skillPoints: 3 } },
  { id: 'gen_grade_s', title: '极致评价', type: '成就', copy: null,
    desc: '任意副本获得 S 级评价。',
    target: { type: 'grade', grade: 'S', count: 1 }, reward: { exp: 80, mysteryPoint: 60, skillPoints: 5 } }
];

function findQuest(id) { return QUESTS.find(q => q.id === id) || null; }

// ==================== 任务板数据 ====================
function buildQuestBoard(character) {
  const active = character.activeQuests || [];
  const history = character.questHistory || [];
  return {
    quests: QUESTS.map(def => {
      const act = active.find(a => a.id === def.id);
      const claimed = history.some(h => h.id === def.id);
      let status = 'available'; // 可接
      let progress = 0;
      if (act) { status = act.status; progress = act.progress || 0; }   // doing / done
      else if (claimed) status = 'claimed';                             // 已领取（可重复成就仍可接）
      return { ...def, status, progress, acceptedAt: act ? act.acceptedAt : null };
    }),
    history: history.slice().reverse()
  };
}

// ==================== 进度推进（副本结算时调用） ====================
// settleInfo = { cleared, copyName, grade, cluesFound, shoggothDefeated, chenHuiRescued, walkieStage }
// 返回本次是否有任务完成（供前端提示/存档）
function advanceQuests(character, settle) {
  if (!character || !settle) return { changed: false, done: [] };
  if (!Array.isArray(character.activeQuests)) character.activeQuests = [];
  let changed = false;
  const doneNow = [];
  for (const q of character.activeQuests) {
    if (q.status === 'done') continue;
    const def = findQuest(q.id);
    if (!def) continue;
    // 副本限定匹配
    if (def.copy && !String(settle.copyName || '').includes(def.copy)) continue;
    const t = def.target;
    let progress = q.progress || 0;
    switch (t.type) {
      case 'escape': progress = settle.cleared ? Math.max(progress, 1) : progress; break;
      case 'clear': progress = settle.cleared ? progress + 1 : progress; break;
      case 'clue': progress = Math.max(progress, settle.cluesFound || 0); break;
      case 'walkie': progress = (settle.walkieStage || 0) >= 1 ? Math.max(progress, 1) : progress; break;
      case 'rescue': progress = settle.chenHuiRescued ? Math.max(progress, 1) : progress; break;
      case 'shoggoth': progress = settle.shoggothDefeated ? Math.max(progress, 1) : progress; break;
      case 'grade': progress = (settle.grade === t.grade) ? Math.max(progress, 1) : progress; break;
      default: break;
    }
    q.progress = Math.min(progress, t.count || 1);
    if (q.progress >= (t.count || 1) && q.status !== 'done') {
      q.status = 'done';
      doneNow.push(def);
    }
    if (progress > 0) changed = true;
  }
  return { changed, done: doneNow };
}

// ==================== 奖励发放 ====================
function grantReward(character, quest) {
  const r = quest.reward || {};
  character.exp = (character.exp || 0) + (r.exp || 0);
  character.mysteryPoint = (character.mysteryPoint || 0) + (r.mysteryPoint || 0);
  // 技能精点：仅新职业技能树角色有该字段
  if (typeof character.skillPoints === 'number') {
    character.skillPoints += (r.skillPoints || 0);
  }
  return {
    exp: r.exp || 0,
    mysteryPoint: r.mysteryPoint || 0,
    skillPoints: (typeof character.skillPoints === 'number') ? (r.skillPoints || 0) : 0
  };
}

// ==================== Socket 事件 ====================
function registerQuestSystem(socket, io, state) {
  // 任务板
  socket.on('getQuestBoard', () => {
    const character = socket.character;
    if (!character) return socket.emit('error', { msg: '未加载角色' });
    socket.emit('questBoard', buildQuestBoard(character));
  });

  // 接受任务
  socket.on('acceptQuest', ({ questId }) => {
    const character = socket.character;
    if (!character) return socket.emit('error', { msg: '未加载角色' });
    const def = findQuest(questId);
    if (!def) return socket.emit('error', { msg: '任务不存在' });
    if (!Array.isArray(character.activeQuests)) character.activeQuests = [];
    if (character.activeQuests.some(q => q.id === questId)) {
      return socket.emit('error', { msg: '该任务已接受' });
    }
    character.activeQuests.push({ id: questId, progress: 0, status: 'doing', acceptedAt: Date.now() });
    require('./storage').saveCharacter(character);
    socket.emit('questBoard', buildQuestBoard(character));
    socket.emit('publicMsg', { msg: `📜 接受任务：【${def.title}】`, sender: '系统' });
    logger.user.info('接受任务', { uid: character.uid, quest: questId });
  });

  // 提交任务（领取奖励）
  socket.on('submitQuest', ({ questId }) => {
    const character = socket.character;
    if (!character) return socket.emit('error', { msg: '未加载角色' });
    const def = findQuest(questId);
    if (!def) return socket.emit('error', { msg: '任务不存在' });
    if (!Array.isArray(character.activeQuests)) character.activeQuests = [];
    const act = character.activeQuests.find(q => q.id === questId);
    if (!act) return socket.emit('error', { msg: '尚未接受该任务' });
    if (act.status !== 'done') return socket.emit('error', { msg: '任务尚未完成，无法提交' });

    const reward = grantReward(character, def);
    character.activeQuests = character.activeQuests.filter(q => q.id !== questId);
    if (!Array.isArray(character.questHistory)) character.questHistory = [];
    character.questHistory.push({ id: def.id, title: def.title, type: def.type, time: new Date().toISOString().slice(0, 16), reward });
    require('./storage').saveCharacter(character);
    socket.emit('questBoard', buildQuestBoard(character));
    socket.emit('questRewarded', { questId, title: def.title, reward });
    socket.emit('publicMsg', {
      msg: `🎉 任务完成：【${def.title}】 奖励 经验+${reward.exp} · 寂静点数+${reward.mysteryPoint}${reward.skillPoints ? ` · 技能精点+${reward.skillPoints}` : ''}`,
      sender: '系统'
    });
    logger.user.info('提交任务', { uid: character.uid, quest: questId, reward });
  });
}

module.exports = { registerQuestSystem, buildQuestBoard, advanceQuests, grantReward, QUESTS };
