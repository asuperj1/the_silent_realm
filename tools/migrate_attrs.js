// -*- coding: utf-8 -*-
// 一次性迁移脚本：旧角色存档 5维属性 → 6维（P0 2026-08-23）
//   per(感知) → int(智力)，wil(意志) → hidden.will(隐藏意志力)
//   per/wil 保留为兼容镜像（旧判定逻辑仍可读）；新增 cha(魅力)/lck(幸运)/hidden.soul；maxSan 100→80
// 用法：node tools/migrate_attrs.js [--dry]
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'characters');
const dry = process.argv.includes('--dry');

function migrateCharacter(ch) {
  if (!ch || !ch.attr) return 0;
  const a = ch.attr;
  let changed = 0;
  // per → int
  if (a.int === undefined && a.per !== undefined) { a.int = a.per; changed++; }
  else if (a.int === undefined) { a.int = 40; changed++; }
  // 兼容镜像：int 与 per 同步（新角色 per 不存则补）
  if (a.per === undefined) { a.per = a.int; changed++; }
  // 新增 魅力/幸运
  if (a.cha === undefined) { a.cha = 40; changed++; }
  if (a.lck === undefined) { a.lck = 40; changed++; }
  // 隐藏属性
  if (!ch.hidden) { ch.hidden = {}; changed++; }
  if (ch.hidden.will === undefined) { ch.hidden.will = (a.wil !== undefined ? a.wil : 40); changed++; }
  if (ch.hidden.soul === undefined) { ch.hidden.soul = 40; changed++; }
  // 兼容镜像：wil 与 hidden.will 同步
  if (a.wil === undefined) { a.wil = ch.hidden.will; changed++; }
  // SAN 0-80：上限收敛
  if (a.maxSan !== undefined && a.maxSan > 80) { a.maxSan = 80; changed++; }
  else if (a.maxSan === undefined) { a.maxSan = 80; changed++; }
  if (a.san !== undefined && a.san > a.maxSan) { a.san = a.maxSan; changed++; }
  // 永久 SAN 上限损耗字段（P0）
  if (ch.permanentSanLoss === undefined) { ch.permanentSanLoss = 0; changed++; }
  if (ch.sanLossHistory === undefined) { ch.sanLossHistory = []; changed++; }
  // 素材档案库 / 轮回记录（P1）
  if (!ch.archive || typeof ch.archive !== 'object') { ch.archive = { npcQuotes: [], books: [], monsters: [], anomalies: [] }; changed++; }
  ['npcQuotes', 'books', 'monsters', 'anomalies'].forEach(k => { if (!Array.isArray(ch.archive[k])) { ch.archive[k] = []; changed++; } });
  if (ch.copiesHistory === undefined) { ch.copiesHistory = []; changed++; }
  return changed;
}

function main() {
  if (!fs.existsSync(DIR)) { console.log('目录不存在:', DIR); return; }
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
  let total = 0, migrated = 0;
  for (const f of files) {
    const p = path.join(DIR, f);
    let ch;
    try { ch = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.log('解析失败跳过:', f, e.message); continue; }
    const c = migrateCharacter(ch);
    if (c > 0) {
      total++;
      if (!dry) fs.writeFileSync(p, JSON.stringify(ch, null, 2), 'utf8');
      console.log(`${dry ? '[DRY] ' : '[迁移] '}${f}: 改动 ${c} 处 | int=${ch.attr.int} cha=${ch.attr.cha} lck=${ch.attr.lck} will=${ch.hidden.will} maxSan=${ch.attr.maxSan}`);
      migrated++;
    }
  }
  console.log(`\n完成：处理 ${files.length} 个存档，${migrated} 个需迁移${dry ? '（仅预览）' : ''}`);
}

main();
