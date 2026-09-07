/**
 * playerHandler.js — 商店 / 背包 / 消耗品域（T-5 拆分产物）
 * 6 事件：getShopItems / buyItem / getInventory / equipItem / dropItem / useItem
 * 纯玩家账户操作（useItem 需向副本房间广播 HP/SAN 变化，读取 state.gameRooms）。
 */

const gameLogic = require('./gamelogic');
const storage = require('./storage');
const logger = require('./logger');
// ★ 事件驱动系统（改进①：物品使用/HP/SAN 事件发布）
const eventBus = require('./eventBus');
const EVENTS = require('./eventTypes');
// ★ 物品框架（ItemEngine）：六槽装备 / 效果引擎 / 副本物品
const { getItemEngine } = require('./itemEngine/ItemEngine');
const itemEngine = getItemEngine();
// ★ 拆分（2026-08-16）：背包格子辅助/常量已迁至 ./playerItems
const PI = require('./playerItems');
const { partitionFor, restoreItemFromTemplate, buildEquipInfo, occupancyMap, canPlaceAt, findFreeSlot, dstItemsOf, tryMergeStack, moveBetween, placeItem, grantPlotItem, ensureGrid, VALID_SLOTS, SLOT_LABELS, PART_LABEL, INV_PARTITIONS, WH_COLS, WH_ROWS } = PI;

