/**
 * marketSystem.js — 商店模块（档案大厅）：拍卖 / 寄售（玩家间市场）
 * - 拍卖 auction：现实时间持续 24 小时，卖家设定「起拍价」+「最低加价」，
 *   买家出价必须 ≥ 当前价 + 最低加价（首拍 ≥ 起拍价）；到期最高价者得。
 * - 寄售 consign：固定报价挂售，其他玩家按报价直接购买；卖家可随时撤回。
 * - 商店 shop：走 playerHandler.buyItem（现有副本商店），本模块不重复实现。
 * 数据：持久化 data/market.json（重启不丢，拍卖 24h 跨服务器重启仍可结算）。
 */
const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const PI = require('./playerItems');

// ==================== 常量 ====================
const DATA_DIR = path.join(__dirname, '..', 'data');
const MARKET_FILE = path.join(DATA_DIR, 'market.json');
const AUCTION_DURATION = 24 * 60 * 60 * 1000;      // 拍卖持续 24 小时（现实时间）
const TICK_INTERVAL = 60 * 1000;                   // 结算扫描间隔（60s）

// ==================== 内存市场 ====================
// 拍卖单：{ id, item(完整物品), seller, sellerName, startPrice, minBidIncrement,
//          currentBid, bidder, bidderName, createdAt, expiresAt, status:'active'|'closed' }
// 寄售单：{ id, item(完整物品), seller, sellerName, price, createdAt, status:'active'|'closed' }
let _market = null;   // { auctions: [], consignments: [] }
let _seq = 1;
let _tickTimer = null;
let _gameRooms = new Map();   // 供离线角色查找（首次注册时注入 state.gameRooms）
let _broadcastGlobal = null;  // 供全局广播（首次注册时注入 io）

// ==================== 持久化 ====================
function loadMarket() {
  try {
    if (fs.existsSync(MARKET_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MARKET_FILE, 'utf8'));
      _market = {
        auctions: Array.isArray(raw.auctions) ? raw.auctions : [],
        consignments: Array.isArray(raw.consignments) ? raw.consignments : []
      };
    } else {
      _market = { auctions: [], consignments: [] };
    }
  } catch (e) {
    console.warn('[market] market.json 读取失败，重置市场', e.message);
    _market = { auctions: [], consignments: [] };
  }
  // 序号取最大
  _seq = 1;
  for (const a of _market.auctions) {
    const m = /(\d+)$/.exec(a.id || '');
    if (m) _seq = Math.max(_seq, parseInt(m[1], 10) + 1);
  }
  for (const c of _market.consignments) {
    const m = /(\d+)$/.exec(c.id || '');
    if (m) _seq = Math.max(_seq, parseInt(m[1], 10) + 1);
  }
}

function saveMarket() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = MARKET_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_market, null, 2), 'utf8');
    fs.renameSync(tmp, MARKET_FILE);
  } catch (e) {
    console.warn('[market] 市场数据保存失败', e.message);
  }
}

// ==================== 角色/物品工具 ====================
function findCharByUid(uid) {
  if (!uid) return null;
  // 在线角色：扫描房间玩家
  for (const room of _gameRooms.values()) {
    for (const p of room.players.values()) {
      if (p.character && p.character.uid === uid) return p.character;
    }
  }
  // 兜底：磁盘/缓存加载
  try { return storage.loadCharacter(uid); } catch (e) { /* ignore */ }
  return null;
}

/** 从角色背包/仓库取出物品（返回物品对象，未找到返回 null） */
function takeItemFromChar(character, uid) {
  if (!character) return null;
  if (!Array.isArray(character.inventory)) character.inventory = [];
  if (!Array.isArray(character.warehouse)) character.warehouse = [];
  const idxInv = character.inventory.findIndex(i => (i.uid || i.id) === uid);
  if (idxInv >= 0) return character.inventory.splice(idxInv, 1)[0];
  const idxWh = character.warehouse.findIndex(i => (i.uid || i.id) === uid);
  if (idxWh >= 0) return character.warehouse.splice(idxWh, 1)[0];
  return null;
}

