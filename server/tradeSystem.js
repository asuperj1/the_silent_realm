/**
 * tradeSystem.js — 寄售 / 拍卖（档案大厅工坊子功能）
 * - 寄售 sellItem：玩家把背包/仓库物品出售给系统 → 获得寂静点数（按品质定价）
 * - 拍卖 auction：内存级拍卖行（跨玩家）——挂牌 / 列表 / 竞标 / 结算
 * 数据：拍卖单存内存 Map（拍卖列表）+ 角色字段 auctionListings（我的挂牌，持久化）
 */
const storage = require('./storage');

// ==================== 寄售定价（按品质基础价 × 强化加成） ====================
const SELL_BASE = {
  white: 5, green: 12, blue: 30, purple: 60, gold: 120, orange: 200, red: 320, black: 10
};
const SELL_TYPE_RATIO = { equipment: 1.2, tool: 0.6, consumable: 0.5, material: 0.3, plot: 0.1, perm: 0.8 };

function sellPrice(item) {
  const q = item.quality || 'white';
  const base = SELL_BASE[q] || 5;
  const typeR = SELL_TYPE_RATIO[item.type] || 0.5;
  const enh = item.enhanceLevel || 0;
  const dur = (item.durability != null && item.maxDurability != null && item.maxDurability > 0)
    ? (item.durability / item.maxDurability) : 1;
  return Math.max(1, Math.round(base * typeR * (0.6 + 0.4 * dur) + enh * 3));
}

// ==================== 拍卖行（内存级） ====================
// 拍卖单：{ id, itemName, itemId, icon, quality, enhanceLevel, desc, seller, sellerName, price (起拍价), bidder, bid, bidderName, expiresAt, active }
const AUCTIONS = new Map();
let auctionSeq = 1;

// 拍卖挂单时长（毫秒）：1 小时
const AUCTION_DURATION = 60 * 60 * 1000;

// ==================== 注册 ====================
function registerTrade(socket, io, state) {
  // ---- 寄售：物品 → 寂静点数 ----
  socket.on('sellItem', ({ uid }) => {
    if (!socket.character) return;
    const ch = socket.character;
    const all = [...(ch.inventory || []), ...(ch.warehouse || [])];
    const idxInv = ch.inventory ? ch.inventory.findIndex(i => (i.uid || i.id) === uid) : -1;
    const idxWh = ch.warehouse ? ch.warehouse.findIndex(i => (i.uid || i.id) === uid) : -1;
    const inInv = idxInv >= 0;
    const inWh = !inInv && idxWh >= 0;
    if (!inInv && !inWh) { socket.emit('sellResult', { ok: false, msg: '未找到该物品' }); return; }
    const item = inInv ? ch.inventory[idxInv] : ch.warehouse[idxWh];
    // 剧情/关键物品不允许寄售
    if (item.type === 'plot' || (item.itemId && item.itemId.startsWith('CLUE'))) {
      socket.emit('sellResult', { ok: false, msg: '剧情/线索物品不可寄售' }); return;
    }
    const price = sellPrice(item);
    if (inInv) ch.inventory.splice(idxInv, 1);
    else ch.warehouse.splice(idxWh, 1);
    ch.mysteryPoint = (ch.mysteryPoint || 0) + price;
    storage.saveCharacter(ch);
    socket.emit('sellResult', { ok: true, msg: `已寄售「${item.itemName || item.name}」，获得 ${price} 寂静点数`, price, points: ch.mysteryPoint });
    socket.emit('inventoryData', {
      items: ch.inventory, warehouse: ch.warehouse,
      partitions: require('./playerItems').INV_PARTITIONS, whCols: require('./playerItems').WH_COLS, whRows: require('./playerItems').WH_ROWS
    });
  });

  // ---- 拍卖：挂牌 ----
  socket.on('auction.list', ({ uid, price }) => {
    if (!socket.character) return;
    const ch = socket.character;
    const p = Math.max(1, Math.floor(Number(price) || 1));
    const all = [...(ch.inventory || []), ...(ch.warehouse || [])];
    const idxInv = ch.inventory ? ch.inventory.findIndex(i => (i.uid || i.id) === uid) : -1;
    const idxWh = ch.warehouse ? ch.warehouse.findIndex(i => (i.uid || i.id) === uid) : -1;
    const inInv = idxInv >= 0;
    const inWh = !inInv && idxWh >= 0;
    if (!inInv && !inWh) { socket.emit('auctionResult', { ok: false, msg: '未找到该物品' }); return; }
    const item = inInv ? ch.inventory[idxInv] : ch.warehouse[idxWh];
    if (item.type === 'plot' || (item.itemId && item.itemId.startsWith('CLUE'))) {
      socket.emit('auctionResult', { ok: false, msg: '剧情/线索物品不可拍卖' }); return;
    }
    if (inInv) ch.inventory.splice(idxInv, 1);
    else ch.warehouse.splice(idxWh, 1);
    storage.saveCharacter(ch);
    const id = 'auc_' + (auctionSeq++) + '_' + Date.now();
    const listing = {
      id, itemName: item.itemName || item.name, itemId: item.itemId || null,
      icon: item.icon || '📦', quality: item.quality || 'white',
      enhanceLevel: item.enhanceLevel || 0, desc: item.desc || '',
      seller: ch.uid, sellerName: ch.name || '调查员',
      price: p, bidder: null, bid: 0, bidderName: null,
      expiresAt: Date.now() + AUCTION_DURATION, active: true
    };
    AUCTIONS.set(id, listing);
    socket.emit('auctionResult', { ok: true, msg: `已挂牌「${listing.itemName}」起拍 ${p} 点`, id });
    broadcastAuction(io);
  });

  // ---- 拍卖：列表 ----
  socket.on('auction.listings', () => {
    if (!socket.character) return;
    purgeExpired();
    const list = Array.from(AUCTIONS.values()).filter(a => a.active).map(a => ({
      ...a, mine: a.seller === socket.character.uid
    }));
    socket.emit('auctionData', { listings: list });
  });

  // ---- 拍卖：竞标 ----
  socket.on('auction.bid', ({ id, amount }) => {
    if (!socket.character) return;
    const ch = socket.character;
    const a = AUCTIONS.get(id);
    if (!a || !a.active) { socket.emit('auctionResult', { ok: false, msg: '该拍卖已结束' }); return; }
    if (a.seller === ch.uid) { socket.emit('auctionResult', { ok: false, msg: '不能竞标自己的拍卖' }); return; }
    const bid = Math.max(a.bid + 1, Math.floor(Number(amount) || 0), a.price);
    const cost = bid;
    if ((ch.mysteryPoint || 0) < cost) { socket.emit('auctionResult', { ok: false, msg: '寂静点数不足' }); return; }
    // 退换前一位竞标者
    if (a.bidder) {
      const prevChar = findCharByUid(state, a.bidder);
      if (prevChar) { prevChar.mysteryPoint = (prevChar.mysteryPoint || 0) + a.bid; storage.saveCharacter(prevChar); }
    }
    ch.mysteryPoint -= cost;
    storage.saveCharacter(ch);
    a.bidder = ch.uid; a.bidderName = ch.name || '调查员'; a.bid = bid;
    socket.emit('auctionResult', { ok: true, msg: `已出价 ${bid} 点` });
    broadcastAuction(io);
  });

  // ---- 拍卖：结算（到期由定时器或主动查询触发） ----
  socket.on('auction.settle', ({ id }) => {
    if (!socket.character) return;
    const a = AUCTIONS.get(id);
    if (!a) { socket.emit('auctionResult', { ok: false, msg: '该拍卖不存在' }); return; }
    if (a.seller !== socket.character.uid) { socket.emit('auctionResult', { ok: false, msg: '仅卖家可结算' }); return; }
    finalizeAuction(state, io, a);
    socket.emit('auctionResult', { ok: true, msg: '已结算' });
  });

  // ---- 拍卖：撤销（卖家未成交可撤回） ----
  socket.on('auction.cancel', ({ id }) => {
    if (!socket.character) return;
    const ch = socket.character;
    const a = AUCTIONS.get(id);
    if (!a || a.seller !== ch.uid) { socket.emit('auctionResult', { ok: false, msg: '无权撤销' }); return; }
    if (a.bidder) { socket.emit('auctionResult', { ok: false, msg: '已有竞标，不可撤回' }); return; }
    AUCTIONS.delete(id);
    // 物品退回卖家
    if (!ch.inventory) ch.inventory = [];
    const inst = {
      uid: 'it_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      itemId: a.itemId, itemName: a.itemName, type: 'equipment', quality: a.quality,
      desc: a.desc, icon: a.icon, stack: 1, maxStack: 1, stackable: false,
      enhanceLevel: a.enhanceLevel, size: { w: 1, h: 1 }, grid: null, belongDungeon: 'all'
    };
    require('./playerItems').placeItem(ch.inventory, inst, 'equipment');
    storage.saveCharacter(ch);
    socket.emit('auctionResult', { ok: true, msg: '已撤回挂牌，物品退回背包' });
    broadcastAuction(io);
  });
}

