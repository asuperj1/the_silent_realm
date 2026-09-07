/**
 * workshopHandler.js — 工坊系统（P0，文档模块3/界面标签4）
 * 副本外专属功能：锻造强化 / 耐久修复 / 分解回收 / 吞噬晋升 / 黑色成长。
 * 强制规则（文档四·4）：副本游玩过程禁止开放工坊入口（服务端拒绝 + 前端隐藏）。
 */
const storage = require('./storage');
const logger = require('./logger');
const { getItemEngine } = require('./itemEngine/ItemEngine');
const itemEngine = getItemEngine();
const { QUALITY } = require('./itemEngine/BaseItem');
const PI = require('./playerItems');
const { VALID_SLOTS } = PI;

// 词条数量上限（stat 被动词条，防止无限膨胀）
const MAX_WORDS = 8;

// 品质名称（工坊文案）
const QUALITY_LABEL = { white: '白色', green: '绿色', blue: '蓝色', purple: '紫色', gold: '金色', orange: '橙色', red: '红色', black: '黑色' };

/** 从角色背包/仓库查找物品；若目标正在穿戴（equip 槽）则自动卸下并放回背包（重算属性） */
function _findItem(character, itemUid) {
  if (!character || !itemUid) return null;
  const pools = [
    { list: character.inventory || [], where: 'inventory' },
    { list: character.warehouse || [], where: 'warehouse' }
  ];
  for (const pool of pools) {
    const idx = pool.list.findIndex(i => (i.uid || i.id) === itemUid);
    if (idx >= 0) return { item: pool.list[idx], idx, list: pool.list, where: pool.where };
  }
  // 穿戴槽：按装备名匹配（前端穿戴中装备 uid 为 "equip:名称"）→ 自动卸下（撤销属性 + 清槽）并放回背包，供吞噬/强化处理
  const equip = character.equip || {};
  const lookupName = String(itemUid).startsWith('equip:') ? String(itemUid).slice(6) : itemUid;
  for (const slot of VALID_SLOTS) {
    const name = equip[slot];
    if (!name || (name !== itemUid && name !== lookupName)) continue;
    try {
      // 卸下：撤销该装备属性加成 + 清空槽位
      itemEngine.unequip(character, slot);
      character.equip[slot] = null;
    } catch (e) {
      character.equip[slot] = null;
    }
    // 用模板重建完整实例放回背包（保留词条/品质）
    const tpl = itemEngine.resolveTemplate(name);
    const inst = PI.restoreItemFromTemplate(tpl, name);
    if (!character.inventory) character.inventory = [];
    PI.placeItem(character.inventory, inst, 'equipment');
    const idx = character.inventory.findIndex(i => (i.uid || i.id) === inst.uid);
    return { item: inst, idx, list: character.inventory, where: 'inventory', worn: true, wornSlot: slot };
  }
  return null;
}

/** 主属性判定：武器按 weaponKind，防具/饰品用 con，法术用 int */
function _mainAttr(inst) {
  if (inst.weaponKind === 'melee') return 'str';
  if (inst.weaponKind === 'ranged') return 'dex';
  if (inst.weaponKind === 'spell') return 'int';
  return 'con';
}

/** 装备强化成本（随等级递增） */
function _enhanceCost(level) {
  return 20 + level * 10;
}

/** 强化成功率（%）：当前等级 → 下一级成功率（+0~+2 必成功，随等级递减） */
const ENHANCE_RATE = { 0: 100, 1: 100, 2: 100, 3: 95, 4: 90, 5: 85, 6: 80, 7: 72, 8: 65, 9: 58, 10: 50, 11: 42, 12: 35, 13: 28, 14: 22 };

/** 判断角色是否在副本中（禁止工坊） */
function _inCopy(state, socketId) {
  for (const [, room] of state.gameRooms) {
    if (room.players && room.players.has(socketId)) return true;
  }
  return false;
}