/** 放入角色背包（按物品类型进对应分区；分区满则进仓库） */
function giveItemToChar(character, item) {
  if (!character || !item) return false;
  if (!Array.isArray(character.inventory)) character.inventory = [];
  if (!Array.isArray(character.warehouse)) character.warehouse = [];
  const part = PI.partitionFor(item.type) || 'equipment';
  const ok = PI.placeItem(character.inventory, item, part);
  if (!ok) {
    PI.placeItem(character.warehouse, item, 'warehouse');
  }
  return true;
}

/** 校验物品是否可挂市场（剧情/线索/绑定黑装不可交易） */
function tradable(item) {
  if (!item) return { ok: false, msg: '未找到该物品' };
  if (item.type === 'plot' || (item.itemId && String(item.itemId).startsWith('CLUE'))) {
    return { ok: false, msg: '剧情/线索物品不可上架' };
  }
  if (item.bind || item.quality === 'black') {
    return { ok: false, msg: '绑定（黑色可成长）装备不可交易' };
  }
  return { ok: true };
}

// ==================== 拍卖结算 ====================
function finalizeAuction(a) {
  if (a.status !== 'active') return;
  a.status = 'closed';
  const itemName = a.item.itemName || a.item.name;
  if (a.bidder) {
    // 有出价：卖家收钱，买家收货
    const seller = findCharByUid(a.seller);
    if (seller) {
      seller.mysteryPoint = (seller.mysteryPoint || 0) + a.currentBid;
      storage.saveCharacter(seller);
    }
    const buyer = findCharByUid(a.bidder);
    if (buyer) {
      giveItemToChar(buyer, JSON.parse(JSON.stringify(a.item)));
      storage.saveCharacter(buyer);
    }
    if (_broadcastGlobal) {
      _broadcastGlobal({ type: 'auctionSold', msg: `🔨 拍卖成交：「${itemName}」由 ${a.bidderName} 以 ${a.currentBid} 🪙 拍得` });
    }
  } else {
    // 无出价：物品退回卖家
    const seller = findCharByUid(a.seller);
    if (seller) {
      giveItemToChar(seller, JSON.parse(JSON.stringify(a.item)));
      storage.saveCharacter(seller);
    }
  }
}

// ==================== 定时结算（到期拍卖自动结算） ====================
/** 扫描并结算所有已过期拍卖（幂等，供定时器 / 列表拉取共用） */
function purgeExpired() {
  const now = Date.now();
  let changed = false;
  for (let i = _market.auctions.length - 1; i >= 0; i--) {
    const a = _market.auctions[i];
    if (a.status === 'active' && now >= a.expiresAt) {
      finalizeAuction(a);
      _market.auctions.splice(i, 1);
      changed = true;
    }
  }
  if (changed) saveMarket();
  return changed;
}

function startTicker(io) {
  if (_tickTimer) return;
  _tickTimer = setInterval(() => {
    try {
      purgeExpired();
    } catch (e) {
      console.warn('[market] 结算扫描异常', e.message);
    }
  }, TICK_INTERVAL);
  if (_tickTimer.unref) _tickTimer.unref();
}