// ==================== 工具 ====================
function findCharByUid(state, uid) {
  for (const room of state.gameRooms.values()) {
    for (const p of room.players.values()) {
      if (p.character && p.character.uid === uid) return p.character;
    }
  }
  // 兜底：查内存缓存角色（storage 可能维护字符缓存）
  if (storage.getCharacter) { try { return storage.getCharacter(uid); } catch (e) {} }
  return null;
}

function finalizeAuction(state, io, a) {
  a.active = false;
  AUCTIONS.delete(a.id);
  if (!a.bidder) return; // 无人竞标 → 物品作废（或可退回，简化处理）
  // 卖家收钱
  const seller = findCharByUid(state, a.seller);
  if (seller) { seller.mysteryPoint = (seller.mysteryPoint || 0) + a.bid; storage.saveCharacter(seller); }
  // 买家收货（放背包）
  const buyer = findCharByUid(state, a.bidder);
  if (buyer) {
    if (!buyer.inventory) buyer.inventory = [];
    const inst = {
      uid: 'it_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      itemId: a.itemId, itemName: a.itemName, type: 'equipment', quality: a.quality,
      desc: a.desc, icon: a.icon, stack: 1, maxStack: 1, stackable: false,
      enhanceLevel: a.enhanceLevel, size: { w: 1, h: 1 }, grid: null, belongDungeon: 'all'
    };
    require('./playerItems').placeItem(buyer.inventory, inst, 'equipment');
    storage.saveCharacter(buyer);
    try { io.to('hall').emit('auctionSold', { msg: `拍卖成交：${a.itemName} 由 ${a.bidderName} 以 ${a.bid} 点拍得` }); } catch (e) {}
  }
}

function purgeExpired() {
  const now = Date.now();
  for (const [id, a] of AUCTIONS) {
    if (!a.active) { AUCTIONS.delete(id); continue; }
    if (now >= a.expiresAt) finalizeAuction(null, null, a);
  }
}

function broadcastAuction(io) {
  try {
    purgeExpired();
    const list = Array.from(AUCTIONS.values()).filter(a => a.active);
    io.to('hall').emit('auctionData', { listings: list });
  } catch (e) {}
}

// 定时清理过期拍卖（每 30s）
setInterval(() => { try { purgeExpired(); } catch (e) {} }, 30000);

module.exports = { registerTrade, sellPrice, SELL_BASE };
