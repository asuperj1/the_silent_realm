/**
 * roomPersistence.js — 副本房间磁盘持久化（副本刷新 / 服务器重启恢复）
 *
 * 将 gameRooms 序列化到 data/rooms/<roomId>.json，保存内容：
 *   - dungeonState（副本状态机：车厢/线索/真相层级/陈慧/修格斯…）
 *   - history（KP 对话历史）、lastScene（最近场景快照）、eventLog（事件驱动记录）
 *   - turn / copyState / 副本元数据 / itemDungeonId / 探索回合值（_exploreRound/_kpTurn）
 *   - players（玩家槽位：uid/socketId/carId/offline/attr 实时状态）
 *
 * 时机：
 *   - startCopy 创建房间 → 落盘
 *   - 玩家断线（disconnect）→ 落盘（刷新/重启后仍可 resumeGame）
 *   - 周期性 flushAll → 记录实时同步（history / eventLog / dungeonState）
 *   - 超时清理删除内存前 → 落盘兜底
 *   - resumeGame 内存无房间 → findRoomByUid 从磁盘还原
 *   - completeCopy / 结算 → removeRoom 删除磁盘副本
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const DF = require('./dungeonFramework'); // ★ 恢复时重建副本配置/专属引擎
// ★ 战斗状态持久化：活动中的战斗随房间落盘（服务器重启/刷新后还原）
const battleEngine = require('./battleEngine');

const ROOMS_DIR = path.join(__dirname, '..', 'data', 'rooms');

function sanitizeRoomId(id) {
  return String(id || 'room').replace(/[^A-Za-z0-9_\-]/g, '_');
}

function ensureDir() {
  try { if (!fs.existsSync(ROOMS_DIR)) fs.mkdirSync(ROOMS_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}

function roomFile(roomId) {
  return path.join(ROOMS_DIR, sanitizeRoomId(roomId) + '.json');
}

/** 玩家对象 → 可序列化（剔除函数/循环引用；保留 attr 实时状态） */
function serializePlayer(p) {
  if (!p) return null;
  const out = {};
  for (const k of ['uid', 'socketId', 'name', 'career', 'level', 'carId', 'offline', 'lastSeen']) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  if (p.attr && typeof p.attr === 'object') out.attr = { ...p.attr };
  return out;
}

/**
 * 保存单个游戏房间到磁盘
 * @returns {boolean}
 */
function saveRoom(gameRoom) {
  if (!gameRoom || !gameRoom.id) return false;
  try {
    ensureDir();
    const players = [];
    if (gameRoom.players instanceof Map) {
      for (const [sid, p] of gameRoom.players) players.push(serializePlayer({ ...p, socketId: sid }));
    } else {
      (Array.isArray(gameRoom.players) ? gameRoom.players : []).forEach(p => players.push(serializePlayer(p)));
    }
    const doc = {
      id: gameRoom.id,
      savedAt: Date.now(),
      copyName: gameRoom.copyName || null,
      currentDungeonId: gameRoom.currentDungeonId || null,
      dungeonConfigId: (gameRoom.dungeonConfig && gameRoom.dungeonConfig.id) || null, // ★ 框架副本配置 id（恢复时重建 dungeonConfig/engine）
      worldTag: gameRoom.worldTag || '',
      era: gameRoom.era || 0,
      turn: gameRoom.turn || 1,
      copyState: gameRoom.copyState || null,
      history: Array.isArray(gameRoom.history) ? gameRoom.history.slice(-200) : [],
      lastScene: gameRoom.lastScene || null,
      exclusiveMap: gameRoom.exclusiveMap || null,
      chenhuiPortrait: gameRoom.chenhuiPortrait || null,
      itemDungeonId: gameRoom.itemDungeonId || null,
      sceneSwitchEnable: gameRoom.sceneSwitchEnable,
      dungeonState: gameRoom.dungeonState || null,
      _exploreRound: gameRoom._exploreRound || null,
      _kpTurn: gameRoom._kpTurn || {},
      _pendingLoot: gameRoom._pendingLoot || null,
      eventLog: Array.isArray(gameRoom.eventLog) ? gameRoom.eventLog.slice(-300) : [],
      // ★ 战斗状态：活动中的战斗随房间落盘（战斗结束 battleExport 返回 null 自动清除）
      battle: battleEngine.battleExport(gameRoom.id) || null,
      players
    };
    fs.writeFileSync(roomFile(gameRoom.id), JSON.stringify(doc, null, 2), 'utf8');
    return true;
  } catch (e) {
    logger.error.error('副本房间持久化失败', { roomId: gameRoom.id, error: e.message });
    return false;
  }
}

/**
 * 从磁盘加载房间（players 均标记 offline，等待各成员 resumeGame 认领）
 * @returns {object|null}
 */
