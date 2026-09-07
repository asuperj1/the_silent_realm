/**
 * backfill_saves.js — 补齐旧存档缺失字段（2026-08-17）
 * - ownerUid      ：从 data/users.json 按 characters 列表反查角色归属（缺 ownerUid 的旧角色）
 * - unlockedSkills：按职业技能列表补齐（legacy 角色未走技能树系统 → 全量解锁职业技能，保证可正常出战）
 * 只写缺失字段，不覆盖已有值；不改变其他任何数据。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gameLogic = require('../server/gamelogic');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
const CHAR_DIR = path.join(__dirname, '..', 'data', 'characters');

// 1) 构建 charUid → ownerUid 映射
const usersRaw = fs.readFileSync(USERS_FILE, 'utf8').replace(/^\uFEFF/, '');
const usersObj = JSON.parse(usersRaw); // { userUid: { username, characters: [charUid...] } }
const ownerByChar = new Map();
for (const [userUid, u] of Object.entries(usersObj)) {
  if (!u || !Array.isArray(u.characters)) continue;
  for (const cid of u.characters) ownerByChar.set(cid, userUid);
}

let fixedOwner = 0, fixedSkills = 0, untouched = 0;

for (const f of fs.readdirSync(CHAR_DIR)) {
  if (!f.endsWith('.json')) continue;
  const file = path.join(CHAR_DIR, f);
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const c = JSON.parse(raw);
  let changed = false;

  if (!c.ownerUid) {
    const owner = ownerByChar.get(c.uid) || ownerByChar.get(f.replace(/\.json$/, ''));
    if (owner) { c.ownerUid = owner; fixedOwner++; changed = true; }
    else { console.log('  ⚠ 无法归属（users 未登记）:', f, c.uid, c.name); }
  }

  if (!Array.isArray(c.unlockedSkills)) {
    const careerCfg = gameLogic.CAREERS[c.career];
    c.unlockedSkills = (careerCfg && Array.isArray(careerCfg.skills)) ? careerCfg.skills.slice() : [];
    if (!Array.isArray(c.equippedSkills)) c.equippedSkills = c.unlockedSkills.slice();
    fixedSkills++; changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, JSON.stringify(c, null, 2), 'utf8');
  } else {
    untouched++;
  }
}

console.log('补齐完成：ownerUid=' + fixedOwner + ' | unlockedSkills=' + fixedSkills + ' | 未改动=' + untouched);
