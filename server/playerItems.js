/**
 * playerItems.js — 背包格子辅助 + 分区常量（2026-08-16 从 playerHandler.js 拆分）
 * 含：分区/占格/堆叠/跨空间移动/发放物证/旧档补格。
 */
const { getItemEngine } = require('./itemEngine/ItemEngine');
const itemEngine = getItemEngine();

const VALID_SLOTS = ['weapon', 'head', 'body', 'hand', 'foot', 'accessory'];
const SLOT_LABELS = { weapon: '武器', head: '头部', body: '身体', hand: '手部', foot: '足部', accessory: '配饰' };
const PART_LABEL = { consumable: '消耗品', plot: '剧情', material: '材料', equipment: '装备', tool: '工具' };

// ★ 分区背包（格子统一加大到仓库同尺寸 ~50px）：消耗25 / 剧情60(15列横向×4行) / 材料40(10列整行) / 装备12(横排一列) / 工具24
const INV_PARTITIONS = {
  consumable: { cols: 5, rows: 5 },    // 25 格
  plot:       { cols: 15, rows: 4 },   // 60 格（横向 15 列 × 4 行）
  material:   { cols: 10, rows: 4 },   // 40 格（10 列 × 50px = 500px 整行）
  equipment:  { cols: 12, rows: 1 },   // 12 存放格（横排一列，放到装备槽下方）+ 6 装备槽 = 18 含槽
  tool:       { cols: 6, rows: 4 }     // 24 格（白色品质工具：绳子/撬棍/手电筒等）
};
// ★ 仓库大空间 180 格（15×12，保持 15 列匹配左半屏宽度）
const WH_COLS = 15, WH_ROWS = 12;   // ★ 仓库容量 15×12 = 180 格（2026-08-23）

/** 物品类型 → 背包分区（含工具分区） */
function partitionFor(type) {
  const map = { consumable: 'consumable', plot: 'plot', material: 'material', equipment: 'equipment', equip: 'equipment', tool: 'tool' };
  return map[type] || null;
}

/** 卸下装备时按模板重建完整物品（保留 itemId/品质/描述/图标/效果等新框架字段，避免丢失导致前端只显示 emoji） */
function restoreItemFromTemplate(tpl, oldName) {
  if (!tpl) {
    return { id: 'item_' + Date.now(), name: oldName, type: 'equipment', effect: {}, size: { w: 1, h: 1 } };
  }
  return {
    uid: 'it_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    itemId: tpl.itemId,
    itemName: tpl.itemName || oldName,
    type: tpl.type || 'equipment',
    quality: tpl.quality || 'white',
    desc: tpl.desc || '',
    icon: tpl.icon || '📦',
    stack: 1,
    maxStack: tpl.maxStack || 1,
    stackable: !!tpl.stackable,
    usable: !!tpl.usable,
    cooldown: tpl.cooldown || 0,
    effects: (tpl.effects || []).map(e => ({ ...e })),
    size: { w: 1, h: 1 },
    grid: null,
    slot: tpl.slot || null,
    weaponKind: tpl.weaponKind || null,
    belongDungeon: tpl.belongDungeon || 'all'
  };
}

/** 构建装备槽 → 装备完整信息（供前端渲染装备栏图片/品质/浮窗；无模板时仅名称） */
function buildEquipInfo(character) {
  const info = {};
  const equip = character.equip || {};
  for (const slot of VALID_SLOTS) {
    const name = equip[slot];
    if (!name) continue;
    const tpl = itemEngine.resolveTemplate(name);
    if (tpl) {
      info[slot] = {
        itemName: tpl.itemName || name,
        itemId: tpl.itemId,
        type: tpl.type || 'equipment',
        quality: tpl.quality || 'white',
        desc: tpl.desc || '',
        icon: tpl.icon || '',
        effects: (tpl.effects || []).map(e => ({ ...e })),
        slot: tpl.slot || slot
      };
    } else {
      info[slot] = { itemName: name, itemId: null, type: 'equipment', quality: 'white', desc: `当前穿戴：${name}`, icon: '', effects: [], slot };
    }
  }
  return info;
}

/** 格子占用表："x,y" -> uid */
function occupancyMap(list, cols, rows) {
  const occ = {};
  for (const it of list || []) {
    if (!it || !it.grid) continue;
    const sz = it.size || { w: 1, h: 1 };
    for (let dx = 0; dx < sz.w; dx++) for (let dy = 0; dy < sz.h; dy++) {
      occ[(it.grid.x + dx) + ',' + (it.grid.y + dy)] = it.uid;
    }
  }
  return occ;
}

