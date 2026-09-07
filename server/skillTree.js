// skillTree.js — 技能树 / 技能精点 / 出战配置域
// 事件：getSkillTree / unlockSkill / saveSkillSetup
// 依赖 state（gameRooms）、storage、logger；新职业技能树数据在 config/skill_tree.json
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const PROFESSIONS = require('../config/professions.json');
const SKILL_TREE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'skill_tree.json'), 'utf8'));
const SKILL_BATTLE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'skill_battle.json'), 'utf8'));

// ---- 技能效果 → 可读中文描述（供前端点击查看具体效果） ----
const SKILL_TARGET_LABEL = { single: '单体', all: '全体', allies: '友方全体', self: '自身', enemies: '敌方全体' };
const SKILL_TYPE_LABEL = { attack: '攻击', heal: '治疗', defense: '防御', control: '控制', taunt: '嘲讽', buff: '增益', debuff: '减益' };
const SKILL_ELEM_LABEL = { physical: '物理', holy: '神圣', fire: '火焰', ice: '寒冰', poison: '毒素', arcane: '奥术', lightning: '雷电', shadow: '暗影', earth: '大地' };
const SKILL_STATUS_LABEL = {
  strength: '力量', weak: '脆弱', vulnerable: '易伤', poison: '中毒', burn: '灼烧',
  blockUp: '格挡增强', dexUp: '敏捷', immobilize: '禁锢', stun: '眩晕', regen: '再生',
  shield: '护盾', fear: '恐惧', lifesteal: '吸血'
};
const SKILL_SCALE_LABEL = { physAtk: '物理攻击', magAtk: '法术攻击', maxHp: '最大生命', hp: '生命' };

// 把 skill_battle.json 的技能配置转成中文效果描述（无配置返回 null）
function describeSkill(sk) {
  if (!sk) return null;
  const parts = [];
  const head = [SKILL_TYPE_LABEL[sk.type] || sk.type];
  if (sk.target) head.push(SKILL_TARGET_LABEL[sk.target] || sk.target);
  if (sk.element) head.push(SKILL_ELEM_LABEL[sk.element] || sk.element);
  parts.push(head.join('·'));
  if (sk.damage) {
    const d = sk.damage;
    let s = `造成 ${d.base || 0}`;
    if (d.ratio && d.scale) s += ` + ${Math.round(d.ratio * 100)}%${SKILL_SCALE_LABEL[d.scale] || d.scale}`;
    if (d.hits && d.hits > 1) s += ` ×${d.hits} 段`;
    s += ' 伤害';
    parts.push(s);
  }
  if (sk.heal) {
    const h = sk.heal;
    let s = `恢复 ${h.base || 0}`;
    if (h.ratio && h.scale) s += ` + ${Math.round(h.ratio * 100)}%${SKILL_SCALE_LABEL[h.scale] || h.scale}`;
    s += ' 生命';
    parts.push(s);
  }
  if (sk.block) parts.push(`获得 ${sk.block} 点护盾`);
  (sk.effects || []).forEach(e => {
    let s = `附加【${SKILL_STATUS_LABEL[e.id] || e.id}】`;
    if (e.value) s += ` ${e.value} 层`;
    if (e.turns) s += `，持续 ${e.turns} 回合`;
    parts.push(s);
  });
  return parts.join('；') || null;
}

// 技能基础信息（AP/冷却/目标/类型/元素/描述），供前端详情卡展示
function skillDetail(treeId, sk) {
  const b = (((SKILL_BATTLE[treeId] || {}).skills) || {})[sk.name];
  if (!b) return null;
  return { ap: b.ap, cd: b.cd, target: b.target, type: b.type, element: b.element, desc: describeSkill(b) };
}

// 职业 id -> 技能树 id（新职业 skillTreeId，旧职业无则 null）
function getTreeId(careerName) {
  const prof = PROFESSIONS.find(p => p.name === careerName);
  return prof ? (prof.skillTreeId || null) : null;
}

// 初始解锁：被动 + 随机 2 个不同流派主动技
function getInitialSkills(treeId) {
  const t = SKILL_TREE[treeId];
  if (!t) return [];
  const picks = [];
  const pool = t.schools.map(s => s.skills[0]);
  // 随机选 2 个不同流派
  const idx = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
  for (const i of idx) {
    if (pool[i] && picks.length < 2) picks.push(pool[i].name);
  }
  return picks;
}

