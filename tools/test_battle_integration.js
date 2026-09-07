/** test_battle_integration.js — 服务端集成测试：真实角色 → 战斗快照（技能/武器/属性） */
const fs = require('fs');
const path = require('path');
const PROFESSIONS = require('../config/professions.json');
const SKILL_BATTLE = require('../config/skill_battle.json');
const BATTLE_ROLES = require('../config/battle_roles.json');
const battleStats = require('../server/battleStats');
const { getItemEngine } = require('../server/itemEngine/ItemEngine');
const itemEngine = getItemEngine();

// 找测试角色（方士 / 测试调查员）
const chars = fs.readdirSync(path.join(__dirname, '..', 'data', 'characters')).map(f => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'characters', f), 'utf8')); } catch (e) { return null; }
}).filter(Boolean);

let target = chars.find(c => c.career === '方士' && c.name === '测试调查员') || chars.find(c => c.career === '方士');
const results = [];
const check = (n, c, d) => { results.push({ n, ok: !!c, d }); console.log(`${c ? '✅' : '❌'} ${n}${c ? '' : ' — ' + d}`); };

if (!target) {
  console.log('❌ 未找到方士测试角色；现有职业：', chars.map(c => `${c.name}(${c.career})`).join('、'));
  process.exit(1);
}
console.log(`目标角色: ${target.name} (${target.career}) equippedSkills=${JSON.stringify(target.equippedSkills)} skills=${JSON.stringify(target.skills)}`);

// ===== 模拟 collectBattlePlayers 的核心逻辑 =====
const career = target.career;
const careerId = (PROFESSIONS.find(x => x.name === career || x.id === career) || {}).id || career;
const stats = battleStats.getCombatStats(target.attr, career);
const weapon = battleStats.getEquippedWeapon(target, itemEngine);
const roleCfg = BATTLE_ROLES[careerId] || BATTLE_ROLES[battleStats.careerRole(career)] || {};
const sb = SKILL_BATTLE[careerId] || {};
let skillNames = (target.equippedSkills && target.equippedSkills.length) ? target.equippedSkills : (target.skills || []);
if (!skillNames.length) {
  const pro = PROFESSIONS.find(x => x.name === career || x.id === career);
  skillNames = (pro && pro.skills) ? pro.skills.map(s => s.name) : [];
}
const skills = {};
(skillNames || []).forEach(n => { const s = (sb.skills || {})[n]; if (s) skills[n] = s; });

check('careerId 解析 = fangshi', careerId === 'fangshi', careerId);
check('战斗属性计算 (物攻/法攻/物防)', stats.physAtk > 0 && stats.magAtk > stats.physAtk, `物攻${Math.round(stats.physAtk)} 法攻${Math.round(stats.magAtk)} 物防${Math.round(stats.physDef)}`);
check('技能回退 professions 后非空', skillNames.length > 0, JSON.stringify(skillNames));
check('技能战斗配置可解析', Object.keys(skills).length > 0, JSON.stringify(Object.keys(skills)));
const hasLegacy = Object.values(skills).some(s => s.legacy);
check('旧职业技能已迁移进 skill_battle', hasLegacy, '');
check('角色资源配置', !!(roleCfg.resource && roleCfg.energyDice), `资源=${roleCfg.resource} 能量骰=${roleCfg.energyDice}`);
check('武器解析（baseDmg）', weapon === null || typeof weapon.baseDmg === 'number', weapon ? `${weapon.itemName} baseDmg=${weapon.baseDmg} hits=${weapon.hits}` : '空手');

const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 通过`);
process.exit(fails ? 1 : 0);