/** 在指定位置放置是否可行（越界 + 重叠，排除自身 uid） */
function canPlaceAt(list, cols, rows, x, y, size, selfUid) {
  if (x < 0 || y < 0 || x + size.w > cols || y + size.h > rows) return false;
  const occ = occupancyMap(list, cols, rows);
  for (let dx = 0; dx < size.w; dx++) for (let dy = 0; dy < size.h; dy++) {
    const uid = occ[(x + dx) + ',' + (y + dy)];
    if (uid && uid !== selfUid) return false;
  }
  return true;
}

/** 首次适配找空位 */
function findFreeSlot(list, cols, rows, size) {
  for (let y = 0; y <= rows - size.h; y++) for (let x = 0; x <= cols - size.w; x++) {
    if (canPlaceAt(list, cols, rows, x, y, size, null)) return { x, y };
  }
  return null;
}

/** 目标空间内同分区物品列表（背包按 type 分区；仓库为全部） */
function dstItemsOf(dst, dstKey, type) {
  if (dstKey === 'warehouse') return dst;
  return dst.filter(i => partitionFor(i.type) === partitionFor(type));
}

/** 堆叠合并：同类可堆叠且未满则合并；返回是否完全合并（源物品被吸收） */
function tryMergeStack(dstList, item) {
  if (!item || !item.stackable) return false;
  const exist = dstList.find(i => i.itemId === item.itemId && i.stackable && i.stack < i.maxStack);
  if (!exist) return false;
  const room = exist.maxStack - exist.stack;
  const take = Math.min(room, item.stack || 1);
  exist.stack += take;
  item.stack -= take;
  return item.stack <= 0;
}

/** 跨空间移动（背包↔仓库）：背包按类型分区放置 + 同类可堆叠合并 */
function moveBetween(character, srcKey, dstKey, itemId, x, y) {
  const src = character[srcKey] || [];
  const idx = src.findIndex(i => i.id === itemId || i.uid === itemId);
  if (idx === -1) return null;
  const [item] = src.splice(idx, 1);
  if (!character[dstKey]) character[dstKey] = [];
  const dst = character[dstKey];
  // ★ 先尝试堆叠合并（同类可堆叠物品合并，不占新格）
  if (item.stackable && tryMergeStack(dst, item)) {
    return { ok: true, item, merged: true };
  }
  const size = item.size || { w: 1, h: 1 };
  // 目标网格尺寸
  let cols, rows;
  if (dstKey === 'warehouse') { cols = WH_COLS; rows = WH_ROWS; }
  else {
    const p = INV_PARTITIONS[partitionFor(item.type)];
    if (!p) { src.splice(idx, 0, item); return { ok: false, msg: '该物品类型无对应背包分区' }; }
    cols = p.cols; rows = p.rows;
  }
  const dstItems = dstItemsOf(dst, dstKey, item.type);
  let pos = null;
  if (Number.isInteger(x) && Number.isInteger(y) && canPlaceAt(dstItems, cols, rows, x, y, size, item.uid)) pos = { x, y };
  if (!pos) pos = findFreeSlot(dstItems, cols, rows, size);
  if (!pos) {
    // ★ 失败必须把物品放回源数组（splice 已移除），否则物品丢失
    src.splice(idx, 0, item);
    return { ok: false, msg: '目标空间已满，无法放置' };
  }
  item.grid = pos;
  dst.push(item);
  return { ok: true, item };
}

/** 放入背包指定分区（type）或仓库('warehouse')，占格子，失败返回 false */
function placeItem(list, item, target) {
  const size = item.size || { w: 1, h: 1 };
  let cols, rows;
  if (target === 'warehouse') { cols = WH_COLS; rows = WH_ROWS; }
  else {
    const p = INV_PARTITIONS[partitionFor(target)] || INV_PARTITIONS.equipment;
    cols = p.cols; rows = p.rows;
  }
  const dstItems = target === 'warehouse' ? list : list.filter(i => partitionFor(i.type) === partitionFor(target));
  const pos = findFreeSlot(dstItems, cols, rows, size);
  if (!pos) return false;
  item.grid = pos;
  list.push(item);
  return true;
}

