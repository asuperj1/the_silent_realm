// fix_assets.js — 素材索引修正 + 旧素材清理（2026-08-16）
// 1) scenes.json 失效 bg → 真实 qingfeng_scenes 兜底 + 追加青峰山条目
// 2) resource.json 失效 url → 真实兜底
// 3) 删除被替代的旧素材目录（assets/battle 等）
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); // 去 BOM
const ex = (u) => { const p = u.replace(/^(\.\/|\/)/, ''); return fs.existsSync(p); };

// ---------- 1. scenes.json ----------
const s = JSON.parse(read('config/scenes.json'));
const qf = '/assets/qingfeng_scenes/废都青峰山4号车正常.png';
let changed = 0;
for (const x of s) {
  if (!ex(x.bg)) { console.log('scenes 修正:', x.name, '<=', x.bg); x.bg = qf; changed++; }
}
if (!s.some(x => x.name === '废都纪元800｜青峰山虚空列车')) {
  s.push({
    id: 'qingfeng_train', name: '废都纪元800｜青峰山虚空列车', overlay: 'copy-qingfeng-train',
    label: '青峰山虚空列车 · G314', bg: qf,
    sceneTags: ['青峰山', '列车', '隧道', '克苏鲁', '虚空'],
    description: '行驶在无尽隧道中的 G314 列车，窗外是无边黑暗，车厢里弥漫着铁锈与腐味。',
    dangerLevel: 1, randomEvents: [], potentialEnemies: ['无形之子', '修格斯幼体'], lootableItems: []
  });
  console.log('scenes 追加: 青峰山虚空列车');
}
fs.writeFileSync('config/scenes.json', JSON.stringify(s, null, 2), 'utf8');

// ---------- 2. resource.json ----------
const r = JSON.parse(read('resource.json'));
const bgF = './assets/qingfeng_scenes/废都青峰山4号车正常.png';
const uiF = './assets/ui/equip_weapon.png';
const iconF = './assets/icons/skills/fangshi/001.png';
let rc = 0;
for (const x of r) {
  if (!ex(x.url)) {
    const nv = x.url.includes('/assets/ui/') ? uiF : (x.url.includes('/assets/icons/') ? iconF : bgF);
    console.log('resource 修正:', x.resId, '=>', nv);
    x.url = nv; rc++;
  }
}
fs.writeFileSync('resource.json', JSON.stringify(r, null, 2), 'utf8');

// ---------- 3. 删除旧素材目录 ----------
['assets/battle', 'assets/bg', 'assets/character/character', 'assets/item/item'].forEach(d => {
  if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); console.log('删除旧目录:', d); }
});
console.log('完成: scenes修正', changed, '条; resource修正', rc, '条;');
