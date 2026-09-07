// 将 13 新职业追加到 config/professions.json（保留原有职业，不破坏现有数据）
// 新职业带 skillTreeId，初始 2 主动取自技能树前两个流派第 1 技能
const fs = require('fs');
const path = require('path');
const profFile = path.join(__dirname, '..', 'config', 'professions.json');
const tree = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'skill_tree.json'), 'utf8'));
const professions = JSON.parse(fs.readFileSync(profFile, 'utf8'));

const EMOJI = {
  haidao: '🏴‍☠️', jiaodoushi: '⚔️', fangshi: '🔮', qiangshou: '🔫', qishi: '🛡️',
  guanxingzhe: '🌌', huanfashi: '🌀', lianjinshushi: '⚗️', zhentan: '🔍', baifuzhang: '🏛️',
  wushi: '🗡️', guishuxiaochou: '🎭', jingguan: '⭐'
};
const COLOR = {
  haidao: '#b8860b', jiaodoushi: '#c0392b', fangshi: '#7b68ee', qiangshou: '#c0392b',
  qishi: '#f1c40f', guanxingzhe: '#8e44ad', huanfashi: '#3498db', lianjinshushi: '#27ae60',
  zhentan: '#8e44ad', baifuzhang: '#e67e22', wushi: '#2c3e50', guishuxiaochou: '#ff6b35',
  jingguan: '#2980b9'
};
const BONUS = {
  haidao: { str: 15, con: 10, dex: 5 }, jiaodoushi: { str: 15, con: 10, dex: 5 },
  fangshi: { wil: 15, per: 10, con: 5 }, qiangshou: { dex: 15, per: 10, con: 5 },
  qishi: { str: 15, con: 15 }, guanxingzhe: { wil: 15, per: 10, con: 5 },
  huanfashi: { wil: 20, per: 10 }, lianjinshushi: { per: 15, wil: 10, con: 5 },
  zhentan: { per: 20, wil: 10 }, baifuzhang: { str: 15, con: 10, dex: 5 },
  wushi: { dex: 15, wil: 10, con: 5 }, guishuxiaochou: { dex: 15, per: 10, con: 5 },
  jingguan: { str: 15, con: 15 }
};
const PASSIVE_DESC = {
  haidao: '远程攻击命中叠加增伤层数，酒意越浓输出越烈',
  jiaodoushi: '攻击造成流血并吸血，低血线时狂暴增伤',
  fangshi: '炁系技能造成物法混合伤害并附加玄炁印记',
  qiangshou: '子弹体系：枪膛上限 6，溢出转为必爆过载',
  qishi: '覆甲/爆甲双形态，切换获得对应增益',
  guanxingzhe: '施放技能叠加五行/日月/黑洞印记，强化对应体系',
  huanfashi: '每回合随机抽取法术，按环数解锁更强法术',
  lianjinshushi: '贤者之石为核心，炼药/人偶/神性三系联动',
  zhentan: '收集线索提升全队伤害与减伤，探知真相',
  baifuzhang: '五段战姿：刀盾姿态切换，攻防数值随之变化',
  wushi: '架势条：格挡/招架/反击三态，禅意转化',
  guishuxiaochou: '能量铸就必中小刀，暴击时伤害翻倍',
  jingguan: '正义处决：对生命低于 15% 的敌人直接斩杀'
};
const CD_BY_GRADE = { normal: 10, fine: 14, good: 18, epic: 22, s: 26 };

function guessType(name) {
  if (/护|守|固|壁|盾|防|援|守|坚/.test(name)) return 'defense';
  if (/愈|血|回|补|息|疗/.test(name)) return 'heal';
  if (/缚|咒|锁|控|惑|恐|镇|囚|禁/.test(name)) return 'control';
  if (/影|匿|潜|遁|移|闪|游|隐/.test(name)) return 'utility';
  return 'attack';
}
function guessDmg(grade) {
  return { normal: 40, fine: 60, good: 80, epic: 110, s: 150 }[grade] || 40;
}

const existing = new Set(professions.map(p => p.id));
let added = 0;
for (const [pid, t] of Object.entries(tree)) {
  if (existing.has(pid)) continue;
  // 初始 2 主动：前两个流派第 1 技能
  const init = t.schools.slice(0, 2).map((s, i) => {
    const sk = s.skills[0];
    const grade = sk.grade;
    return {
      name: sk.name, desc: `${s.name}流派技能（${grade}品级）`, icon: '✦',
      cooldown: CD_BY_GRADE[grade] || 12, type: guessType(sk.name),
      effect: { physDmg: guessDmg(grade), target: 'single' }
    };
  });
  professions.push({
    id: pid, name: t.name, tag: '新职业', hidden: false,
    emoji: EMOJI[pid], color: COLOR[pid],
    skillTreeId: pid, mainAttr: t.mainAttr, resource: t.resource,
    bonus: BONUS[pid],
    passive: { name: t.passive, desc: PASSIVE_DESC[pid], icon: '✨', effect: {} },
    skills: init
  });
  added++;
}
fs.writeFileSync(profFile, JSON.stringify(professions, null, 2), 'utf8');
console.log('added professions:', added, '| total:', professions.length);