/** ★ 发放剧情物证/初始道具到玩家背包指定分区（默认剧情 plot）：由副本逻辑（gameHandler 等）调用 */
function grantPlotItem(character, data) {
  if (!character) return null;
  if (!character.inventory) character.inventory = [];
  const type = data.type || 'plot';
  const it = {
    uid: 'it_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    itemId: data.itemId,
    itemName: data.itemName || '线索',
    type,
    quality: data.quality || 'gold',
    desc: data.desc || '',
    icon: data.icon || '📜',
    stack: 1,
    maxStack: 1,
    stackable: false,
    usable: !!data.usable,
    cooldown: 0,
    effects: [],
    size: { w: 1, h: 1 },
    grid: null,
    slot: null,
    belongDungeon: data.belongDungeon || 'all'
  };
  const ok = placeItem(character.inventory, it, type);
  if (!ok) return null; // 分区满 → 返回 null，不强行塞入
  return it;
}

/** 兼容旧存档：给无格子位置的物品自动分配位置（背包按分区 / 仓库大网格，分区满则入仓库）；★ 所有物品强制一格大小 */
function ensureGrid(character) {
  let changed = false;
  // ★ 统一一格大小（用户要求所有物品 1×1）
  for (const key of ['inventory', 'warehouse']) {
    for (const it of (character[key] || [])) {
      if (!it.size || it.size.w !== 1 || it.size.h !== 1) { it.size = { w: 1, h: 1 }; changed = true; }
    }
  }
  const inv = character.inventory || [];
  const noGridInv = inv.filter(i => !i.grid);
  if (noGridInv.length) {
    character.inventory = inv.filter(i => i.grid);
    for (const it of noGridInv) {
      const p = INV_PARTITIONS[partitionFor(it.type)] || INV_PARTITIONS.consumable;
      const same = character.inventory.filter(i => partitionFor(i.type) === partitionFor(it.type));
      const size = it.size || { w: 1, h: 1 };
      let pos = findFreeSlot(same, p.cols, p.rows, size);
      if (!pos) {
        // 分区已满 → 自动放入仓库（大空间），避免物品丢失
        if (!character.warehouse) character.warehouse = [];
        pos = findFreeSlot(character.warehouse, WH_COLS, WH_ROWS, size);
        if (pos) { it.grid = pos; character.warehouse.push(it); continue; }
      }
      if (pos) { it.grid = pos; character.inventory.push(it); }
      else character.inventory.push(it);
    }
    changed = true;
  }
  const wh = character.warehouse || [];
  const noGridWh = wh.filter(i => !i.grid);
  if (noGridWh.length) {
    character.warehouse = wh.filter(i => i.grid);
    for (const it of noGridWh) {
      const pos = findFreeSlot(character.warehouse, WH_COLS, WH_ROWS, it.size || { w: 1, h: 1 });
      if (pos) { it.grid = pos; character.warehouse.push(it); }
      else character.warehouse.push(it);
    }
    changed = true;
  }
  // ★ 分区尺寸变更后：越界物品自动重放（背包按新分区尺寸找空位；分区满则入仓库），防止旧存档显示异常
  const invAll = character.inventory || [];
  for (const it of invAll) {
    if (!it.grid) continue;
    const p = INV_PARTITIONS[partitionFor(it.type)];
    if (!p) continue;
    const size = it.size || { w: 1, h: 1 };
    if (it.grid.x >= 0 && it.grid.y >= 0 && it.grid.x + size.w <= p.cols && it.grid.y + size.h <= p.rows) continue;
    const same = invAll.filter(i => i !== it && partitionFor(i.type) === partitionFor(it.type));
    let pos = findFreeSlot(same, p.cols, p.rows, size);
    if (!pos) {
      if (!character.warehouse) character.warehouse = [];
      pos = findFreeSlot(character.warehouse, WH_COLS, WH_ROWS, size);
      if (pos) { it.grid = pos; character.warehouse.push(it); changed = true; continue; }
    }
    if (pos) { it.grid = pos; changed = true; }
  }
  return changed;
}



module.exports = { partitionFor, restoreItemFromTemplate, buildEquipInfo, occupancyMap, canPlaceAt, findFreeSlot, dstItemsOf, tryMergeStack, moveBetween, placeItem, grantPlotItem, ensureGrid, VALID_SLOTS, SLOT_LABELS, PART_LABEL, INV_PARTITIONS, WH_COLS, WH_ROWS };
