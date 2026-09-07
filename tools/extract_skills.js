// 从设计文档提取技能清单 -> config/skill_manifest.json（v3 综合多策略）
const fs = require('fs');
const path = require('path');
const txtFile = process.argv[2] || (process.env.TEMP + '\\coc_professions.txt');
const outFile = path.join(__dirname, '..', 'config', 'skill_manifest.json');
const text = fs.readFileSync(txtFile, 'utf8');

const profOrder = ['海盗','角斗士','方士','枪手','骑士','观星者','环法师','炼金术师','侦探','百夫长','武士','诡术小丑','警官'];
const pidMap = { '海盗':'haidao','角斗士':'jiaodoushi','方士':'fangshi','枪手':'qiangshou','骑士':'qishi','观星者':'guanxingzhe','环法师':'huanfashi','炼金术师':'lianjinshushi','侦探':'zhentan','百夫长':'baifuzhang','武士':'wushi','诡术小丑':'guishuxiaochou','警官':'jingguan' };

const positions = [];
for (const name of profOrder) {
  const idx = text.indexOf(name + '（');
  if (idx >= 0) positions.push({ name, idx });
}
positions.sort((a, b) => a.idx - b.idx);
const segments = [];
for (let i = 0; i < positions.length; i++) {
  const start = positions[i].idx;
  const end = i + 1 < positions.length ? positions[i + 1].idx : text.length;
  segments.push({ name: positions[i].name, body: text.slice(start, end) });
}

// 明显非技能名的行（流派标题/规则/被动说明/效果续行等）
const BAD = [
  /^被动/, /^全局/, /^核心/, /^资源/, /^CD/, /^数值/, /^公式/, /^三大/, /^流派/, /^通用/, /^谱系/, /^辅助系/, /^元素系/, /^光辉系/, /^黑暗系/, /^第五/, /^第六/, /^机制/, /^补充/, /^关键/, /^示例/, /^【本轮/, /^四、/, /^五、/, /^六、/, /^七、/, /^八、/, /^九、/, /^十、/, /^一、/, /^二、/, /^三、/, /^回合/, /^结算/, /^印记/, /^子弹/, /^过载/, /^配置/, /^工具/, /^字段/, /^负/, /^对/, /^观/, /^表/, /^输出/, /^普通/, /^格挡/, /^免伤/, /^护盾/, /^伤害/, /^生命/, /^当前/, /^剩/, /^上限/, /^目标/, /^全体/, /^范围/, /^自身/, /^队友/, /^敌方/, /^造成/, /^清/, /^销毁/, /^消耗/, /^效/, /^释放/, /^技能/, /^战/, /^怒/, /^炁/, /^魔/, /^星/, /^剂/, /^子/, /^探/, /^狂/, /^正/, /^禅/, /^酒/, /^架势/, /^拥有/, /^无/, /^每/, /^所/, /^多/, /^受/, /^根据/, /^重/, /^第/, /^示例/, /^唯一/, /^总结/, /^体/, /^魔躯/, /^影子/, /^猎影/, /^覆甲/, /^爆甲/, /^形态/, /^档/, /^副/, /^远程/, /^近战/, /^投/, /^闪避/, /^暴击/, /^会/, /^中/, /^叠/, /^同/, /^不/, /^若/, /^被/, /^开/, /^结/, /^则/, /^可/, /^引/, /^流/, /^血/, /^回/, /^吸/, /^返还/, /^冷却/, /^阶/, /^副作/, /^代价/, /^本回/, /^本次/, /^该/, /^这/, /^战斗/, /^全队/, /^场上/, /^所有/, /^一部分/, /^层/, /^点/, /^次/, /^秒/, /^米/, /^格/
];

function clean(n) {
  return n.replace(/^\d+[\.、]\s*/, '').replace(/^G\d+\s*/, '').trim().replace(/^【/, '').replace(/】$/, '');
}

function good(n) {
  if (!n || n.length < 2 || n.length > 16) return false;
  if (BAD.some(re => re.test(n))) return false;
  return true;
}

function extractSkills(body) {
  const found = [];
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const push = (n) => { n = clean(n); if (good(n) && !found.includes(n)) found.push(n); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || '';
    // A: 【环・技能名】｜谱系｜消耗 ...
    let m = line.match(/^【([^】]{2,16})】/);
    if (m) { push(m[1]); continue; }
    // B: 名字｜描述 ... 消耗
    m = line.match(/^([\u4e00-\u9fa5A-Za-z0-9・]{2,16})[｜|]/);
    if (m && /消耗/.test(line)) { push(m[1]); continue; }
    // C: 名字 消耗：...
    m = line.match(/^([\u4e00-\u9fa5A-Za-z0-9・]{2,16})\s*消耗[:：]/);
    if (m) { push(m[1]); continue; }
    // D: 编号 名字（下一行消耗）
    m = line.match(/^(?:\d+[\.、]\s*|G\d+\s*)([\u4e00-\u9fa5A-Za-z0-9・]{2,16})$/);
    if (m && /消耗/.test(next)) { push(m[1]); continue; }
    // E: 名字（下一行以消耗开头）
    if (/^消耗[:：]/.test(next) && /^[\u4e00-\u9fa5A-Za-z0-9・]{2,16}$/.test(line)) { push(line); }
  }
  return found;
}

const manifest = {};
for (const seg of segments) manifest[pidMap[seg.name]] = { name: seg.name, skills: extractSkills(seg.body) };
fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2), 'utf8');
let total = 0;
for (const [pid, v] of Object.entries(manifest)) {
  total += v.skills.length;
  console.log(pid.padEnd(14), v.name.padEnd(6), String(v.skills.length).padStart(3), '|', v.skills.slice(0, 8).join('、'));
}
console.log('TOTAL skills =', total, '->', outFile);
