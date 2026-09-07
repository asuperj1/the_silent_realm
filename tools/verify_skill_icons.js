// 校验技能图标：每个职业文件数 vs manifest 技能数，缺失/多余文件列出
const fs = require('fs');
const path = require('path');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'skill_manifest.json'), 'utf8'));
const root = path.join(__dirname, '..', 'assets', 'icons', 'skills');
let totalFiles = 0, totalSkills = 0, missing = [], extra = [];
for (const [pid, v] of Object.entries(manifest)) {
  const dir = path.join(root, pid);
  totalSkills += v.skills.length;
  let files = [];
  if (fs.existsSync(dir)) files = fs.readdirSync(dir).filter(f => /^\d{3}\.png$/.test(f)).sort();
  totalFiles += files.length;
  const have = new Set(files);
  for (let i = 1; i <= v.skills.length; i++) {
    const n = String(i).padStart(3, '0') + '.png';
    if (!have.has(n)) missing.push(`${pid}/${n} (${v.skills[i-1]})`);
  }
  for (const f of files) {
    const idx = parseInt(f, 10);
    if (idx > v.skills.length) extra.push(`${pid}/${f}`);
  }
  console.log(pid.padEnd(14), v.name.padEnd(6), 'skills', String(v.skills.length).padStart(3), 'files', String(files.length).padStart(3));
}
console.log('---');
console.log('TOTAL skills:', totalSkills, ' files:', totalFiles);
console.log('MISSING:', missing.length ? missing.join(', ') : 'none');
console.log('EXTRA :', extra.length ? extra.join(', ') : 'none');
