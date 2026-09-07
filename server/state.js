/**
 * state.js — 共享状态与跨领域共享辅助（T-5 拆分产物）
 *
 * 唯一事实来源：hallRooms / gameRooms / playerHallMap 3 个模块级 Map（deepseekQueues 由 enqueueDeepSeek 封装）。
 * 各 handler 以 register<Domain>(socket, io, state) 注入本实例，操作同一 Map 实例，行为与拆分前完全一致。
 * 收纳跨域共享 helper：房间生命周期 + DeepSeek 串行化 + KP 交互辅助（game/battle 双域使用）。
 */

const crypto = require('crypto');
const logger = require('./logger');
const deepseek = require('./deepseekClient');
const qingfengKnowledge = require('./qingfengKnowledge');
const qingfengTrain = require('./qingfengTrain');

// ==================== 共享状态（3 个模块级 Map） ====================
const hallRooms = new Map(); // 组队大厅房间 roomId -> { id, hostId, players: Map(socketId->player), isPrivate, roomCode }
const gameRooms = new Map(); // 游戏房间 roomId -> { id, players: Map(socketId->player), copyState, history }
const playerHallMap = new Map(); // 玩家 socket.id -> 所处大厅房间 ID（严格唯一性）

// === P0: DeepSeek 同房间调用串行化队列 ===
// 同一房间的 DeepSeek 调用严格串行，避免并发导致的状态不一致和 API 轰炸
const deepseekQueues = new Map(); // roomId -> Promise chain（仅 enqueueDeepSeek 内部使用）

function enqueueDeepSeek(roomId, context, onSuccess, onError) {
  if (!deepseekQueues.has(roomId)) {
    deepseekQueues.set(roomId, Promise.resolve());
  }
  const chain = deepseekQueues.get(roomId).then(() => {
    return deepseek.callDeepSeek(context).then(onSuccess).catch(onError);
  });
  deepseekQueues.set(roomId, chain.catch(() => {})); // 吸收异常保持队列不中断
}

// === P1: dungeon 状态快照（防止异步回调中读到已被修改的状态） ===
function snapshotState(state) {
  return {
    turn: state.turn,
    currentCar: state.currentCar,
    cluesFound: [...(state.cluesFound || [])],
    truthTier: state.truthTier,
    chenHui: { ...state.chenHui },
    shoggothTriggered: state.shoggothTriggered,
    shoggothDefeated: state.shoggothDefeated,
    carStates: JSON.parse(JSON.stringify(state.carStates || {}))
  };
}

