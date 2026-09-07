// 人工校准技能清单：加载 v3 manifest，去杂质、补侦探等缺失，落回 skill_manifest.json
const fs = require('fs');
const path = require('path');
const mf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'skill_manifest.json'), 'utf8'));

// 去杂质（明显非技能名/带空格的脏名）
const junk = [
  '五格架势通用消耗规则','无禅意消耗','无弹药消耗','任意狂欢能量','任意正义值','任意怒气','任意炁',
  '任意魔能','任意星能','任意剂量','任意子弹','任意探知值','任意战力','任意酒意','任意战意',
  '3 环・元素飞弹','1 环・元素飞弹' // 环法师保留，但名称统一
];
const clean = (n) => n.replace(/\s/g, '').replace(/^【/,'').replace(/】$/,'');
for (const [pid, v] of Object.entries(mf)) {
  v.skills = v.skills.map(clean).filter(n => n.length >= 2 && n.length <= 18 && !junk.includes(n));
  v.skills = [...new Set(v.skills)];
}

// 补侦探（文档：溯源免疫流6 + 洞悉看破流6 + 暗影隐匿流6）
mf['zhentan'] = { name: '侦探', skills: [
  '痕迹捕捉','伤痕溯源','预判设防','罪证固化','全域警戒','溯源神佑',
  '弱点解析','罪迹洞察','层层剥析','真伪甄别','破绽锁定','万罪看破',
  '暗影潜踪','声息寂灭','踪迹全无','虚空惑敌','闭环匿杀','寂夜无声'
]};

// 补观星者缺失（五行大招/厚土/日月流质变/大招/黑洞流缺项）
const gx = mf['guanxingzhe'].skills;
['五星引・厚土','五行归墟','晨昏逆溯','日月同辉','星骸攫取','万象噬空','虚无奇点'].forEach(s => { if (!gx.includes(s)) gx.push(s); });

// 补诡术小丑缺失（杂技流大招/小刀流/毒刃流大招等）
const gs = mf['guishuxiaochou'].skills;
['游刃有余','奥义・万花游场','三刃齐发','扇形散射','刃阵预置','刃影追加','过载倾泻','破甲淬钢小刀','千刃储备','奥义・漫天流星雨','淬毒小刀','暗影腐蚀刃','幻影小丑分身','双分身协战','毒雾爆刃','暗影吞噬','影毒共生','奥义・堕影双生炼狱'].forEach(s => { if (!gs.includes(s)) gs.push(s); });

// 补警官缺失（格挡流被动/护盾流被动/斩杀流被动/大招/通用G1/G4）
const jg = mf['jingguan'].skills;
['正义蓄力','威慑震慑','重整姿态','铜墙铁骨','奥义・不败格斗姿态','正义屏障','正义庇护','奥义・法理不可侵','雷霆一击','追猎处决','连斩追诉','威慑逼降','全域追缉','裁决馈赠','奥义・终极正义审判'].forEach(s => { if (!jg.includes(s)) jg.push(s); });

fs.writeFileSync(path.join(__dirname, '..', 'config', 'skill_manifest.json'), JSON.stringify(mf, null, 2), 'utf8');
let total = 0;
for (const [pid, v] of Object.entries(mf)) { total += v.skills.length; console.log(pid.padEnd(14), v.name.padEnd(6), String(v.skills.length).padStart(3)); }
console.log('TOTAL =', total);
