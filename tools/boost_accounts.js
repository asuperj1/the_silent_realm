/**
 * tools/boost_accounts.js — 批量提升所有账号角色：
 * 1) 解锁该职业技能树全部技能（unlockedSkills 合并去重）
 * 2) 技能精点 skillPoints 拉满（9999）
 * 3) 每人 10000 寂静金币（silentCoins）+ 10000 诡秘点数（mysteryPoint，现有商店货币）
 * 用法：node tools/boost_accounts.js （运行前请先停止服务器，避免内存覆盖）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CHAR_DIR = path.join(ROOT, 'data', 'characters');
const PROF = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'professions.json'), 'utf8'));
const SKILL_TREE = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'skill_tree.json'), 'utf8'));

// 职业 name → id 映射（professions 数组 + skill_tree keys）
const careerMap = {};
(PROF || []).forEach(p => { if (p && p.name) careerMap[p.name] = p.id || p.name; });
Object.keys(SKILL_TREE).forEach(id => { careerMap[id] = id; });

/** 该职业技能树全部技能名（被动 + 各流派技能） */
function allSkills(careerId) {
  const tree = SKILL_TREE[careerId];
  if (!tree) return [];
  const set = new Set();
  if (tree.passive && tree.passive.name) set.add(tree.passive.name);
  (tree.schools || []).forEach(s => (s.skills || []).forEach(k => k && k.name && set.add(k.name)));
  return [...set];
}

const files = fs.readdirSync(CHAR_DIR).filter(f => f.endsWith('.json'));
let chars = 0, skillsUnlocked = 0;
files.forEach(f => {
  const p = path.join(CHAR_DIR, f);
  let ch;
  try { ch = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return; }
  const careerId = careerMap[ch.career] || ch.career;
  const skills = allSkills(careerId);
  if (skills.length) {
    ch.unlockedSkills = [...new Set([...(ch.unlockedSkills || []), ...skills])];
    ch.skillPoints = 9999;
    skillsUnlocked += skills.length;
  }
  // ★ 每人 10000 寂静金币 + 10000 诡秘点数（现有商店货币）
  ch.silentCoins = 10000;
  ch.mysteryPoint = 10000;
  fs.writeFileSync(p, JSON.stringify(ch, null, 2));
  chars++;
  console.log(`  ${ch.name}(${ch.career}) → 技能 ${skills.length} 个 / 金币 10000 / 诡秘点 10000`);
});
console.log(`\n✅ 已处理 ${chars} 个角色，累计解锁 ${skillsUnlocked} 个技能`);