function registerWorkshop(socket, io, state) {
  const guard = () => {
    if (!socket.character) return { ok: false, msg: '未登录' };
    if (_inCopy(state, socket.id)) return { ok: false, msg: '副本进行中，工坊仅限副本外使用' };
    return { ok: true };
  };
  const persist = (msg) => {
    storage.saveCharacter(socket.character);
    // 同步前端背包/仓库
    socket.emit('inventoryData', {
      items: socket.character.inventory || [],
      warehouse: socket.character.warehouse || [],
      partitions: PI.INV_PARTITIONS
    });
    socket.emit('workshopResult', { ok: true, msg });
    socket.emit('characterUpdate', { uid: socket.character.uid, attr: { ...socket.character.attr }, mysteryPoint: socket.character.mysteryPoint });
  };

  // ==================== 锻造强化 ====================
  socket.on('workshop.enhance', ({ itemUid }) => {
    const g = guard();
    if (!g.ok) return socket.emit('workshopResult', { ok: false, msg: g.msg });
    const found = _findItem(socket.character, itemUid);
    if (!found) return socket.emit('workshopResult', { ok: false, msg: '未找到该装备' });
    const inst = found.item;
    if (inst.type !== 'equipment' && inst.type !== 'perm') return socket.emit('workshopResult', { ok: false, msg: '仅装备可强化' });
    if (inst.quality === 'black') return socket.emit('workshopResult', { ok: false, msg: '黑色成长装备走独立成长路线，不可普通强化' });
    if ((inst.enhanceLevel || 0) >= 15) return socket.emit('workshopResult', { ok: false, msg: '已达强化上限（+15）' });
    const cost = _enhanceCost(inst.enhanceLevel || 0);
    if ((socket.character.mysteryPoint || 0) < cost) return socket.emit('workshopResult', { ok: false, msg: `寂静点数不足（需 ${cost}）` });
    socket.character.mysteryPoint -= cost;
    // ★ 强化成功率判定（随等级递减）：失败保留等级、扣除点数
    const rate = ENHANCE_RATE[inst.enhanceLevel || 0] ?? 100;
    const ok = (Math.random() * 100) < rate;
    if (!ok) {
      return persist(`强化失败 → 仍 +${inst.enhanceLevel || 0}（消耗 ${cost} 寂静点数，成功率 ${rate}%）`);
    }
    inst.enhanceLevel = (inst.enhanceLevel || 0) + 1;
    inst.effects = inst.effects || [];
    // 强化：主属性词条累加而非新增（控制词条数量膨胀）
    const stat = _mainAttr(inst);
    const existStat = inst.effects.find(e => e.kind === 'stat' && e.stat === stat);
    if (existStat) existStat.value = (existStat.value || 0) + 2;
    else inst.effects.push({ trigger: 'passive', kind: 'stat', stat, value: 2, target: 'self' });
    persist(`强化成功 → +${inst.enhanceLevel}（消耗 ${cost} 寂静点数，主属性+2）`);
  });

  // ==================== 耐久修复 ====================
  socket.on('workshop.repair', ({ itemUid }) => {
    const g = guard();
    if (!g.ok) return socket.emit('workshopResult', { ok: false, msg: g.msg });
    const found = _findItem(socket.character, itemUid);
    if (!found) return socket.emit('workshopResult', { ok: false, msg: '未找到该装备' });
    const inst = found.item;
    const maxD = inst.maxDurability || 100;
    if ((inst.durability ?? maxD) >= maxD) return socket.emit('workshopResult', { ok: false, msg: '该装备耐久已满，无需修复' });
    const cost = 15;
    if ((socket.character.mysteryPoint || 0) < cost) return socket.emit('workshopResult', { ok: false, msg: `寂静点数不足（需 ${cost}）` });
    socket.character.mysteryPoint -= cost;
    inst.durability = maxD;
    persist(`耐久修复完成（消耗 ${cost} 寂静点数）`);
  });

  // ==================== 分解回收 ====================
  socket.on('workshop.disassemble', ({ itemUid }) => {
    const g = guard();
    if (!g.ok) return socket.emit('workshopResult', { ok: false, msg: g.msg });
    const found = _findItem(socket.character, itemUid);
    if (!found) return socket.emit('workshopResult', { ok: false, msg: '未找到该物品' });
    const inst = found.item;
    if (inst.quality === 'black') return socket.emit('workshopResult', { ok: false, msg: '黑色装备绑定角色，不可分解' });
    const rank = QUALITY[inst.quality] ? QUALITY[inst.quality].rank : 0;
    const refund = 5 + rank * 8 + (inst.enhanceLevel || 0) * 3;
    found.list.splice(found.idx, 1);
    socket.character.mysteryPoint = (socket.character.mysteryPoint || 0) + refund;
    persist(`已分解「${inst.itemName}」，回收 ${refund} 寂静点数`);
  });

  // ==================== 吞噬晋升（白~红） ====================
  // 吞噬成本（按当前品质递增：白→绿20 … 橙→红400）
  const DEVOUR_COST = [0, 20, 40, 80, 150, 260, 400];
  socket.on('workshop.devour', ({ itemUid, fuelUid }) => {
    const g = guard();
    if (!g.ok) return socket.emit('workshopResult', { ok: false, msg: g.msg });
    const main = _findItem(socket.character, itemUid);
    const fuel = _findItem(socket.character, fuelUid);
    if (!main || !fuel) return socket.emit('workshopResult', { ok: false, msg: '主装备或吞噬材料未找到' });
    const m = main.item, f = fuel.item;
    if (m.quality === 'black' || f.quality === 'black') return socket.emit('workshopResult', { ok: false, msg: '黑色装备不参与普通吞噬晋升' });
    if (m.type !== 'equipment' && m.type !== 'perm') return socket.emit('workshopResult', { ok: false, msg: '主装备类型错误' });
    if (f.type !== 'equipment' && f.type !== 'perm') return socket.emit('workshopResult', { ok: false, msg: '吞噬材料必须是装备' });
    if (itemUid === fuelUid) return socket.emit('workshopResult', { ok: false, msg: '主装备与吞噬材料不能是同一件' });
    const mRank = QUALITY[m.quality] ? QUALITY[m.quality].rank : 0;
    const fRank = QUALITY[f.quality] ? QUALITY[f.quality].rank : 0;
    if (fRank > mRank) return socket.emit('workshopResult', { ok: false, msg: '吞噬材料品质不能高于主装备' });
    if (mRank >= QUALITY.red.rank) return socket.emit('workshopResult', { ok: false, msg: '已达最高品质（红色湮灭）' });
    // 吞噬成本（按当前品质收递增费用）
    const cost = DEVOUR_COST[mRank] || 0;
    if ((socket.character.mysteryPoint || 0) < cost) return socket.emit('workshopResult', { ok: false, msg: `寂静点数不足（吞噬需 ${cost}）` });
    // 品质晋升 + 品质 bonus 差值落地（白2/绿4/蓝7/紫10/金14/橙18/红24 → 主属性词条）
    const order = ['white', 'green', 'blue', 'purple', 'gold', 'orange', 'red'];
    const bonusBefore = QUALITY[m.quality] ? QUALITY[m.quality].bonus : 0;
    const next = order[Math.min(mRank + 1, order.length - 1)];
    const bonusAfter = QUALITY[next].bonus;
    m.quality = next;
    m.effects = m.effects || [];
    const delta = bonusAfter - bonusBefore;
    if (delta > 0) {
      const stat = _mainAttr(m);
      const exist = m.effects.find(e => e.kind === 'stat' && e.stat === stat);
      if (exist) exist.value = (exist.value || 0) + delta;
      else m.effects.push({ trigger: 'passive', kind: 'stat', stat, value: delta, target: 'self' });
    }
    // 词条合并：从材料按 value 降序取前 N 条 stat 词条（值 50% 并入，同 stat 累加）
    const maxWords = Math.max(1, QUALITY[next].words);
    const fuelStats = (f.effects || [])
      .filter(e => e.kind === 'stat')
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, maxWords);
    let merged = 0;
    for (const fs of fuelStats) {
      const addVal = Math.max(1, Math.round((fs.value || 2) / 2));
      const exist = m.effects.find(e => e.kind === 'stat' && e.stat === fs.stat);
      if (exist) exist.value = (exist.value || 0) + addVal;
      else {
        // ★ 词条数量上限管理：已达 MAX_WORDS 则不再新增词条（仅可累加已有）
        const statCount = m.effects.filter(e => e.kind === 'stat').length;
        if (statCount >= MAX_WORDS) continue;
        m.effects.push({ trigger: 'passive', kind: 'stat', stat: fs.stat, value: addVal, target: 'self' });
      }
      merged++;
    }
    // 移除燃料 + 扣费
    fuel.list.splice(fuel.idx, 1);
    socket.character.mysteryPoint -= cost;
    persist(`「${m.itemName}」吞噬晋升 → ${QUALITY_LABEL[next]}（${cost ? '消耗 ' + cost + ' 点数，' : ''}合并 ${merged} 条词条）`);
  });

  // ==================== 黑色成长（独立路线） ====================
  socket.on('workshop.growth', ({ itemUid, matUid }) => {
    const g = guard();
    if (!g.ok) return socket.emit('workshopResult', { ok: false, msg: g.msg });
    const found = _findItem(socket.character, itemUid);
    if (!found) return socket.emit('workshopResult', { ok: false, msg: '未找到该装备' });
    const inst = found.item;
    if (!itemEngine.isGrowthItem(inst)) return socket.emit('workshopResult', { ok: false, msg: '非黑色可成长装备' });
    const matFound = matUid ? _findItem(socket.character, matUid) : null;
    if (matUid && !matFound) return socket.emit('workshopResult', { ok: false, msg: '未找到成长素材' });
    const r = itemEngine.growthUpgrade(inst, matFound ? matFound.item : null);
    if (!r.ok) return socket.emit('workshopResult', { ok: false, msg: r.msg });
    if (matFound) matFound.list.splice(matFound.idx, 1);
    persist(`「${inst.itemName}」${r.msg}（当前成长阶段 ${r.tier}）`);
  });
}

module.exports = { registerWorkshop };