function loadRoom(roomId) {
  const file = roomFile(roomId);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const doc = JSON.parse(raw);
    if (!doc || !doc.id) return null;
    const room = {
      id: doc.id,
      players: new Map(),
      turn: doc.turn || 1,
      copyState: doc.copyState || { name: doc.copyName, scores: { clue: 0, survival: 0, sanity: 0, contribution: 0 } },
      history: doc.history || [],
      copyName: doc.copyName,
      currentDungeonId: doc.currentDungeonId,
      // ★ 框架副本：按持久化的配置 id 重建 dungeonConfig 与专属引擎（青峰山恢复后仍可触发怪物/专属剧情）
      dungeonConfig: (doc.dungeonConfigId ? DF.getDungeonConfig(doc.dungeonConfigId) : null),
      engine: (doc.dungeonConfigId ? DF.loadEngine(DF.getDungeonConfig(doc.dungeonConfigId)) : null),
      worldTag: doc.worldTag || '',
      era: doc.era || 0,
      dungeonState: doc.dungeonState || null,
      lastScene: doc.lastScene || null,
      exclusiveMap: doc.exclusiveMap || null,
      chenhuiPortrait: doc.chenhuiPortrait || null,
      itemDungeonId: doc.itemDungeonId || null,
      sceneSwitchEnable: doc.sceneSwitchEnable,
      _exploreRound: doc._exploreRound,
      _kpTurn: doc._kpTurn || {},
      eventLog: doc.eventLog || [],
      _restoredFromDisk: true
    };
    if (doc._pendingLoot) room._pendingLoot = doc._pendingLoot;
    (doc.players || []).forEach(p => {
      if (!p || !p.uid) return;
      room.players.set(p.socketId || p.uid, {
        uid: p.uid, socketId: p.socketId, name: p.name, career: p.career, level: p.level,
        carId: p.carId, offline: true, lastSeen: p.lastSeen || Date.now(), attr: p.attr || null
      });
    });
    // ★ 战斗状态还原：若磁盘存有活动中的战斗，恢复进 battleEngine（sid 由 resumeGame 重映射）
    if (doc.battle) battleEngine.battleRestore(doc.id, doc.battle);
    return room;
  } catch (e) {
    logger.error.error('副本房间磁盘还原失败', { roomId, error: e.message });
    return null;
  }
}

/**
 * 按角色 uid 查找其所在的磁盘房间（resumeGame 内存未命中时使用；服务器重启 / 超时清理后恢复）
 * ★ 若同一角色存在多个房间（历史会话残留），取 savedAt 最新者（避免恢复到陈旧对局）。
 * @returns {object|null} 还原后的房间（已 set 进内存由调用方负责）
 */
function findRoomByUid(uid) {
  if (!uid) return null;
  ensureDir();
  let files = [];
  try { files = fs.readdirSync(ROOMS_DIR).filter(f => f.endsWith('.json')); } catch (e) { return null; }
  let bestId = null, bestT = -1;
  for (const f of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(ROOMS_DIR, f), 'utf8').replace(/^\uFEFF/, ''));
      if (doc && doc.id && Array.isArray(doc.players) && doc.players.some(p => p && p.uid === uid)) {
        const t = doc.savedAt || 0;
        if (t > bestT) { bestT = t; bestId = doc.id; }
      }
    } catch (e) { /* ignore */ }
  }
  return bestId ? loadRoom(bestId) : null;
}

/** 清理过期磁盘房间（保留窗口默认 24h），防止历史会话残留干扰恢复 */
function sweepStale(maxAgeMs = 24 * 60 * 60 * 1000) {
  ensureDir();
  let files = [];
  try { files = fs.readdirSync(ROOMS_DIR).filter(f => f.endsWith('.json')); } catch (e) { return 0; }
  const now = Date.now();
  let removed = 0;
  for (const f of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(ROOMS_DIR, f), 'utf8').replace(/^\uFEFF/, ''));
      if (doc && doc.savedAt && (now - doc.savedAt) > maxAgeMs) {
        fs.unlinkSync(path.join(ROOMS_DIR, f));
        removed++;
      }
    } catch (e) { /* ignore */ }
  }
  return removed;
}

/** 删除磁盘房间（副本结算/主动移除时调用） */
function removeRoom(roomId) {
  const file = roomFile(roomId);
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) { /* ignore */ }
}

/** 全量落盘（周期性 flush 调用） */
function flushAll(gameRooms) {
  if (!gameRooms || typeof gameRooms.forEach !== 'function') return 0;
  let n = 0;
  gameRooms.forEach(room => { if (saveRoom(room)) n++; });
  return n;
}

module.exports = { saveRoom, loadRoom, findRoomByUid, removeRoom, flushAll, sweepStale, ROOMS_DIR };
