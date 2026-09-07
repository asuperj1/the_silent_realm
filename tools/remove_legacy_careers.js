// remove_legacy_careers.js — 删除 8 个 legacy 旧职业（2026-08-16）
// 1) config/professions.json 移除 8 个无技能树职业
// 2) frontend/js/client.js professionsCache 内建回退数组移除对应行
// 3) data/characters 存档 career 迁移（私家侦探→侦探、圣殿骑士→骑士、牧师→方士）
const fs = require('fs');
const LEGACY = ['shengdianqishi', 'hanghailinghangyuan', 'biaoshi', 'zhanchanglaobing', 'sijiazhentan', 'qingbaotegong', 'mushi', 'huanxifashi'];

// ---------- 1. professions.json ----------
const pPath = 'config/professions.json';
const p = JSON.parse(fs.readFileSync(pPath, 'utf8').replace(/^\uFEFF/, ''));
const pBefore = p.length;
const pNew = p.filter(x => !LEGACY.includes(x.id));
fs.writeFileSync(pPath, JSON.stringify(pNew, null, 2), 'utf8');
console.log('professions.json:', pBefore, '→', pNew.length, '（删除', pBefore - pNew.length, '）');

// ---------- 2. client.js professionsCache 内建回退数组 ----------
const cjPath = 'frontend/js/client.js';
const lines = fs.readFileSync(cjPath, 'utf8').split('\n');
const out = [];
let removed = 0;
for (const ln of lines) {
  const m = ln.match(/^\s*\{ id:'([a-z_]+)',/);
  if (m && LEGACY.includes(m[1])) { removed++; continue; }
  out.push(ln);
}
fs.writeFileSync(cjPath, out.join('\n'), 'utf8');
console.log('client.js 内建回退删除行数:', removed);

// ---------- 3. 存档迁移 ----------
const dir = 'data/characters';
const MAP = { '私家侦探': '侦探', '圣殿骑士': '骑士', '牧师': '方士' };
let migrated = 0;
for (const f of fs.readdirSync(dir)) {
  const pth = dir + '/' + f;
  const c = JSON.parse(fs.readFileSync(pth, 'utf8'));
  if (MAP[c.career]) {
    console.log('迁移存档:', f, c.career, '→', MAP[c.career]);
    c.career = MAP[c.career];
    fs.writeFileSync(pth, JSON.stringify(c, null, 2), 'utf8');
    migrated++;
  }
}
console.log('存档迁移数:', migrated);
console.log('完成');
