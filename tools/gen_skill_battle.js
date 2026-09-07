/**
 * gen_skill_battle.js — 从 skill_tree.json 提取每职业 passive + 每流派主力技能，
 * 按职业定位与品级生成 config/skill_battle.json 战斗数值骨架（杀戮尖塔2式，v2.1 §5.4）。
 * 运行：node tools/gen_skill_battle.js
 */
const fs = require('fs');
const path = require('path');
const tree = require('../config/skill_tree.json');
const roles = require('../config/battle_roles.json');

// 品级 → 数值基准
const GRADE = {
  normal: { base: 10, ratio: 0.5, apAdd: 0, cd: 2 },
  good: { base: 16, ratio: 0.55, apAdd: 0, cd: 2 },
  epic: { base: 22, ratio: 0.6, apAdd: 1, cd: 3 },
  s: { base: 30, ratio: 0.65, apAdd: 2, cd: 3 }
};

// 定位 → 技能模板
function skillTemplate(role, grade, g, idx) {
  const scale = (role === '法系') ? 'magAtk' : 'physAtk';
  const element = (role === '法系') ? (['holy', 'magic', 'corrosion', 'burn'][idx % 4]) : 'physical';
  const ap = (idx % 3 === 2) ? g.apAdd + 3 : g.apAdd + 2;   // 第3技能(辅助/群攻)略高
  const sk = {
    ap, cd: g.cd,
    target: (idx % 3 === 1) ? 'all' : 'single'
  };
  if (role === '法系') {
    if (idx % 3 === 0) { sk.type = 'attack'; sk.element = element; sk.damage = { base: g.base + 4, scale, ratio: g.ratio }; sk.effects = [{ id: 'vulnerable', value: 1, turns: 2 }]; }
    else if (idx % 3 === 1) { sk.type = 'heal'; sk.heal = { base: g.base - 2, scale, ratio: 0.4 }; sk.block = 6; }
    else { sk.type = 'attack'; sk.element = 'true'; sk.damage = { base: g.base, scale, ratio: g.ratio }; }
  } else if (role === '坦克') {
    if (idx % 3 === 0) { sk.type = 'defense'; sk.block = g.base; sk.effects = [{ id: 'blockUp', value: 1, turns: 1 }]; }
    else if (idx % 3 === 1) { sk.type = 'attack'; sk.element = 'physical'; sk.damage = { base: g.base - 2, scale, ratio: g.ratio }; sk.block = 4; }
    else { sk.type = 'utility'; sk.heal = { base: g.base - 4, scale, ratio: 0.3 }; sk.effects = [{ id: 'regen', value: 3, turns: 2 }]; }
  } else {
    // 战士/敏捷/爆发
    if (idx % 3 === 0) { sk.type = 'attack'; sk.element = element; sk.damage = { base: g.base + 2, scale, ratio: g.ratio }; sk.effects = [{ id: 'vulnerable', value: 1, turns: 2 }]; }
    else if (idx % 3 === 1) { sk.type = 'attack'; sk.element = 'physical'; sk.damage = { base: g.base - 4, scale, ratio: g.ratio + 0.15, hits: (role === '敏捷' || role === '爆发') ? 3 : 1 }; }
    else { sk.type = 'utility'; sk.block = 6; sk.effects = [{ id: 'strength', value: 1, turns: 3 }]; }
  }
  return sk;
}

const PASSIVE = {
  '法系': { trigger: 'onTurnStart', effect: { block: 2 } },
  '坦克': { trigger: 'onHurt', effect: { block: 3 } },
  '战士': { trigger: 'onAttack', effect: { lifesteal: 2 } },
  '敏捷': { trigger: 'onAttack', effect: { dexUp: 1 } },
  '爆发': { trigger: 'onKill', effect: { strength: 1 } }
};

const out = {};
for (const id in tree) {
  const c = tree[id];
  const roleCfg = roles[id] || {};
  const role = roleCfg.role || '战士';
  const passiveName = (c.passive && c.passive.name) || '被动';
  out[id] = {
    passive: { id: id + '_passive', name: passiveName, trigger: (PASSIVE[role] || PASSIVE['战士']).trigger, effect: (PASSIVE[role] || PASSIVE['战士']).effect },
    skills: {}
  };
  // 每流派取前 2 技能
  for (const school of (c.schools || [])) {
    for (let i = 0; i < 2 && i < (school.skills || []).length; i++) {
      const s = school.skills[i];
      if (!s || !s.name) continue;
      const g = GRADE[s.grade] || GRADE.normal;
      out[id].skills[s.name] = skillTemplate(role, s.grade, g, i);
    }
  }
}

const file = path.join(__dirname, '..', 'config', 'skill_battle.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
let cnt = 0;
for (const id in out) cnt += Object.keys(out[id].skills).length;
console.log(`生成 ${Object.keys(out).length} 职业，共 ${cnt} 个技能战斗配置 → config/skill_battle.json`);