// 商店/背包域（5 事件）
function registerPlayer(socket, io, state) {
  socket.on('getShopItems', () => {
    if (!socket.character) return;
    socket.emit('shopData', { items: gameLogic.SHOP_ITEMS, points: socket.character.mysteryPoint, tier: gameLogic.getTier(socket.character) });
  });
  socket.on('buyItem', ({ itemId }) => {
    if (!socket.character) return;
    const item = gameLogic.SHOP_ITEMS[itemId];
    if (!item) return;
    if (socket.character.mysteryPoint < item.cost) return;
    // ★ P1 阶位权限：商城高阶商品按品质设门槛（蓝/紫/金/橙/红 → 1/2/3/4/5 阶）
    const TIER_BY_QUALITY = { blue: 1, purple: 2, gold: 3, orange: 4, red: 5 };
    const needTier = item.tier || TIER_BY_QUALITY[item.quality] || 0;
    const myTier = gameLogic.getTier(socket.character);
    if (needTier > 0 && myTier < needTier) {
      socket.emit('shopPurchase', { msg: `该商品需「${gameLogic.tierName(needTier)}」阶位解锁（当前「${gameLogic.tierName(myTier)}」）`, ok: false });
      return;
    }
    socket.character.mysteryPoint -= item.cost;

    // ★ 永久强化：购买直接应用属性，不产生物品
    if (item.type === 'perm') {
      const attr = socket.character.attr || (socket.character.attr = {});
      for (const [k, v] of Object.entries(item.effect || {})) {
        attr[k] = (attr[k] || 0) + v;
      }
      storage.saveCharacter(socket.character);
      socket.emit('shopData', { items: gameLogic.SHOP_ITEMS, points: socket.character.mysteryPoint, tier: gameLogic.getTier(socket.character) });
      socket.emit('characterUpdate', { uid: socket.character.uid, attr: { ...socket.character.attr } });
      socket.emit('shopPurchase', { msg: `已购买 ${itemId}（永久生效）`, ok: true });
      return;
    }

    // ★ 生成物品实例 → 格子化背包
    if (!socket.character.inventory) socket.character.inventory = [];
    let inst = null;
    if (item.itemId) {
      // 新框架模板（白色工具等）
      try { inst = itemEngine.factory.create(item.itemId); }
      catch (e) { inst = null; }
    }
    if (!inst) {
      // 旧格式消耗/装备 → 构造格子兼容实例
      inst = {
        uid: 'it_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        itemId: item.itemId || null,
        itemName: itemId,
        type: item.type,
        quality: item.quality || 'white',
        desc: item.desc || '',
        icon: item.icon || '📦',
        stack: 1, maxStack: 1, stackable: false,
        usable: item.type === 'consumable',
        effects: Object.entries(item.effect || {}).map(([k, v]) =>
          ({ trigger: 'use', kind: (k === 'hp' ? 'hp' : k === 'san' ? 'san' : 'stat'), stat: k, value: v, target: 'self' })),
        size: { w: 1, h: 1 }, grid: null,
        slot: item.type === 'equip' ? 'accessory' : null,
        belongDungeon: 'all'
      };
    }
    // 放入对应背包分区（占格子）；背包满则自动入仓库
    const ok = placeItem(socket.character.inventory, inst, partitionFor(inst.type) || 'equipment');
    if (!ok) {
      if (!socket.character.warehouse) socket.character.warehouse = [];
      placeItem(socket.character.warehouse, inst, 'warehouse');
    }
    storage.saveCharacter(socket.character);
    socket.emit('shopData', { items: gameLogic.SHOP_ITEMS, points: socket.character.mysteryPoint, tier: gameLogic.getTier(socket.character) });
    socket.emit('inventoryData', {
      items: socket.character.inventory, warehouse: socket.character.warehouse,
      partitions: INV_PARTITIONS, whCols: WH_COLS, whRows: WH_ROWS
    });
    socket.emit('shopPurchase', { msg: `已购买 ${itemId}，已放入背包`, ok: true });
  });
  socket.on('getInventory', () => {
    if (!socket.character) return;
    // ★ 旧存档物品自动分配格子位置（背包按分区 / 仓库大网格）
    if (ensureGrid(socket.character)) storage.saveCharacter(socket.character);
    // ★ 分区背包 + 仓库 + MC 快捷栏（附容量）+ 装备完整信息
    socket.emit('inventoryData', {
      items: socket.character.inventory || [],
      warehouse: socket.character.warehouse || [],
      hotbar: socket.character.hotbar || [],
      partitions: INV_PARTITIONS,
      whCols: WH_COLS, whRows: WH_ROWS,
      equipInfo: buildEquipInfo(socket.character)
    });
  });
  // ★ MC 风格快捷栏：保存 8 格快捷栏物品（uid 列表，固定 8 长度保留空位；★ 同一物品只允许出现一次）
  socket.on('setHotbar', ({ items }) => {
    if (!socket.character) return;
    const inv = socket.character.inventory || [];
    const list = Array.isArray(items) ? items.slice(0, 8) : [];
    // ★ 保留空位（null）+ 去重（同一物品只保留第一次出现），避免快捷栏出现重复物品
    const seen = new Set();
    const padded = [];
    for (let i = 0; i < 8; i++) {
      const uid = list[i];
      if (!uid || !inv.some(x => (x.uid || x.id) === uid) || seen.has(uid)) { padded.push(null); continue; }
      seen.add(uid);
      padded.push(uid);
    }
    socket.character.hotbar = padded;
    storage.saveCharacter(socket.character);
    socket.emit('inventoryData', {
      items: socket.character.inventory, warehouse: socket.character.warehouse || [],
      hotbar: socket.character.hotbar, partitions: INV_PARTITIONS, whCols: WH_COLS, whRows: WH_ROWS
    });
  });
  // 背包 → 仓库（拖入仓库，格子放置）
  socket.on('moveToWarehouse', ({ itemId, x, y }) => {
    if (!socket.character) return;
    const r = moveBetween(socket.character, 'inventory', 'warehouse', itemId, x, y);
    if (!r) return;
    if (!r.ok) return socket.emit('error', { msg: r.msg });
    storage.saveCharacter(socket.character);
    socket.emit('inventoryData', {
      items: socket.character.inventory, warehouse: socket.character.warehouse,
      partitions: INV_PARTITIONS, whCols: WH_COLS, whRows: WH_ROWS
    });
  });
  // 仓库 → 背包（拖入背包，按类型分区放置）
  socket.on('moveToInventory', ({ itemId, x, y }) => {
    if (!socket.character) return;
    const r = moveBetween(socket.character, 'warehouse', 'inventory', itemId, x, y);
    if (!r) return;
    if (!r.ok) return socket.emit('error', { msg: r.msg });
    storage.saveCharacter(socket.character);
    socket.emit('inventoryData', {
      items: socket.character.inventory, warehouse: socket.character.warehouse,
      partitions: INV_PARTITIONS, whCols: WH_COLS, whRows: WH_ROWS
    });
  });
  // ★ 背包内自由拖动（重排/互换）：必须提供有效目标坐标且落在物品所属分区内；目标格被同分区物品占用 → 互换位置
  socket.on('moveInInventory', ({ itemId, x, y }) => {
    if (!socket.character) return;
    const inv = socket.character.inventory || [];
    const idx = inv.findIndex(i => (i.id === itemId) || (i.uid === itemId));
    if (idx === -1) return;
    const item = inv[idx];
    const p = INV_PARTITIONS[partitionFor(item.type)];
    if (!p) return;
    // ★ 无有效坐标（跨分区/未指定）→ 拒绝，提示只能放入对应分区
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      const lbl = PART_LABEL[partitionFor(item.type)] || '对应';
      return socket.emit('error', { msg: `「${item.itemName || item.name || itemId}」只能放入「${lbl}」分区` });
    }
    const size = item.size || { w: 1, h: 1 };
    const same = inv.filter(i => i !== item && partitionFor(i.type) === partitionFor(item.type));
    // ★ 目标格被同分区物品占用 → 两个物品互换位置
    const occ = same.find(i => i.grid && i.grid.x === x && i.grid.y === y);
    if (occ) {
      const tmp = { x: item.grid.x, y: item.grid.y };
      item.grid = { x, y };
      occ.grid = tmp;
      storage.saveCharacter(socket.character);
      socket.emit('inventoryData', {
        items: socket.character.inventory, warehouse: socket.character.warehouse || [],
        hotbar: socket.character.hotbar || [], partitions: INV_PARTITIONS, whCols: WH_COLS, whRows: WH_ROWS
      });
      return;
    }
    if (!canPlaceAt(same, p.cols, p.rows, x, y, size, item.uid)) return socket.emit('error', { msg: '该位置无法放置' });
    item.grid = { x, y };
    storage.saveCharacter(socket.character);
    socket.emit('inventoryData', {
      items: socket.character.inventory, warehouse: socket.character.warehouse || [],
      hotbar: socket.character.hotbar || [], partitions: INV_PARTITIONS, whCols: WH_COLS, whRows: WH_ROWS
    });
  });
  // ★ 仓库内自由拖动（重排/互换）：作用于仓库空间（WH_COLS × WH_ROWS），目标格被占用 → 互换位置
  socket.on('moveInWarehouse', ({ itemId, x, y }) => {
    if (!socket.character) return;
    const wh = socket.character.warehouse || [];
    const idx = wh.findIndex(i => (i.id === itemId) || (i.uid === itemId));
    if (idx === -1) return;
    const item = wh[idx];
    if (!Number.isInteger(x) || !Number.isInteger(y)) return socket.emit('error', { msg: '请拖到仓库内的具体格子' });
    const size = item.size || { w: 1, h: 1 };
    const same = wh.filter(i => i !== item);
    // ★ 目标格被占用 → 两个物品互换位置
    const occ = same.find(i => i.grid && i.grid.x === x && i.grid.y === y);
    if (occ) {
      const tmp = { x: item.grid.x, y: item.grid.y };
      item.grid = { x, y };
      occ.grid = tmp;
      storage.saveCharacter(socket.character);
      socket.emit('inventoryData', {
        items: socket.character.inventory, warehouse: socket.character.warehouse || [],
        partitions: INV_PARTITIONS, whCols: WH_COLS, whRows: WH_ROWS
      });
      return;
    }
    if (!canPlaceAt(same, WH_COLS, WH_ROWS, x, y, size, item.uid)) return socket.emit('error', { msg: '该位置无法放置' });
    item.grid = { x, y };
    storage.saveCharacter(socket.character);
    socket.emit('inventoryData', {
      items: socket.character.inventory, warehouse: socket.character.warehouse || [],
      partitions: INV_PARTITIONS, whCols: WH_COLS, whRows: WH_ROWS
    });
  });
  socket.on('equipItem', ({ itemId, slot }) => {
    if (!socket.character) return;
    const inv = socket.character.inventory || [];
    const item = inv.find(i => i.id === itemId || i.uid === itemId);
    if (!item) return;
    if (!socket.character.equip) socket.character.equip = {};
    const tpl = itemEngine.resolveTemplate(item.itemId || item.name);
    // ★ 旧框架物品（仅 name）装备时补全 itemName，保证装备槽/卸下解析模板正确
    if (tpl && !item.itemName) item.itemName = tpl.itemName;
    const targetSlot = VALID_SLOTS.includes(slot) ? slot : (tpl ? tpl.slot : null);
    if (!targetSlot || !VALID_SLOTS.includes(targetSlot)) return socket.emit('error', { msg: '无效装备槽' });
    if (!tpl) return socket.emit('error', { msg: '仅支持新框架装备' });
    // ★ 部位强校验：只有对应部位的装备才能放入对应槽
    if (tpl.slot && tpl.slot !== targetSlot) {
      return socket.emit('error', { msg: `该装备只能放入「${SLOT_LABELS[tpl.slot] || tpl.slot}」槽` });
    }
    // ★ 走 ItemEngine（应用装备主属性 + 重算面板）
    const r = itemEngine.equip(socket.character, item, targetSlot);
    if (!r.ok) return socket.emit('error', { msg: r.msg });
    if (r.old) placeItem(inv, { id: 'item_' + Date.now(), name: r.old, type: 'equipment', effect: {}, size: { w: 1, h: 1 } }, 'equipment');
    socket.character.inventory = inv.filter(i => (i.id !== itemId) && (i.uid !== itemId));
    storage.saveCharacter(socket.character);
    socket.emit('equipChanged', { equip: { ...socket.character.equip }, equipInfo: buildEquipInfo(socket.character), items: socket.character.inventory, warehouse: socket.character.warehouse || [] });
  });
  // 卸下装备（放回背包，六槽）
  socket.on('unequipItem', ({ slot }) => {
    if (!socket.character) return;
    if (!socket.character.equip) socket.character.equip = {};
    const slotName = VALID_SLOTS.includes(slot) ? slot : null;
    if (!slotName || !socket.character.equip[slotName]) return;
    const oldName = socket.character.equip[slotName];
    // ★ 新框架装备回退属性；旧装备仅移除名字
    const tpl = itemEngine.resolveTemplate(oldName);
    if (tpl) itemEngine.unequip(socket.character, slotName);
    else socket.character.equip[slotName] = null;
    if (!socket.character.inventory) socket.character.inventory = [];
    // ★ 卸下到「装备背包」（装备分区 6 格）；分区已满则放入仓库，避免装备丢失
    const restored = restoreItemFromTemplate(tpl, oldName);
    const ok = placeItem(socket.character.inventory, restored, 'equipment');
    if (!ok) {
      if (!socket.character.warehouse) socket.character.warehouse = [];
      const pos = findFreeSlot(socket.character.warehouse, WH_COLS, WH_ROWS, restored.size || { w: 1, h: 1 });
      if (pos) { restored.grid = pos; socket.character.warehouse.push(restored); }
      else return socket.emit('error', { msg: '背包与仓库均无空位，无法卸下' });
    }
    storage.saveCharacter(socket.character);
    socket.emit('equipChanged', { equip: { ...socket.character.equip }, equipInfo: buildEquipInfo(socket.character), items: socket.character.inventory, warehouse: socket.character.warehouse || [] });
  });  // ★ 装备槽拖出 → 直接存入仓库（格子放置）
  socket.on('unequipToWarehouse', ({ slot, x, y }) => {
    if (!socket.character) return;
    if (!VALID_SLOTS.includes(slot) || !socket.character.equip || !socket.character.equip[slot]) return;
    const oldName = socket.character.equip[slot];
    const tpl = itemEngine.resolveTemplate(oldName);
    if (tpl) itemEngine.unequip(socket.character, slot);
    else socket.character.equip[slot] = null;
    if (!socket.character.warehouse) socket.character.warehouse = [];
    const item = restoreItemFromTemplate(tpl, oldName);
    let pos = null;
    if (Number.isInteger(x) && Number.isInteger(y) && canPlaceAt(socket.character.warehouse, WH_COLS, WH_ROWS, x, y, item.size, null)) pos = { x, y };
    if (!pos) pos = findFreeSlot(socket.character.warehouse, WH_COLS, WH_ROWS, item.size);
    if (!pos) return socket.emit('error', { msg: '仓库已满，无法卸下' });
    item.grid = pos;
    socket.character.warehouse.push(item);
    storage.saveCharacter(socket.character);
    socket.emit('equipChanged', { equip: { ...socket.character.equip }, equipInfo: buildEquipInfo(socket.character), items: socket.character.inventory, warehouse: socket.character.warehouse || [] });
    socket.emit('inventoryData', { items: socket.character.inventory, warehouse: socket.character.warehouse, partitions: INV_PARTITIONS, whCols: WH_COLS, whRows: WH_ROWS });
  });  // 技能加点：分配升级获得的属性点（attrPoints）
  socket.on('applyAttrPoints', ({ allocated }) => {
    if (!socket.character) return;
    const character = socket.character;
    const pts = character.attrPoints || 0;
    const sum = Object.values(allocated || {}).reduce((a, b) => a + (b || 0), 0);
    if (sum > pts) return socket.emit('error', { msg: '可分配属性点不足' });
    for (const [k, v] of Object.entries(allocated || {})) {
      if (v > 0 && character.attr[k] !== undefined) {
        character.attr[k] = Math.min(100, character.attr[k] + v);
      }
    }
    character.attrPoints = pts - sum;
    character.attr.maxHp = character.attr.con * 2;
    character.attr.hp = Math.min(character.attr.hp, character.attr.maxHp);
    storage.saveCharacter(character);
    socket.emit('attrPointsApplied', { attr: character.attr, attrPoints: character.attrPoints });
    logger.user.info('技能加点应用', { uid: character.uid, allocated });
  });
  socket.on('dropItem', ({ itemId }) => {
    if (!socket.character) return;
    const inv = socket.character.inventory || [];
    const idx = inv.findIndex(i => i.id === itemId || i.uid === itemId);
    if (idx === -1) return;
    inv.splice(idx, 1);
    storage.saveCharacter(socket.character);
    socket.emit('inventoryData', { items: inv, warehouse: socket.character.warehouse || [] });
  });
  // ★ 副本掉落（剧本表驱动）：dungeonRollLoot { dungeonId, scene, action }
  // 青峰山示例：car3/search（出生点搜索）、car5/restRoom（休息室）、car6/bossDrop（修格斯）
  socket.on('dungeonRollLoot', ({ dungeonId, scene, action }) => {
    if (!socket.character) return;
    const did = dungeonId || 'qingfengshan';
    if (!itemEngine.isDungeonActive(did)) return socket.emit('error', { msg: '该副本物品未注册，无法掉落' });
    // ★ 成员校验：玩家必须处于该副本的游戏房间内（防无限刷稀有掉落）
    let inRoom = false;
    for (const [, room] of state.gameRooms) {
      if (room.players.has(socket.id) && room.itemDungeonId === did) { inRoom = true; break; }
    }
    if (!inRoom) return socket.emit('error', { msg: '未处于该副本房间' });
    const drops = itemEngine.roll(did, scene, action, { character: socket.character });
    if (!drops.length) return socket.emit('itemLoot', { msg: '本轮没有掉落', items: [] });
    if (!socket.character.inventory) socket.character.inventory = [];
    const gained = [];
    for (const d of drops) {
      if (!itemEngine.factory.tryStack(socket.character.inventory, d)) {
        socket.character.inventory.push(d);
      }
      gained.push(d);
    }
    storage.saveCharacter(socket.character);
    const gainText = gained.map(g => `${g.itemName}×${g.stack}`).join('、');
    socket.emit('itemLoot', { msg: `掉落：${gainText}`, items: socket.character.inventory, warehouse: socket.character.warehouse || [] });
    socket.emit('inventoryData', { items: socket.character.inventory, warehouse: socket.character.warehouse || [] });
    logger.user.info('副本掉落', { uid: socket.character.uid, dungeon: did, scene, action, gain: gainText });
  });
  // 使用消耗品（★ 新框架物品走效果引擎；旧物品走原逻辑）+ 广播全队 HP/SAN 变化
  socket.on('useItem', ({ itemId }) => {
    if (!socket.character) return;
    const inv = socket.character.inventory || [];
    const idx = inv.findIndex(i => i.id === itemId || i.uid === itemId);
    if (idx === -1) return;
    const item = inv[idx];
    if (!item) return;

    // ★ 新框架物品：效果引擎（hp/san/stat/buff/弹药/自定义）
    const tpl = itemEngine.resolveTemplate(item.itemId || item.name);
    if (tpl && (tpl.usable || tpl.type === 'consumable')) {
      const attrBefore = socket.character.attr ? { hp: socket.character.attr.hp, san: socket.character.attr.san } : null;
      const r = itemEngine.useItem(socket.character, item, { dungeonId: tpl.belongDungeon });
      if (!r.ok) return socket.emit('error', { msg: r.msg });
      // 堆叠消耗
      item.stack = (item.stack || 1) - 1;
      if (item.stack <= 0) inv.splice(idx, 1);
      storage.saveCharacter(socket.character);
      // ★ 改进①：物品使用 + HP/SAN 变化事件
      eventBus.emit(EVENTS.ITEM_USED, { actor: socket.character.uid, data: { item: { itemId: item.itemId, itemName: item.itemName || item.name }, effects: (r && r.effects) || null } });
      if (socket.character.attr && attrBefore) {
        const hpDelta = socket.character.attr.hp - attrBefore.hp;
        const sanDelta = socket.character.attr.san - attrBefore.san;
        if (hpDelta) eventBus.emit(EVENTS.PLAYER_HP_CHANGED, { actor: socket.character.uid, value: hpDelta, data: { hp: socket.character.attr.hp, maxHp: socket.character.attr.maxHp, cause: 'item:' + item.itemId } });
        if (sanDelta) eventBus.emit(EVENTS.PLAYER_SAN_CHANGED, { actor: socket.character.uid, value: sanDelta, data: { san: socket.character.attr.san, cause: 'item:' + item.itemId } });
      }
      socket.emit('itemUsed', { msg: r.msg, items: inv, attr: socket.character.attr });
      socket.emit('inventoryData', { items: inv, warehouse: socket.character.warehouse || [] });
      // 广播副本房间（队友面板 HP/SAN 同步）
      let itemRoomId = null;
      for (const [id, room] of state.gameRooms) {
        if (room.players.has(socket.id)) { itemRoomId = id; break; }
      }
      if (itemRoomId) {
        const itemRoom = state.gameRooms.get(itemRoomId);
        const itemP = itemRoom && itemRoom.players.get(socket.id);
        if (itemP) itemP.attr = socket.character.attr;
        io.to(itemRoomId).emit('roomUpdate', { players: Array.from(itemRoom.players.values()) });
      }
      return;
    }

    if (item.type !== 'consumable') return;
    const eff = item.effect || {};
    const attr = socket.character.attr;
    if (eff.hp) attr.hp = Math.min(attr.maxHp || attr.hp, (attr.hp || 0) + eff.hp);
    if (eff.san) attr.san = Math.min(attr.maxSan || attr.san, (attr.san || 0) + eff.san);
    for (const [k, v] of Object.entries(eff)) {
      if (k === 'hp' || k === 'san') continue;
      if (attr[k] !== undefined) attr[k] += v;
    }
    inv.splice(idx, 1);
    storage.saveCharacter(socket.character);
    // ★ 改进①：旧框架消耗品使用事件 + HP/SAN 变化事件
    eventBus.emit(EVENTS.ITEM_USED, { actor: socket.character.uid, data: { item: { itemId: item.itemId, itemName: item.itemName || item.name }, effects: { hp: eff.hp || 0, san: eff.san || 0 } } });
    if (eff.hp) eventBus.emit(EVENTS.PLAYER_HP_CHANGED, { actor: socket.character.uid, value: eff.hp, data: { hp: attr.hp, maxHp: attr.maxHp, cause: 'item:' + item.itemId } });
    if (eff.san) eventBus.emit(EVENTS.PLAYER_SAN_CHANGED, { actor: socket.character.uid, value: eff.san, data: { san: attr.san, cause: 'item:' + item.itemId } });
    socket.emit('inventoryData', { items: inv, warehouse: socket.character.warehouse || [] });
    // 广播副本房间（队友面板 HP/SAN 同步）
    let gameRoomId = null;
    for (const [id, room] of state.gameRooms) {
      if (room.players.has(socket.id)) { gameRoomId = id; break; }
    }
    if (gameRoomId) {
      const room = state.gameRooms.get(gameRoomId);
      const p = room && room.players.get(socket.id);
      if (p) p.attr = socket.character.attr;
      io.to(gameRoomId).emit('roomUpdate', { players: Array.from(room.players.values()) });
    }
  });
}

module.exports = { registerPlayer, grantPlotItem };