// 技能树数据（供前端）
function buildTreePayload(treeId, character) {
  const t = SKILL_TREE[treeId];
  if (!t) return null;
  const unlocked = character.unlockedSkills || [];
  const equipped = character.equippedSkills || [];
  const pv = SKILL_BATTLE[treeId] ? (SKILL_BATTLE[treeId].passive || null) : null;
  return {
    id: t.id, name: t.name, mainAttr: t.mainAttr, resource: t.resource,
    skillPoints: character.skillPoints || 0,
    passive: { ...t.passive, detail: describeSkill(pv) },
    // ★ 必备技能（innate）：像被动一样开局自带、常驻，从技能树单列展示
    innate: (t.innate || []).map(sk => ({
      ...sk,
      unlocked: true,
      equipped: true,
      detail: skillDetail(treeId, sk)
    })),
    schools: t.schools.map(s => ({
      name: s.name,
      skills: s.skills.map(sk => ({
        ...sk,
        unlocked: unlocked.includes(sk.name),
        equipped: equipped.includes(sk.name),
        detail: skillDetail(treeId, sk)
      }))
    }))
  };
}

function registerSkillTree(socket, io, state) {
  // 技能树数据
  socket.on('getSkillTree', () => {
    const character = socket.character;
    if (!character) return socket.emit('error', { msg: '未加载角色' });
    const treeId = getTreeId(character.career);
    if (!treeId) return socket.emit('skillTreeData', { enabled: false });
    const payload = buildTreePayload(treeId, character);
    socket.emit('skillTreeData', { enabled: true, tree: payload });
    logger.user.info('查询技能树', { uid: character.uid, career: character.career });
  });

  // 解锁技能（精点扣除）
  socket.on('unlockSkill', ({ skillName }) => {
    const character = socket.character;
    if (!character) return socket.emit('error', { msg: '未加载角色' });
    const treeId = getTreeId(character.career);
    const t = SKILL_TREE[treeId];
    if (!t) return socket.emit('error', { msg: '该职业暂无技能树' });

    // 在技能树中查找该技能（含流派与位置）
    let target = null, schoolIdx = -1, skillIdx = -1;
    t.schools.forEach((s, si) => s.skills.forEach((sk, ki) => {
      if (sk.name === skillName) { target = sk; schoolIdx = si; skillIdx = ki; }
    }));
    if (!target) return socket.emit('error', { msg: '技能不存在' });

    const unlocked = character.unlockedSkills || [];
    if (unlocked.includes(skillName)) return socket.emit('error', { msg: '该技能已解锁' });

    // 大招前置：同流派已解锁 >= 2 个任意技能
    if (target.grade === 's') {
      const sameSchoolUnlocked = t.schools[schoolIdx].skills.filter(sk => unlocked.includes(sk.name)).length;
      if (sameSchoolUnlocked < 2) {
        return socket.emit('error', { msg: `大招需同流派已解锁 ≥2 个技能（当前 ${sameSchoolUnlocked}）` });
      }
    }

    const points = character.skillPoints || 0;
    if (points < target.cost) {
      return socket.emit('error', { msg: `技能精点不足（需 ${target.cost}，当前 ${points}）` });
    }

    character.skillPoints = points - target.cost;
    unlocked.push(skillName);
    character.unlockedSkills = unlocked;
    // 解锁后自动加入出战（上限 5 个主动）
    const equipped = character.equippedSkills || [];
    if (equipped.length < 5) equipped.push(skillName);
    character.equippedSkills = equipped;

    require('./storage').saveCharacter(character);
    socket.emit('skillTreeData', { enabled: true, tree: buildTreePayload(treeId, character) });
    socket.emit('publicMsg', { msg: `🔓 解锁技能：【${skillName}】（消耗 ${target.cost} 精点）`, sender: '系统' });
    logger.user.info('解锁技能', { uid: character.uid, skill: skillName, cost: target.cost });
  });

  // 保存出战配置（进副本前）
  socket.on('saveSkillSetup', ({ equippedSkills }) => {
    const character = socket.character;
    if (!character) return socket.emit('error', { msg: '未加载角色' });
    const treeId = getTreeId(character.career);
    const t = SKILL_TREE[treeId];
    if (!t) return socket.emit('error', { msg: '该职业暂无技能树' });

    const unlocked = character.unlockedSkills || [];
    const list = Array.isArray(equippedSkills) ? equippedSkills : [];
    // 只能出战已解锁技能，最多 5 个
    const valid = list.filter(name => unlocked.includes(name)).slice(0, 5);
    character.equippedSkills = valid;
    require('./storage').saveCharacter(character);
    socket.emit('skillSetupSaved', { equippedSkills: valid });
    socket.emit('skillTreeData', { enabled: true, tree: buildTreePayload(treeId, character) });
    logger.user.info('保存出战配置', { uid: character.uid, equipped: valid });
  });
}

module.exports = { registerSkillTree, getTreeId, getInitialSkills, buildTreePayload, SKILL_TREE };