// ==================== 注册 ====================
function registerTrade(socket, io, state) {
  // 首次连接：加载市场 + 启动定时器 + 绑定 state/io（幂等）
  if (!_market) loadMarket();
  startTicker(io);
  if (state && state.gameRooms) _gameRooms = state.gameRooms;
  _broadcastGlobal = (payload) => { try { io.emit('marketUpdate', payload); } catch (e) { /* ignore */ } };

  // ---------------- 拍卖 ----------------
  socket.on('auction.listings', () => {
    if (!socket.character) return;
    purgeExpired();   // ★ 打开列表时立即结算已过期拍卖（无需等 60s 定时器）
    const list = _market.auctions
      .filter(a => a.status === 'active')
      .map(a => ({
        id: a.id,
        itemName: a.item.itemName || a.item.name,
        itemId: a.item.itemId || null,
        icon: a.item.icon || '📦',
        quality: a.item.quality || 'white',
        enhanceLevel: a.item.enhanceLevel || 0,
        desc: a.item.desc || '',
        type: a.item.type || 'equipment',
        seller: a.seller, sellerName: a.sellerName,
        startPrice: a.startPrice, minBidIncrement: a.minBidIncrement,
        currentBid: a.currentBid, bidder: a.bidder, bidderName: a.bidderName,
        expiresAt: a.expiresAt,
        mine: a.seller === socket.character.uid
      }));
    socket.emit('auctionData', { listings: list });
  });

  // 挂拍：卖家设定起拍价 + 最低加价，物品移出背包
  socket.on('auction.create', ({ uid, startPrice, minBid }) => {
    if (!socket.character) return;
    const ch = socket.character;
    const startPriceNum = Math.max(1, Math.floor(Number(startPrice) || 1));
    const minBidNum = Math.max(1, Math.floor(Number(minBid) || 1));
    const item = takeItemFromChar(ch, uid);
    const trad = tradable(item);
    if (!trad.ok) { if (item) giveItemToChar(ch, item); socket.emit('auctionResult', { ok: false, msg: trad.msg }); return; }
    const a = {
      id: 'auc_' + (_seq++) + '_' + Date.now(),
      item: JSON.parse(JSON.stringify(item)),
      seller: ch.uid, sellerName: ch.name || '调查员',
      startPrice: startPriceNum, minBidIncrement: minBidNum,
      currentBid: 0, bidder: null, bidderName: null,
      createdAt: Date.now(), expiresAt: Date.now() + AUCTION_DURATION,
      status: 'active'
    };
    _market.auctions.push(a);
    storage.saveCharacter(ch);
    saveMarket();
    socket.emit('auctionResult', { ok: true, msg: `🔨 已挂拍「${a.item.itemName || a.item.name}」起拍 ${startPriceNum} 🪙 · 最低加价 ${minBidNum} 🪙 · 持续 24 小时` });
    _broadcastGlobal({ type: 'auction' });
  });

  // 出价：必须 ≥ 当前价 + 最低加价（首拍 ≥ 起拍价）
  socket.on('auction.bid', ({ id, amount }) => {
    if (!socket.character) return;
    const ch = socket.character;
    const a = _market.auctions.find(x => x.id === id && x.status === 'active');
    if (!a) { socket.emit('auctionResult', { ok: false, msg: '该拍卖不存在或已结束' }); return; }
    if (a.seller === ch.uid) { socket.emit('auctionResult', { ok: false, msg: '不能竞标自己的拍卖' }); return; }
    const minNext = a.bidder ? (a.currentBid + a.minBidIncrement) : a.startPrice;
    const bid = Math.floor(Number(amount) || 0);
    if (bid < minNext) {
      socket.emit('auctionResult', { ok: false, msg: `出价需至少 ${minNext} 🪙（当前${a.bidder ? a.currentBid + ' + 最低加价 ' + a.minBidIncrement : '起拍价 ' + a.startPrice}）` });
      return;
    }
    if ((ch.mysteryPoint || 0) < bid) { socket.emit('auctionResult', { ok: false, msg: '寂静点数不足' }); return; }
    // 退换前一位竞标者
    if (a.bidder) {
      const prev = findCharByUid(a.bidder);
      if (prev) { prev.mysteryPoint = (prev.mysteryPoint || 0) + a.currentBid; storage.saveCharacter(prev); }
    }
    ch.mysteryPoint -= bid;
    a.currentBid = bid; a.bidder = ch.uid; a.bidderName = ch.name || '调查员';
    storage.saveCharacter(ch);
    saveMarket();
    socket.emit('auctionResult', { ok: true, msg: `已出价 ${bid} 🪙` });
    _broadcastGlobal({ type: 'auction' });
  });

  // 卖家撤回（无出价时）
  socket.on('auction.cancel', ({ id }) => {
    if (!socket.character) return;
    const ch = socket.character;
    const idx = _market.auctions.findIndex(a => a.id === id && a.status === 'active' && a.seller === ch.uid);
    if (idx < 0) { socket.emit('auctionResult', { ok: false, msg: '无权撤回或拍卖不存在' }); return; }
    const a = _market.auctions[idx];
    if (a.bidder) { socket.emit('auctionResult', { ok: false, msg: '已有出价，不可撤回' }); return; }
    _market.auctions.splice(idx, 1);
    giveItemToChar(ch, JSON.parse(JSON.stringify(a.item)));
    storage.saveCharacter(ch);
    saveMarket();
    socket.emit('auctionResult', { ok: true, msg: '已撤回挂拍，物品退回背包' });
    _broadcastGlobal({ type: 'auction' });
  });

  // ---------------- 寄售（固定报价，玩家间） ----------------
  socket.on('consign.listings', () => {
    if (!socket.character) return;
    const list = _market.consignments
      .filter(c => c.status === 'active')
      .map(c => ({
        id: c.id,
        itemName: c.item.itemName || c.item.name,
        itemId: c.item.itemId || null,
        icon: c.item.icon || '📦',
        quality: c.item.quality || 'white',
        enhanceLevel: c.item.enhanceLevel || 0,
        desc: c.item.desc || '',
        type: c.item.type || 'equipment',
        seller: c.seller, sellerName: c.sellerName,
        price: c.price, createdAt: c.createdAt,
        mine: c.seller === socket.character.uid
      }));
    socket.emit('consignData', { listings: list });
  });

  // 挂售：固定报价，物品移出背包
  socket.on('consign.create', ({ uid, price }) => {
    if (!socket.character) return;
    const ch = socket.character;
    const priceNum = Math.max(1, Math.floor(Number(price) || 1));
    const item = takeItemFromChar(ch, uid);
    const trad = tradable(item);
    if (!trad.ok) { if (item) giveItemToChar(ch, item); socket.emit('consignResult', { ok: false, msg: trad.msg }); return; }
    const c = {
      id: 'con_' + (_seq++) + '_' + Date.now(),
      item: JSON.parse(JSON.stringify(item)),
      seller: ch.uid, sellerName: ch.name || '调查员',
      price: priceNum, createdAt: Date.now(),
      status: 'active'
    };
    _market.consignments.push(c);
    storage.saveCharacter(ch);
    saveMarket();
    socket.emit('consignResult', { ok: true, msg: `📦 已挂售「${c.item.itemName || c.item.name}」固定价 ${priceNum} 🪙` });
    _broadcastGlobal({ type: 'consign' });
  });

  // 购买：按固定价直接购买（买家付款 → 卖家收款 → 买家收货）
  socket.on('consign.buy', ({ id }) => {
    if (!socket.character) return;
    const ch = socket.character;
    const idx = _market.consignments.findIndex(c => c.id === id && c.status === 'active');
    if (idx < 0) { socket.emit('consignResult', { ok: false, msg: '该寄售不存在或已售出' }); return; }
    const c = _market.consignments[idx];
    if (c.seller === ch.uid) { socket.emit('consignResult', { ok: false, msg: '不能购买自己的寄售' }); return; }
    if ((ch.mysteryPoint || 0) < c.price) { socket.emit('consignResult', { ok: false, msg: '寂静点数不足' }); return; }
    // 买家付款 + 收货
    ch.mysteryPoint -= c.price;
    giveItemToChar(ch, JSON.parse(JSON.stringify(c.item)));
    storage.saveCharacter(ch);
    // 卖家收款
    const seller = findCharByUid(c.seller);
    if (seller) {
      seller.mysteryPoint = (seller.mysteryPoint || 0) + c.price;
      storage.saveCharacter(seller);
    }
    c.status = 'closed';
    _market.consignments.splice(idx, 1);
    saveMarket();
    socket.emit('consignResult', { ok: true, msg: `已购买「${c.item.itemName || c.item.name}」，花费 ${c.price} 🪙` });
    _broadcastGlobal({ type: 'auctionSold', msg: `📦 寄售成交：「${c.item.itemName || c.item.name}」由 ${ch.name || '调查员'} 以 ${c.price} 🪙 购得` });
  });

  // 卖家撤回寄售
  socket.on('consign.cancel', ({ id }) => {
    if (!socket.character) return;
    const ch = socket.character;
    const idx = _market.consignments.findIndex(c => c.id === id && c.status === 'active' && c.seller === ch.uid);
    if (idx < 0) { socket.emit('consignResult', { ok: false, msg: '无权撤回或寄售不存在' }); return; }
    const c = _market.consignments[idx];
    _market.consignments.splice(idx, 1);
    giveItemToChar(ch, JSON.parse(JSON.stringify(c.item)));
    storage.saveCharacter(ch);
    saveMarket();
    socket.emit('consignResult', { ok: true, msg: '已撤回寄售，物品退回背包' });
    _broadcastGlobal({ type: 'consign' });
  });
}

// ==================== 导出 ====================
module.exports = {
  registerTrade,
  // 供测试/工具脚本：直接读取市场快照
  _getMarket: () => _market,
  AUCTION_DURATION
};