function generateRoomId() {
  return 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function getPublicRoomSummaries() {
  const list = [];
  for (const [id, room] of hallRooms) {
    if (!room.isPrivate) {
      list.push({
        id,
        hostName: room.players.get(room.hostId)?.name || '未知',
        playerCount: room.players.size,
        isPrivate: false,
        copyName: room.copyName || null
      });
    }
  }
  return list;
}

// ==================== KP 交互辅助函数（game/battle 双域共享） ====================

// 子空间 → 所属主车厢（知识库/相邻车厢信息按主车厢定向投喂）
const SPACE_PARENT = {
  car_2_power: 'car_2_economy',
  car_5_diningroom: 'car_5_sleeper',
  car_7_power: 'car_7_service'
};

// ★★★ 克苏鲁未知恐惧：线索 → 怪物真名解锁映射（未解锁前 KP 只能用模糊描述，禁止直呼真名）
const CLUE_MONSTER_LOCK = {
  miGo: ['L3', 'L6', 'L7'],      // 米·戈：列车长尸体触须勒痕(L3) / 广播劫持日志(L6) / 陈慧证言(L7)
  formless: ['L2', 'L7'],        // 无形之子：便签"柏油状东西"(L2) / 陈慧证言(L7)
  shoggoth: ['L8', 'L7']         // 修格斯幼体：工程图(L8) / 陈慧证言(L7)
};
// 怪物真名（解锁后 KP 可直呼）
const MONSTER_KNOWN = { miGo: '米·戈', formless: '无形之子', shoggoth: '修格斯幼体' };
// 怪物模糊描述（未解锁时的不可名状称呼）
const MONSTER_OBSCURE = {
  miGo: '发出人类呜咽声的粉红色湿黏肉块',
  formless: '从阴影中渗出的柏油状黑色形体',
  shoggoth: '盘踞在通道口的巨大黑色粘液团'
};

// 依据已收集线索计算已解锁的怪物真名
function getUnlockedMonsters(state) {
  const found = state.cluesFound || [];
  const unlocked = {};
  for (const key of Object.keys(CLUE_MONSTER_LOCK)) {
    if (CLUE_MONSTER_LOCK[key].some(id => found.includes(id))) unlocked[key] = true;
  }
  return unlocked;
}

// 描述怪物：解锁前用模糊描述，解锁后用真名
function describeMonster(type, unlocked) {
  const key = type === 'shoggoth' ? 'shoggoth' : type === 'formless' ? 'formless' : 'miGo';
  return unlocked[key] ? MONSTER_KNOWN[key] : MONSTER_OBSCURE[key];
}

// 构建青峰山副本实时状态上下文（消除重复代码）
// @param {string} [carId] 当前玩家所在空间（单人独立空间），缺省用 state.currentCar
function buildDungeonContext(state, playerCharacter, carId) {
  const cur = carId || state.currentCar || 'car_4_dining';
  const spaceLabel = qingfengTrain.getSpaceLabel(cur);
  const monsters = qingfengTrain.getSpaceMonsters(cur, state);
  const unlocked = getUnlockedMonsters(state);
  const unlockedNames = Object.keys(unlocked).filter(k => unlocked[k]).map(k => MONSTER_KNOWN[k]);

  const lines = [
    `【副本场景】青峰山虚空列车，当前位于${spaceLabel}。`,
    `【回合】第${state.turn}回合。`,
    `【线索】已收集：${state.cluesFound.length > 0 ? state.cluesFound.join(',') : '无'}。`,
    `【已识别生物】${unlockedNames.length > 0 ? unlockedNames.join('、') : '尚未识别任何怪物的真实身份'}。`,
    `【真相层级】${state.truthTier}/3（${state.truthTier === 0 ? '未解锁' : state.truthTier === 1 ? '碎片真相' : state.truthTier === 2 ? '拼图真相' : '完全真相'}）。`,
    `【陈慧】${state.chenHui.rescued ? '已救出' : '未救出'}，${state.chenHui.withParty ? '同行中' : '未同行'}，HP=${state.chenHui.hp}。`,
    `【${unlocked.shoggoth ? '修格斯幼体' : '通道口巨大生物'}】${state.shoggothTriggered ? (state.shoggothDefeated ? '已击退' : '已触发（危险！）') : '未触发'}。`,
    `【光源数量】${state.lightSources || 1}盏。`,
    // ★ 空间威胁：玩家与怪物同空间 → 已进入战斗（未解锁的真名用模糊描述，营造未知恐惧）
    monsters.length ? `【空间威胁】${spaceLabel}内有${monsters.map(m => describeMonster(m.type, unlocked) + (m.type === 'shoggoth' ? '' : ('×' + m.count))).join('、')}，${playerCharacter ? playerCharacter.name : '玩家'}已进入战斗状态！` : '',
    cur === 'car_8_cabin' ? '【毒雾警告】玩家身处8号车尾毒雾区，私密频道不可用！' : '',
  ];

  // 注入当前玩家个人状态
  if (playerCharacter) {
    lines.push(`【当前玩家】${playerCharacter.name || '未知'}，职业${playerCharacter.career || '调查员'}，HP=${playerCharacter.hp || 0}，SAN=${playerCharacter.san || 0}。`);
  }

  return lines.filter(Boolean).join(' ');
}

// ★ 构建知识库上下文（按车厢定向投喂；子空间归入所属主车厢）
function buildQingfengKnowledgeContext(state, carId) {
  const cur = carId || state.currentCar || 'car_4_dining';
  const parent = SPACE_PARENT[cur] || cur;
  return {
    carKnowledge: qingfengKnowledge.getCarKnowledge(parent),
    adjacentKnowledge: qingfengKnowledge.getAdjacentCarKnowledge(parent),
    npcActive: state.chenHui.rescued || parent === 'car_4_dining'
  };
}

// === P2: 记录最近一次场景快照（供断线/刷新恢复时还原场景图） ===
function recordSceneSnapshot(gameRoom, payload) {
  if (!gameRoom) return;
  if (payload && typeof payload === 'object') {
    gameRoom.lastScene = {
      img: payload.img || null,
      story: payload.story || '',
      tags: payload.tags || [],
      sceneDesc: payload.sceneDesc || ''
    };
  }
}

// 获取房间内所有玩家列表（供 KP 第三人称引用）
function getPlayerListForKp(room, io) {
  const names = [];
  for (const [sid, player] of room.players) {
    const sock = io.sockets.sockets.get(sid);
    const name = sock?.character?.name || player.name || '未知';
    const career = sock?.character?.career || player.career || '调查员';
    const level = sock?.character?.level || player.level || 1;
    names.push(`【${name}】(${career} Lv${level})`);
  }
  return names.join('、');
}

// 将玩家从大厅房间强制移除（断线/被踢/主动离开时调用）
function removePlayerFromHall(socket, io, reason) {
  const hallRoomId = playerHallMap.get(socket.id);
  if (!hallRoomId) return;
  const room = hallRooms.get(hallRoomId);
  if (!room) {
    playerHallMap.delete(socket.id);
    return;
  }

  const wasHost = room.hostId === socket.id;
  if (wasHost) {
    // 解散房间，通知所有成员
    io.to(hallRoomId).emit('roomDissolved');
    for (const [sid] of room.players) {
      const s = io.sockets.sockets.get(sid);
      if (s) {
        s.leave(hallRoomId);
        playerHallMap.delete(sid);
      }
    }
    hallRooms.delete(hallRoomId);
  } else {
    room.players.delete(socket.id);
    socket.leave(hallRoomId);
    playerHallMap.delete(socket.id);
    io.to(hallRoomId).emit('roomPlayersUpdate', {
      players: Array.from(room.players.values()),
      hostId: room.hostId
    });
  }
  io.emit('roomList', { rooms: getPublicRoomSummaries() });
  if (reason) logger.user.info(`玩家离开房间 (${reason})`, { socketId: socket.id, roomId: hallRoomId });
}

module.exports = {
  // 共享状态（Map 引用直出，行为等价硬约束）
  hallRooms,
  gameRooms,
  playerHallMap,
  // ★ 事件驱动系统（2026-08-16）：全局事件管理器 + 回合制定时调度器
  eventBus: require('./eventBus'),
  timerScheduler: require('./timerScheduler'),
  EVENTS: require('./eventTypes'),
  // 状态辅助
  enqueueDeepSeek,
  snapshotState,
  recordSceneSnapshot,
  generateRoomId,
  generateRoomCode,
  getPublicRoomSummaries,
  removePlayerFromHall,
  // KP 交互辅助（跨域）
  buildDungeonContext,
  buildQingfengKnowledgeContext,
  getPlayerListForKp,
  // 克苏鲁未知恐惧：线索 → 怪物真名解锁（KP 叙事 + 战斗系统共用）
  getUnlockedMonsters,
  MONSTER_KNOWN,
  MONSTER_OBSCURE,
  CLUE_MONSTER_LOCK
};
