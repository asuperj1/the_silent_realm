// 从 skill_manifest.json 生成 13 职业技能树 -> config/skill_tree.json
// 技能按 manifest 顺序分配到流派；品级：每流派内 前2=普通(2) 中间=优秀(5)/精良(8)/史诗(11) 末位=S(12)
const fs = require('fs');
const path = require('path');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'skill_manifest.json'), 'utf8'));

// 13 新职业：流派名 / 被动 / 资源 / 主属性
const PROF = {
  haidao:        { name: '海盗',     schools: ['远程', '近战', '全能'], passive: '朗姆酒之歌', resource: '酒意',     mainAttr: 'str' },
  jiaodoushi:    { name: '角斗士',   schools: ['标记', '破防', '浴血'], passive: '嗜血角斗',   resource: '战意',     mainAttr: 'str' },
  fangshi:       { name: '方士',     schools: ['内蕴', '外放', '离体·化神'], passive: '玄元炁击', resource: '炁', mainAttr: 'wil' },
  qiangshou:     { name: '枪手',     schools: ['精准', '重火', '游击闪避'], passive: '弹械本能', resource: '子弹',     mainAttr: 'dex' },
  qishi:         { name: '骑士',     schools: ['守御', '破阵', '斡旋'], passive: '坚铠二重相', resource: '怒气',     mainAttr: 'str' },
  guanxingzhe:   { name: '观星者',   schools: ['五行', '日月', '黑洞虚空'], passive: '星辰之力', resource: '星能', mainAttr: 'wil' },
  huanfashi:     { name: '环法师',   schools: ['元素', '光辉', '黑暗', '辅助'], passive: '环枢咏唱', resource: '魔能', mainAttr: 'wil' },
  lianjinshushi: { name: '炼金术师', schools: ['炼金炸弹', '粘土人偶', '神性星辰'], passive: '贤者炼核', resource: '剂量', mainAttr: 'per' },
  zhentan:       { name: '侦探',     schools: ['溯源免疫', '洞悉看破', '暗影隐匿'], passive: '罪证溯源', resource: '探知值', mainAttr: 'per' },
  baifuzhang:    { name: '百夫长',   schools: ['狂刃持刀', '坚壁持盾', '军团均衡'], passive: '五段战姿', resource: '战力', mainAttr: 'str' },
  wushi:         { name: '武士',     schools: ['招架守势', '影刃无双', '魔躯堕刃'], passive: '架势条', resource: '禅意', mainAttr: 'dex' },
  guishuxiaochou:{ name: '诡术小丑', schools: ['杂技闪避', '狂刃小刀', '暗影毒刃'], passive: '戏法铸刃', resource: '狂欢能量', mainAttr: 'dex' },
  jingguan:      { name: '警官',     schools: ['铁壁格挡', '正义壁垒', '正义斩杀'], passive: '正义处决', resource: '正义值', mainAttr: 'str' }
};

const GRADE_COST = { normal: 2, fine: 5, good: 8, epic: 11, s: 12 };

function assignGrades(skills) {
  // 每流派：前2 普通(2)，随后 优秀(5)/精良(8)/史诗(11)，末位 S(12)
  return skills.map((name, i, arr) => {
    let grade = 'normal';
    if (i === arr.length - 1) grade = 's';
    else if (i >= arr.length - 2) grade = 'epic';
    else if (i >= arr.length - 4) grade = 'good';
    else if (i >= 2) grade = 'fine';
    return { name, grade, cost: GRADE_COST[grade] };
  });
}

const tree = {};
for (const [pid, cfg] of Object.entries(PROF)) {
  const prof = manifest[pid];
  const skills = prof ? prof.skills : [];
  // 均分到流派
  const n = cfg.schools.length;
  const buckets = Array.from({ length: n }, () => []);
  skills.forEach((s, i) => buckets[i % n].push(s));
  // 合并流派名
  const schools = cfg.schools.map((sname, i) => ({ name: sname, skills: assignGrades(buckets[i]) }));
  tree[pid] = {
    id: pid, name: cfg.name, mainAttr: cfg.mainAttr, resource: cfg.resource,
    passive: { name: cfg.passive, grade: 's', cost: 0 },
    schools
  };
  console.log(pid.padEnd(15), cfg.name.padEnd(6), 'passive=' + cfg.passive, '| schools:', schools.map(s => `${s.name}(${s.skills.length})`).join(' '));
}
fs.writeFileSync(path.join(__dirname, '..', 'config', 'skill_tree.json'), JSON.stringify(tree, null, 2), 'utf8');
console.log('-> config/skill_tree.json');
