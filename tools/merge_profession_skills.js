/**
 * merge_profession_skills.js — 把 professions.json 旧职业技能迁移合并进 skill_battle.json
 * （v2.1 §15.2 效果字段迁移映射），保证旧职业（如方士符箓镇邪）也有战斗数值可结算。
 * 运行：node tools/merge_profession_skills.js
 */
const fs = require('fs');
const path = require('path');
const PROF = require('../config/professions.json');
const SB_FILE = path.join(__dirname, '..', 'config', 'skill_battle.json');
const sb = JSON.parse(fs.readFileSync(SB_FILE, 'utf8'));

const DMG_KEYS = ['holyDmg', 'physDmg', 'magDmg', 'magicDmg', 'corrosionDmg', 'explosionDmg', 'burnDmg', 'trueDmg', 'dmg', 'damage'];

function migrate(proSkill) {
  const e = proSkill.effect || {};
  const sk = {
    ap: 4,
    cd: Math.max(1, Math.round((proSkill.cooldown || 10) / 5)),
    type: proSkill.type || 'attack',
    target: (e.target === 'all' || e.target === 'aoe') ? 'all' : 'single',
    legacy: true
  };
  const dmgKey = DMG_KEYS.find(k => typeof e[k] === 'number');
  if (dmgKey) {
    sk.element = (dmgKey === 'holyDmg') ? 'holy' : (dmgKey === 'magDmg' || dmgKey === 'magicDmg') ? 'magic' : 'physical';
    sk.damage = { base: e[dmgKey], scale: (sk.element === 'physical') ? 'physAtk' : 'magAtk', ratio: 0.5 };
  }
  if (e.healAll) { sk.heal = { base: e.healAll, scale: 'magAtk', ratio: 0.4 }; sk.type = 'heal'; sk.target = 'allies'; }
  else if (e.heal) { sk.heal = { base: e.heal, scale: 'magAtk', ratio: 0.4 }; sk.type = 'heal'; }
  if (e.immobilize) sk.effects = [{ id: 'immobilize', turns: Math.max(1, Math.round(e.immobilize / 5)) }];
  if (!sk.damage && !sk.heal) sk.damage = { base: 12, scale: 'physAtk', ratio: 0.5 }; // 兜底
  return sk;
}

let added = 0;
for (const pro of PROF) {
  if (!pro || !pro.id || !Array.isArray(pro.skills)) continue;
  if (!sb[pro.id]) sb[pro.id] = { passive: null, skills: {} };
  if (!sb[pro.id].skills) sb[pro.id].skills = {};
  for (const s of pro.skills) {
    if (!s || !s.name) continue;
    if (sb[pro.id].skills[s.name]) continue; // 已存在（skill_tree 优先）
    sb[pro.id].skills[s.name] = migrate(s);
    added++;
  }
}
fs.writeFileSync(SB_FILE, JSON.stringify(sb, null, 2), 'utf8');
let total = 0; for (const id in sb) total += Object.keys(sb[id].skills || {}).length;
console.log(`合并 ${added} 个旧职业技能，skill_battle 现有 ${total} 技能（${Object.keys(sb).length} 职业）`);
