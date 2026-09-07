/**
 * gameHandler.js — 副本 / 结算 / 聊天 / 投票域（T-5 拆分产物）
 * 6 事件：startCopy / dungeonAction / completeCopy / applySettlementPoints / teamChat / teamVote
 * 域内私有 helper：_buildPrivateDetail / _getAdjacentCars（仅 dungeonAction 使用）。
 */

const storage = require('./storage');
const logger = require('./logger');
const gameLogic = require('./gamelogic');
const qingfengTrain = require('./qingfengTrain');
const dungeonOutlines = require('./dungeonOutlines');
// ★ 通用副本框架（config/dungeons/*.json 数据驱动 + 专属引擎钩子）
const DF = require('./dungeonFramework');
const { matchSceneImage } = require('./room');
const playerHandler = require('./playerHandler');
// ★ 统一移动执行（地图点击 dungeonAction 与 输入指令 playerAction 共用）
const BC = require('./battleCore');
// ★ 物品框架（ItemEngine）副本生命周期
const { getItemEngine } = require('./itemEngine/ItemEngine');
const itemEngine = getItemEngine();
// ★ 事件驱动系统（改进①：副本/线索/物品事件发布）
const eventBus = require('./eventBus');
const EVENTS = require('./eventTypes');
// ★ 副本刷新持久化（改进：磁盘落盘 / 断线恢复）
const roomPersistence = require('./roomPersistence');

/** 由副本名/currentDungeonId 解析物品清单 dungeonId（未配置返回 null） */
function resolveItemDungeonId(copyName, currentDungeonId) {
  if (!copyName) return null;
  if (copyName.includes('青峰山') || currentDungeonId === 'qingfengshan' || currentDungeonId === 'qingfeng_train_800') {
    return 'qingfengshan';
  }
  return null;
}

// ==================== KP 单人频道详细判定构建 ====================

/**
 * 为公开行动构建单人频道详细判定消息
 * 包含：【判定】数值、【结果】影响、【建议】后续方向
 */
function _buildPrivateDetail(action, result, playerAttr, state) {
  const lines = [];

  switch (action) {
    case 'move_car': {
      const carNames = {
        car_1_cab: '1号·驾驶室', car_2_economy: '2号·二等座', car_2_power: '2号·配电间',
        car_3_luggage: '3号·行李厢', car_4_dining: '4号·餐车', car_5_sleeper: '5号·卧铺',
        car_5_diningroom: '5号·餐车餐室', car_6_mail: '6号·货物厢', car_7_service: '7号·乘务设备厢',
        car_7_power: '7号·配电间', car_8_cabin: '8号·尾厢'
      };
      const carLabel = carNames[result.moved] || result.moved;

      lines.push(`【行动】移动到${carLabel}`);
      lines.push(`【结果】已进入${carLabel}，回合 ${result.turn}`);

      // 毒雾判定
      if (result.poisonDmg > 0) {
        const conVal = playerAttr.con || 40;
        lines.push(`【判定】CON ${conVal} / 毒雾抵抗 → 失败，承受 ${result.poisonDmg} 点毒雾伤害`);
        lines.push(`【建议】匍匐前进可降低伤害，或尽快离开尾车厢区域`);
      } else if (result.moved === 'car_8_cabin') {
        const conVal = playerAttr.con || 40;
        lines.push(`【判定】CON ${conVal} / 毒雾抵抗 → 成功，暂时抵御毒雾`);
      }

      // 陈慧同行提示
      if (result.chenHuiWithParty) {
        lines.push(`【状态】陈慧与你同行`);
      }

      // 建议后续行动
      const adjacentCars = _getAdjacentCars(result.moved);
      if (adjacentCars.length > 0) {
        lines.push(`【建议】可前往相邻车厢：${adjacentCars.join('、')}`);
      }
      break;
    }

    case 'collect_clue': {
      lines.push(`【行动】收集线索`);
      if (result.clueName) {
        lines.push(`【结果】获得线索：「${result.clueName}」`);
      }
      if (result.checkAttr) {
        const attrVal = playerAttr[result.checkAttr] || 40;
        lines.push(`【判定】${result.checkAttr.toUpperCase()} ${attrVal} / ${result.difficulty || 50} → ${result.checkPassed ? '成功' : '失败'}`);
      }
      if (result.hint) {
        lines.push(`【建议】${result.hint}`);
      }
      break;
    }

    case 'use_light': {
      lines.push(`【行动】使用光源`);
      lines.push(`【结果】队伍光源数量：${result.lightSources}/5`);
      if (result.lightSources <= 1) {
        lines.push(`【建议】光源不足将影响探索，建议优先寻找备用光源`);
      }
      break;
    }

    default:
      return null; // 未知公开行动，不推送单人详情
  }

  return lines.join('\n');
}

/**
 * 获取相邻车厢名称列表
 */
function _getAdjacentCars(currentCar) {
  const carOrder = ['car_1_cab','car_2_economy','car_3_luggage','car_4_dining','car_5_sleeper','car_6_mail','car_7_service','car_8_cabin'];
  const carNames = {
    car_1_cab: '1号·驾驶室', car_2_economy: '2号·二等座', car_3_luggage: '3号·行李厢',
    car_4_dining: '4号·餐车', car_5_sleeper: '5号·卧铺', car_6_mail: '6号·货物厢',
    car_7_service: '7号·乘务设备厢', car_8_cabin: '8号·尾厢'
  };
  const idx = carOrder.indexOf(currentCar);
  const adjacent = [];
  if (idx > 0) adjacent.push(carNames[carOrder[idx - 1]]);
  if (idx < carOrder.length - 1) adjacent.push(carNames[carOrder[idx + 1]]);
  return adjacent;
}

// 副本/结算/聊天/投票域（6 事件）
function registerGame(socket, io, state) {
  const { hallRooms, playerHallMap, gameRooms, getPublicRoomSummaries,
          enqueueDeepSeek, getPlayerListForKp,
          buildDungeonContext, buildQingfengKnowledgeContext, recordSceneSnapshot } = state;

  // ★ P1 全员异化自动结算：订阅 battleHandler 广播的检查事件（防重复订阅，跨模块共享 eventBus）
  if (!global.__cocAllAlienatedBound) {
    global.__cocAllAlienatedBound = true;
    eventBus.on('ALL_ALIENATED_CHECK', ({ gameRoomId }) => {
      setImmediate(() => {
        const room = state.gameRooms.get(gameRoomId);
        if (room) checkAllAlienated(room);
      });
    });
  }

  // ========== 启动副本 ==========
  // ★ 每次进入副本，将全队 HP/SAN 刷新至满值（无论任何账号/历史状态）
  const refreshPlayerVitals = (player) => {
    if (!player || !player.attr) return player;
    const a = player.attr;
    if (a.maxHp) a.hp = a.maxHp;
    if (a.maxSan) a.san = a.maxSan;
    return player;
  };

  socket.on('startCopy', ({ copyName }) => {
    const hallRoomId = playerHallMap.get(socket.id);
    if (!hallRoomId) { socket.emit('error', { msg: '请先进入组队房间' }); return; }
    const hallRoom = hallRooms.get(hallRoomId);
    if (!hallRoom) { socket.emit('error', { msg: '房间不存在' }); return; }
    if (hallRoom.hostId !== socket.id) { socket.emit('error', { msg: '只有房主可以启动副本' }); return; }
    // ★ 服务端副本名称空值防护 (D2)
    if (!copyName) { socket.emit('error', { msg: '未选择副本，请先选择副本后再启动' }); return; }
    // ★ 允许单人启动副本
    if (hallRoom.players.size < 1) {
      socket.emit('error', { msg: '房间内无成员，无法启动副本。' });
      return;
    }

    const gameRoomId = 'game_' + hallRoomId;

    // ★ 通用副本框架：config/dungeons/ 有匹配配置 → 数据驱动创建；专属剧情走 config.engine（如 qingfengTrain）
    const dungeonCfg = DF.resolveDungeon(copyName);
    if (dungeonCfg) {
      const engine = DF.loadEngine(dungeonCfg); // 专属引擎（qingfengTrain）可为 null（纯数据副本）
      const dungeonState = DF.createDungeonState(dungeonCfg);
      dungeonState.sceneSwitchEnable = dungeonCfg.sceneSwitchEnable !== false;
      const gameRoom = {
        id: gameRoomId,
        players: new Map(),
        turn: 1,   // ★ 通用回合机制：每轮玩家行动 +1
        copyState: { name: copyName, scores: { clue: 0, survival: 0, sanity: 0, contribution: 0 } },
        history: [],
        dungeonState,
        dungeonConfig: dungeonCfg,   // ★ 供 playerAction 框架化读取
        engine,                        // ★ 专属引擎引用（可为 null）
        copyName,
        currentDungeonId: dungeonCfg.id,
        worldTag: dungeonCfg.worldTag || '',
        era: dungeonCfg.era || 0,
        exclusiveMap: dungeonCfg.exclusiveMap || null,
        chenhuiPortrait: dungeonCfg.chenhuiPortrait || null
      };

      for (const [sid, player] of hallRoom.players) {
        refreshPlayerVitals(player);
        player.carId = player.carId || 'car_4_dining';   // ★ 单人独立车厢：每人初始4号餐车
        const s = io.sockets.sockets.get(sid);
        if (s) { s.leave(hallRoomId); s.join(gameRoomId); playerHallMap.delete(sid); gameRoom.players.set(sid, player); }
      }
      gameRooms.set(gameRoomId, gameRoom);
      hallRooms.delete(hallRoomId);
      io.emit('roomList', { rooms: getPublicRoomSummaries() });

      // ★ 物品框架：副本开启 → 动态注册副本物品清单（QFS-*）
      const itemDungeonId = resolveItemDungeonId(copyName, dungeonCfg.id);
      if (itemDungeonId) {
        gameRoom.itemDungeonId = itemDungeonId;
        const n = itemEngine.loadDungeon(itemDungeonId);
        logger.user.info('副本物品注册', { roomId: gameRoomId, dungeon: itemDungeonId, count: n });
      }

      // ★ 改进①：副本开启事件 + 持久化落盘（刷新/重启后可恢复）
      eventBus.emit(EVENTS.COPY_START, { actor: gameRoomId, value: 1, data: { copyName, dungeonId: dungeonCfg.id } });
      roomPersistence.saveRoom(gameRoom);

      io.to(gameRoomId).emit('copyStart', {
        copyName,
        sceneSwitchEnable: dungeonState.sceneSwitchEnable !== false,
        dungeonId: dungeonCfg.id,
        worldTag: gameRoom.worldTag,
        era: gameRoom.era,
        dungeonState: {
          phase: dungeonState.phase,
          currentCar: dungeonState.currentCar,
          turn: dungeonState.turn,
          truthTier: dungeonState.truthTier,
          cluesFound: dungeonState.cluesFound
        },
        exclusiveMap: gameRoom.exclusiveMap,
        chenhuiPortrait: gameRoom.chenhuiPortrait
      });

      // ★ 入场广播：专属引擎提供（青峰山：米·戈伪造广播 + PER判定）；纯数据副本可跳过（由首次行动 AI 开场）
      const hostPlayer = gameRoom.players.get(socket.id);
      const playerAttr = hostPlayer?.attr || {};
      const isSolo = gameRoom.players.size <= 1;
      if (engine && typeof engine.processEntryBroadcast === 'function') {
        const broadcastMsgs = engine.processEntryBroadcast(dungeonState, playerAttr, isSolo);
        io.to(gameRoomId).emit('dungeonBroadcast', { messages: broadcastMsgs });
      }
      io.to(gameRoomId).emit('dungeonStateUpdate', {
        phase: dungeonState.phase,
        turn: dungeonState.turn,
        currentCar: dungeonState.currentCar,
        cluesFound: dungeonState.cluesFound,
        truthTier: dungeonState.truthTier,
        chenHui: dungeonState.chenHui,
        miGoDeceived: dungeonState.miGoDeceived
      });
      // ★ 进入副本即同步全队玩家数据（含 hp/san + 五维属性），供前端队友信息框渲染
      io.to(gameRoomId).emit('roomUpdate', { players: Array.from(gameRoom.players.values()) });

      // ★ 初始装备包：专属引擎提供（青峰山：公文包 + 对讲机 + 乘务组交接便签）
      if (engine && typeof engine.getStarterKit === 'function') {
        engine.getStarterKit().forEach(kit => {
          for (const [sid2] of gameRoom.players) {
            const s2 = io.sockets.sockets.get(sid2);
            if (!s2 || !s2.character) continue;
            const has = (s2.character.inventory || []).find(i => i.itemId === kit.itemId);
            if (has) {
              if (has.type !== kit.type) {
                has.type = kit.type;
                storage.saveCharacter(s2.character);
                s2.emit('inventoryData', { items: s2.character.inventory || [], warehouse: s2.character.warehouse || [] });
              }
            } else {
              playerHandler.grantPlotItem(s2.character, { ...kit, belongDungeon: dungeonCfg.id });
              storage.saveCharacter(s2.character);
              s2.emit('inventoryData', { items: s2.character.inventory || [], warehouse: s2.character.warehouse || [] });
            }
          }
        });
      }
      return;
    }

    // 通用副本流程
    const dungeonConfig = gameLogic.COPIES[copyName] || {};
    const gameRoom = {
      id: gameRoomId,
      players: new Map(),
      turn: 1,   // ★ 通用回合机制：每轮玩家行动 +1
      copyState: { name: copyName, scores: { clue: 0, survival: 0, sanity: 0, contribution: 0 } },
      history: [],
      copyName,
      currentDungeonId: copyName,
      worldTag: dungeonConfig.worldTag || '',
      era: dungeonConfig.era || 0
    };

    for (const [sid, player] of hallRoom.players) {
      refreshPlayerVitals(player);
      const s = io.sockets.sockets.get(sid);
      if (s) { s.leave(hallRoomId); s.join(gameRoomId); playerHallMap.delete(sid); gameRoom.players.set(sid, player); }
    }
    gameRooms.set(gameRoomId, gameRoom);
    hallRooms.delete(hallRoomId);
    io.emit('roomList', { rooms: getPublicRoomSummaries() });

    // ★ 改进①：副本开启事件 + 持久化落盘（刷新/重启后可恢复）
    eventBus.emit(EVENTS.COPY_START, { actor: gameRoomId, value: 1, data: { copyName } });
    roomPersistence.saveRoom(gameRoom);

    io.to(gameRoomId).emit('copyStart', {
      copyName,
      currentDungeonId: copyName,
      worldTag: gameRoom.worldTag,
      era: gameRoom.era
    });
    // ★ 进入副本即同步全队玩家数据（含 hp/san + 五维属性），供前端队友信息框渲染
    io.to(gameRoomId).emit('roomUpdate', { players: Array.from(gameRoom.players.values()) });

    const dungeonOutline = dungeonOutlines.getOutline(copyName);
    const hostPlayer = gameRoom.players.get(socket.id);
    const hostName = hostPlayer?.name || '调查员';
    enqueueDeepSeek(gameRoomId, {
      playerAction: `小队进入了副本【${copyName}】。请作为KP描述他们眼前出现的场景，营造克苏鲁恐怖氛围。`,
      roomHistory: [],
      dungeonOutline
    }, result => {
      gameRoom.history.push({ role: 'assistant', content: result.story });
      const scene = matchSceneImage(result.tags);
      recordSceneSnapshot(gameRoom, { img: scene.imgUrl, story: result.story, tags: scene.tags, sceneDesc: scene.sceneDesc });
      io.to(gameRoomId).emit('aiReply', {
        from: 'KP',
        story: result.story,
        img: scene.imgUrl,
        tags: scene.tags,
        sceneDesc: scene.sceneDesc
      });
    }, err => {
      logger.error.error('副本开场白失败', { error: err.message });
    });
  });

  // ========== 断线/刷新后恢复副本对局 ==========
  socket.on('resumeGame', ({ characterUid }) => {
    if (!characterUid) { socket.emit('resumeGameResult', { resumed: false }); return; }
    const character = storage.loadCharacter(characterUid);
    if (!character) { socket.emit('resumeGameResult', { resumed: false }); return; }
    // ★ 归属校验：仅角色拥有者可恢复对局（防劫持他人副本）
    if (character.ownerUid && character.ownerUid !== socket.uid) {
      socket.emit('resumeGameResult', { resumed: false });
      return;
    }
    let targetRoom = null, targetRoomId = null, oldPlayer = null;
    for (const [id, room] of gameRooms) {
      for (const [sid, p] of room.players) {
        if (p.uid === characterUid) { targetRoom = room; targetRoomId = id; oldPlayer = p; break; }
      }
      if (targetRoom) break;
    }
    if (!targetRoom || !targetRoomId || !oldPlayer) {
      // ★ 副本刷新持久化：内存无房间 → 尝试从磁盘还原（服务器重启 / 超时清理后刷新）
      const diskRoom = roomPersistence.findRoomByUid(characterUid);
      if (diskRoom) {
        // 还原的玩家均为 offline，由本 socket 认领其槽位；其余成员待各自 resumeGame 认领
        targetRoom = diskRoom;
        targetRoomId = diskRoom.id;
        oldPlayer = Array.from(diskRoom.players.values()).find(p => p && p.uid === characterUid) || null;
        gameRooms.set(targetRoomId, targetRoom);
        logger.user.info('副本从磁盘还原', { characterUid, roomId: targetRoomId, copyName: targetRoom.copyName });
      }
      if (!targetRoom || !targetRoomId || !oldPlayer) {
        socket.emit('resumeGameResult', { resumed: false });
        return;
      }
    }

    // 恢复 socket 角色
    socket.characterUid = characterUid;
    socket.character = character;

    // 用新 socketId 替换旧玩家槽（保留副本内 hp/san 等实时状态）
    let oldSid = null;
    for (const [sid, p] of targetRoom.players) {
      if (p.uid === characterUid) { oldSid = sid; targetRoom.players.delete(sid); }
    }
    const mergedPlayer = { ...oldPlayer, socketId: socket.id, offline: false, lastSeen: Date.now() };
    targetRoom.players.set(socket.id, mergedPlayer);
    socket.join(targetRoomId);
    targetRoom.lastActivity = Date.now();
    // ★ 战斗状态持久化：断线/刷新后 socket 重连 → 重映射战斗单位 sid（旧 socketId → 新 socketId）
    if (oldSid && oldSid !== socket.id) {
      try { require('./battleEngine').battleRemapSid(targetRoomId, oldSid, socket.id); } catch (e) { /* ignore */ }
    }
    // ★ 战斗恢复：resume 后重发 battleStart（客户端据此显示战斗 HUD）+ 驱动战斗循环
    //   （激活当前行动者 / 补跑怪物回合，经 BATTLE_TURN 事件统一广播 battleTurn）
    try {
      const battleEngineRef = require('./battleEngine');
      const bst = battleEngineRef.battleStatus(targetRoomId);
      if (bst && bst.started && !bst.over) {
        socket.emit('battleStart', { status: bst });   // ★ 恢复战斗 HUD / 血条 / 资源条
        const BC = require('./battleCore');
        BC.driveBattle(targetRoom, io, targetRoomId, targetRoom.dungeonState);
      }
    } catch (e) { /* ignore */ }

    // 同步全队
    io.to(targetRoomId).emit('roomUpdate', { players: Array.from(targetRoom.players.values()) });

    // 角色实时状态以房间内为准（hp/san 等）
    if (mergedPlayer.attr) character.attr = { ...character.attr, ...mergedPlayer.attr };

    // 沿用 copyStart 负载结构，触发前端各监听器还原（地图/背景/坐标系）
    const resumePayload = {
      copyName: targetRoom.copyName || targetRoom.currentDungeonId || '未知副本',
      sceneSwitchEnable: targetRoom.dungeonState ? true : (targetRoom.sceneSwitchEnable !== false),
      dungeonId: targetRoom.currentDungeonId,
      worldTag: targetRoom.worldTag || '',
      era: targetRoom.era || 0,
      dungeonState: targetRoom.dungeonState || null,
      exclusiveMap: targetRoom.exclusiveMap || null,
      chenhuiPortrait: targetRoom.chenhuiPortrait || null,
      lastScene: targetRoom.lastScene || null,
      turn: targetRoom.turn || 1   // ★ 恢复时同步通用回合号
    };
    socket.emit('copyStart', resumePayload);
    socket.emit('resumePlayer', {
      character,
      players: Array.from(targetRoom.players.values())
    });
    // ★ 改进：副本恢复事件 + 落盘（更新玩家槽位 socketId，供再次刷新恢复）
    eventBus.emit(EVENTS.ROOM_RESUMED, { actor: targetRoomId, data: { uid: characterUid } });
    roomPersistence.saveRoom(targetRoom);
    logger.user.info('副本对局已恢复', { characterUid, roomId: targetRoomId, copyName: resumePayload.copyName });
  });

  // ========== 青峰山虚空列车·副本动作处理 ==========
  socket.on('dungeonAction', ({ action, payload }) => {
    let gameRoomId = null;
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) { gameRoomId = id; break; }
    }
    if (!gameRoomId) return socket.emit('error', { msg: '未在游戏房间中' });
    const gameRoom = gameRooms.get(gameRoomId);
    if (!gameRoom || !gameRoom.dungeonState) return socket.emit('error', { msg: '副本状态异常' });

    const state = gameRoom.dungeonState;
    const player = gameRoom.players.get(socket.id);
    if (!player) return socket.emit('error', { msg: '玩家不存在' });
    const playerAttr = player.attr || socket.character?.attr || {};

    let result = null;
    switch (action) {
      // ---- 移动（统一 executePlayerMove：邻接校验 + 空间/回合 + 毒雾 + 自动战斗触发） ----
      case 'move_car': {
        const targetCar = payload?.carId;
        if (!targetCar) { result = { error: '未指定目标空间' }; break; }
        const mv = BC.executePlayerMove(gameRoom, io, gameRoomId, state, socket, player, targetCar, { isCrawling: !!payload?.isCrawling });
        if (!mv.ok) { result = { error: mv.error }; break; }
        result = {
          moved: mv.moved,
          turn: mv.turn,
          poisonDmg: mv.poisonDmg,
          chenHuiWithParty: mv.chenHuiWithParty,
          carState: mv.carState,
          combat: mv.combat,
          enemies: mv.enemies
        };
        // ★ 移动后广播全队玩家空间位置（含 carId），供前端各玩家独立显示（dungeonActionResult 由 switch 后统一广播）
        io.to(gameRoomId).emit('roomUpdate', { players: Array.from(gameRoom.players.values()) });
        break;
      }

      // ---- 线索收集 ----
      case 'collect_clue': {
        const clueId = payload?.clueId;
        if (!clueId) { result = { error: '未指定线索ID' }; break; }
        result = qingfengTrain.collectClue(state, clueId, playerAttr);
        if (result.success) {
          state.turn++;
          // ★ 改进①：线索发现事件（供真名解锁联动/记录系统订阅）
          eventBus.emit(EVENTS.CLUE_FOUND, { actor: gameRoomId, data: { clueId, finder: socket.character?.name || socket.characterUid } });
          // ★ 5号车条件触发战斗：阅读卧铺日记（L4/L5）惊动柏油状黑色形体 → 置位后下一次行动进入战斗
          if ((clueId === 'L4' || clueId === 'L5') && (player.carId || state.currentCar) === 'car_5_sleeper') {
            const cs5 = state.carStates.car_5_sleeper;
            if (!cs5.formlessTriggered && !cs5.clearedSpawn) {
              cs5.formlessTriggered = true;
              io.to(gameRoomId).emit('dungeonActionResult', {
                action: 'car5_awaken', payload: { carId: 'car_5_sleeper' }, target: 'public', actorSocketId: socket.id,
                result: { msg: '当你放下日记的一瞬间，整个卧铺车厢的帘子同时落了下来。床铺底下传来粘稠的蠕动声——有什么东西醒了。' }
              });
            }
          }
          // ★ 线索物品方案：收集成功 → 发放剧情物证到收集者背包（剧情分区），供背包查看
          // 去重：玩家背包已有该线索物证则不重复发放
          const clueItem = qingfengTrain.getClueItem(clueId);
          if (clueItem && socket.character) {
            const inv = socket.character.inventory || [];
            const dup = inv.find(i => i.itemId === clueItem.itemId);
            if (!dup) {
              const it = playerHandler.grantPlotItem(socket.character, { ...clueItem, belongDungeon: 'qingfeng_train_800' });
              if (it) {
                storage.saveCharacter(socket.character);
                socket.emit('inventoryData', { items: socket.character.inventory || [], warehouse: socket.character.warehouse || [] });
                result.clueItem = { itemId: it.itemId, itemName: it.itemName, icon: it.icon };
                // ★ 改进①：线索物证获得事件
                eventBus.emit(EVENTS.ITEM_GAINED, { actor: socket.character.uid, data: { items: [{ itemId: it.itemId, itemName: it.itemName, stack: 1 }], dungeonId: 'qingfeng_train_800', clue: clueId } });
              }
            } else {
              result.clueItem = { itemId: dup.itemId, itemName: dup.itemName, icon: dup.icon };
            }
            // ★ P1 素材档案库：线索自动收录（古籍/异象/NPC证词 + 怪物图鉴识破）
            let archChanged = false;
            const arc = qingfengTrain.getArchiveForClue(clueId);
            if (arc) {
              const added = gameLogic.addArchiveEntry(socket.character, arc.category, {
                id: 'clue_' + clueId, title: arc.title, content: arc.content || result.msg, source: '线索·' + clueId
              });
              if (added) archChanged = true;
            }
            const mons = qingfengTrain.getMonsterArchivesForClue(clueId);
            for (const m of mons) {
              if (gameLogic.addArchiveEntry(socket.character, 'monsters', { id: 'mon_' + m.key, title: m.title, content: m.content, source: '线索识破' })) archChanged = true;
            }
            if (archChanged) storage.saveCharacter(socket.character);
          }
        }
        break;
      }

      // ---- 陈慧交互 ----
      case 'chenhui_interact': {
        const subAction = payload?.subAction;
        result = qingfengTrain.interactWithChenHui(state, playerAttr, subAction);
        if (result.success) { state.turn++; }
        break;
      }

      // ---- 米·戈信息判定 ----
      case 'evaluate_info': {
        const infoType = payload?.infoType;
        result = qingfengTrain.evaluateMiGoInfo(state, playerAttr, infoType);
        break;
      }

      // ---- 无形之子战斗 ----
      case 'fight_spawn': {
        const count = payload?.count || 1;
        result = qingfengTrain.fightFormlessSpawn(state, playerAttr, count);
        state.turn++;
        // ★ 战斗结束：全部击退 → 清除该空间怪物 + 退出战斗状态（前端恢复遇怪图）
        if (result && result.remainingCount === 0 && player.carId) {
          if (!state.carStates[player.carId]) state.carStates[player.carId] = {};
          state.carStates[player.carId].clearedSpawn = true;
          if (state.activeCombat) state.activeCombat = null;
          result.cleared = true;
        }
        break;
      }

      // ---- 修格斯遭遇 ----
      case 'shoggoth_encounter': {
        result = qingfengTrain.shoggothEncounter(state, playerAttr);
        state.activeCombat = { space: player.carId || 'car_8_cabin', enemies: [{ type: 'shoggoth', count: 1 }], turnInCombat: 1 };
        state.turn++;
        break;
      }
      case 'shoggoth_defeat': {
        state.shoggothDefeated = true;
        state.shoggothTurn = 0;
        if (state.activeCombat) state.activeCombat = null;
        result = { success: true, msg: '修格斯被成功驱退！', cleared: true };
        state.turn++;
        break;
      }

      // ---- 逃生 ----
      case 'open_gateway': {
        result = qingfengTrain.openEscapeGateway(state, playerAttr);
        state.turn++;
        break;
      }
      case 'crawl_escape': {
        state.escapeComplete = true;
        const ending = qingfengTrain.calculateEnding(state);
        state.ending = ending;
        qingfengTrain.setChenHuiAlive(state.chenHui.alive);
        const rewards = qingfengTrain.getEndingRewards(ending.grade);
        result = { escaped: true, ending, rewards };
        state.phase = 'escaped';

        // 为每个玩家计算并发送结算数据
        gameRoom.players.forEach((player, sid) => {
          const character = storage.loadCharacter(player.uid);
          if (!character) return;
          character.exp += rewards.exp;
          character.mysteryPoint += rewards.mysteryPoint;
          if (!character.clearedCopies) character.clearedCopies = [];
          const copyName = gameRoom.copyState?.name || '废都纪元800｜青峰山虚空列车';
          if (!character.clearedCopies.includes(copyName)) character.clearedCopies.push(copyName);
          gameLogic.checkLevelUp(character);
          storage.saveCharacter(character);

          const settlementData = {
            grade: ending.grade,
            totalScore: ending.totalScore || 0,
            expGained: rewards.exp,
            currentLevel: character.level,
            expToNext: character.level * 100 - character.exp,
            freeAttributePoints: 5,
            currentAttr: character.attr,
            rewards: { mysteryPoint: rewards.mysteryPoint },
            newItems: [],
            endingNarrative: ending.narrative || '',
            trait: rewards.trait || null,
            easterEgg: rewards.easterEgg || null,
            // ★ P3 副本回顾：一局探索时间线（线索/真相/对讲机/回合/陈慧）
            review: qingfengTrain.buildReview(state)
          };
          const targetSocket = io.sockets.sockets.get(sid);
          if (targetSocket) targetSocket.emit('copySettlement', settlementData);
        });

        io.to(gameRoomId).emit('publicMsg', {
          msg: `副本结束！评级：${ending.grade}，${ending.description || ''}`,
          sender: '系统'
        });
        break;
      }

      // ---- 掩护陈慧 ----
      case 'cover_chenhui': {
        const dmg = payload?.damage || 0;
        const coverCost = qingfengTrain.coverChenHui(state, dmg);
        result = { coverCost, chenHuiHp: state.chenHui.hp };
        break;
      }

      // ---- 使用光源 ----
      case 'use_light': {
        state.lightSources = Math.min(state.lightSources + 1, 5);
        result = { lightSources: state.lightSources, msg: `队伍光源数量：${state.lightSources}/5` };
        break;
      }

      default:
        result = { error: `未知副本动作：${action}` };
    }

    // === 消息路由：区分公开播报 / 单人回应 ===
    const isPublicAction = ['move_car', 'collect_clue', 'use_light'].includes(action);
    const isPrivateAction = ['chenhui_interact', 'fight_spawn', 'shoggoth_encounter',
      'shoggoth_defeat', 'evaluate_info', 'cover_chenhui'].includes(action);

    // 1) 副本动作结果（含 target 标识，供客户端分流渲染）
    io.to(gameRoomId).emit('dungeonActionResult', {
      action, payload, result,
      target: isPrivateAction ? 'private' : 'public',
      actorSocketId: socket.id
    });

    // 2) 全局状态同步（全队可见）
    io.to(gameRoomId).emit('dungeonStateUpdate', {
      phase: state.phase,
      turn: state.turn,
      currentCar: state.currentCar,
      cluesFound: state.cluesFound,
      truthTier: state.truthTier,
      chenHui: state.chenHui,
      miGoDeceived: state.miGoDeceived,
      shoggothTriggered: state.shoggothTriggered,
      shoggothDefeated: state.shoggothDefeated,
      escapeStarted: state.escapeStarted,
      lightSources: state.lightSources,
      ending: state.ending,
      // ★ 任务系统：随副本状态推送任务进度
      tasks: (qingfengTrain.getTasks ? qingfengTrain.getTasks(state) : [])
    });

    // 3) 叙述性消息按频道分流
    if (result && !result.error) {
      if (isPublicAction && result.msg) {
        // 公开行动 → KP 全局播报频道（故事化叙述）
        io.to(gameRoomId).emit('publicMsg', { msg: result.msg, sender: 'KP' });

        // ★ 公开行动同时向单人频道推送详细判定（数值+影响+建议）
        const privateDetail = _buildPrivateDetail(action, result, playerAttr, state);
        if (privateDetail) {
          socket.emit('privateMsg', {
            msg: privateDetail,
            sender: 'KP'
          });
        }
      } else if (isPrivateAction && result.msg) {
        // 私人行动 → 仅当前玩家可见
        const senderName = action === 'chenhui_interact' ? '陈慧' : 'KP';
        const avatarUrl = action === 'chenhui_interact'
          ? 'assets/qingfeng_scenes/废都青峰山7号车配电间.png' : null;
        socket.emit('privateMsg', {
          msg: result.msg,
          sender: senderName,
          avatar: avatarUrl
        });
        // 陈慧多段对话也逐条推送
        if (result.chenHuiDialogue && Array.isArray(result.chenHuiDialogue)) {
          result.chenHuiDialogue.forEach(line => {
            socket.emit('privateMsg', {
              msg: line,
              sender: '陈慧',
              avatar: 'assets/qingfeng_scenes/废都青峰山7号车配电间.png'
            });
          });
        }
      }

      // 战斗/毒雾等个人结算 → 私密频道
      if (result.playerHpLoss || result.poisonDmg) {
        const dmg = result.playerHpLoss || result.poisonDmg || 0;
        if (dmg > 0) {
          socket.emit('privateMsg', {
            msg: `你受到了 ${dmg} 点伤害。`,
            sender: 'KP'
          });
        }
      }

      // 逃生结算 → 仅当前玩家
      if (result.escaped && result.ending) {
        socket.emit('privateMsg', {
          msg: `结局：${result.ending.grade} — ${result.ending.description || ''}`,
          sender: 'KP'
        });
      }
    }
    // ★ P1 全员异化：行动后全队 SAN≤0 → 自动结算
    checkAllAlienated(gameRoom);
  });

  // ========== 完成副本 ==========
  // ★ 结算主体（供 completeCopy 与全员异化自动结算共用）
  function settleCopy(gameRoomId, opts = {}) {
    const abandoned = !!opts.abandoned;
    const alienated = !!opts.alienated;
    const gameRoom = gameRooms.get(gameRoomId);
    if (!gameRoom || !gameRoom.copyState) return;
    let result = gameLogic.calculateScore(gameRoom.copyState);
    // ★ P1 全局结算惩罚（文档模块4）：中途主动放弃 → 评价降档 + 寂静点数仅 10% + 不记录通关
    if (abandoned) {
      const gOrder = ['S', 'A', 'B', 'C', 'D'];
      const idx = gOrder.indexOf(result.grade);
      if (idx >= 0 && idx < gOrder.length - 1) result.grade = gOrder[idx + 1];  // 降一档
      result.reward.mysteryPoint = Math.round((result.reward.mysteryPoint || 0) * 0.1);
      result.reward.exp = 0;
      result.skillPoints = 0;
    }
    const copyName = gameRoom.copyState.name;
    // ★ 改进①：副本结束事件（供结算/成就/记录系统订阅）
    eventBus.emit(EVENTS.COPY_END, { actor: gameRoomId, value: result.total, data: { copyName, grade: result.grade, totalScore: result.total, abandoned } });
    const playerUpdates = [];
    gameRoom.players.forEach((player, sid) => {
      const character = storage.loadCharacter(player.uid);
      if (!character) return;
      character.exp += result.reward.exp;
      character.mysteryPoint += result.reward.mysteryPoint;
      // ★ 技能精点发放（新职业技能树角色）
      if (typeof character.skillPoints === 'number') {
        character.skillPoints += result.skillPoints || 0;
      }
      // ★ P0 SAN 规则（文档模块5）：副本内异化(SAN≤0) → 永久 SAN 上限降低 + 本轮奖励不发；
      //    临时 SAN 损耗副本结束自动恢复至当前 maxSan。
      const curSan = character.attr ? (character.attr.san ?? character.attr.maxSan) : null;
      let permLossThisRun = 0;
      if (curSan !== null && curSan <= 0) {
        gameLogic.applyPermanentSanLoss(character, 5, '异化淘汰');
        permLossThisRun = 5;
        character.exp = Math.max(0, character.exp - result.reward.exp);
        character.mysteryPoint = Math.max(0, character.mysteryPoint - result.reward.mysteryPoint);
        if (typeof character.skillPoints === 'number') {
          character.skillPoints = Math.max(0, (character.skillPoints || 0) - (result.skillPoints || 0));
        }
      } else {
        gameLogic.restoreTemporarySan(character);   // 临时损耗恢复
      }
      // ★ P1 轮回记录：副本名/时间/评价/永久SAN损耗/奖励 快照（标签5 档案记录）
      gameLogic.recordCopyHistory(character, {
        copyName,
        grade: result.grade,
        totalScore: result.total,
        expGained: result.reward.exp,
        mysteryPointGained: result.reward.mysteryPoint,
        skillPointsGained: result.skillPoints || 0,
        permanentSanLoss: permLossThisRun,
        cleared: !abandoned && !alienated
      });
      // ★ 任务系统：结算时把本轮已完成任务写入 taskHistory（去重，跨副本保留）
      if (qingfengTrain.getTasks && gameRoom.dungeonState) {
        const doneTasks = qingfengTrain.getTasks(gameRoom.dungeonState).filter(t => t.status === 'done');
        if (doneTasks.length) {
          character.taskHistory = character.taskHistory || [];
          for (const t of doneTasks) {
            if (!character.taskHistory.some(h => h.id === t.id)) {
              character.taskHistory.push({ id: t.id, title: t.title, type: t.type, time: new Date().toISOString().slice(0, 16) });
            }
          }
        }
      }
      // ★ 完整任务系统：副本结算推进已接受任务进度（完成 → status=done 可提交领奖）
      try {
        const qs = require('./questSystem');
        const qRes = qs.advanceQuests(character, {
          cleared: !abandoned && !alienated,
          copyName,
          grade: result.grade,
          cluesFound: (gameRoom.dungeonState && gameRoom.dungeonState.cluesFound) ? gameRoom.dungeonState.cluesFound.length : 0,
          shoggothDefeated: !!(gameRoom.dungeonState && gameRoom.dungeonState.shoggothDefeated),
          chenHuiRescued: !!(gameRoom.dungeonState && gameRoom.dungeonState.chenHui && gameRoom.dungeonState.chenHui.rescued),
          walkieStage: (gameRoom.dungeonState && gameRoom.dungeonState.walkieStage) || 0
        });
        if (qRes && qRes.changed) storage.saveCharacter(character);
      } catch (e) { logger.error.error('任务进度推进异常', { uid: character.uid, error: e.message }); }
      // ★ P0 黑色可成长装备：通关副本推进成长条件（quest: copy_clear）——中途放弃/异化不推进
      const growthItems = (abandoned || alienated) ? [] : [...(character.inventory || []), ...(character.warehouse || [])].filter(i => itemEngine.isGrowthItem(i));
      if (growthItems.length) {
        let gChanged = false;
        for (const gi of growthItems) {
          const r = itemEngine.trackGrowth(character, gi, { type: 'quest', target: 'copy_clear', count: 1 });
          if (r.changed) gChanged = true;
        }
        if (gChanged) logger.user.info('黑装成长', { uid: character.uid, copy: copyName });
      }
      // 记录通关副本（去重）——中途放弃/异化不计入通关
      if (!abandoned && !alienated) {
        if (!character.clearedCopies) character.clearedCopies = [];
        if (copyName && !character.clearedCopies.includes(copyName)) {
          character.clearedCopies.push(copyName);
        }
      }
      // 计算刻痕等级
      const allBeginnersCleared = gameLogic.BEGINNER_DUNGEONS.every(d => character.clearedCopies.includes(d));
      const allDungeonsCleared = Object.keys(gameLogic.COPIES).every(d => character.clearedCopies.includes(d));
      if (allDungeonsCleared) character.engravingTier = 'darkgold';
      else if (allBeginnersCleared) character.engravingTier = 'orange';
      else character.engravingTier = 'white';
      gameLogic.checkLevelUp(character);
      // ★ 结算点数发放：累积到 attrPoints（与 applyAttrPoints 同一预算池，供结算确认时扣减）
      character.attrPoints = (character.attrPoints || 0) + 5;
      storage.saveCharacter(character);
      const freePoints = 5;
      playerUpdates.push({ uid: character.uid, freePoints, character });
    });

    gameRoom.players.forEach((player, sid) => {
      const update = playerUpdates.find(u => u.uid === player.uid);
      if (!update) return;
      const character = update.character;
      const settlementData = {
        grade: result.grade,
        totalScore: result.total,
        abandoned,
        expGained: result.reward.exp,
        currentLevel: character.level,
        expToNext: character.level * 100 - character.exp,
        freeAttributePoints: update.freePoints,
        currentAttr: character.attr,
        rewards: { mysteryPoint: result.reward.mysteryPoint },
        // ★ 技能精点奖励（结算技能奖励页）
        skillPointsGained: result.skillPoints || 0,
        skillPointsTotal: character.skillPoints || 0,
        skillTreeEnabled: typeof character.skillPoints === 'number',
        newItems: [],
        // ★ P3 副本回顾：一局探索时间线（线索/真相/对讲机/回合/陈慧）
        review: qingfengTrain.buildReview(gameRoom.dungeonState)
      };
      const targetSocket = io.sockets.sockets.get(sid);
      if (targetSocket) targetSocket.emit('copySettlement', settlementData);
    });

    io.to(gameRoomId).emit('publicMsg', {
      msg: `副本结束！评级：${result.grade}，总分 ${result.total}`,
      sender: '系统'
    });

    // ★ 物品框架：副本结束 → 注销副本物品 + 清空角色副本背包（隔离，回归全局池）
    if (gameRoom.itemDungeonId) {
      const n = itemEngine.unloadDungeon(gameRoom.itemDungeonId);
      gameRoom.players.forEach((player, sid) => {
        const character = storage.loadCharacter(player.uid);
        if (!character) return;
        const before = (character.inventory || []).length;
        character.inventory = itemEngine.serializer.filterOutDungeon(character.inventory, gameRoom.itemDungeonId);
        character.warehouse = itemEngine.serializer.filterOutDungeon(character.warehouse, gameRoom.itemDungeonId);
        if (before !== character.inventory.length) storage.saveCharacter(character);
      });
      logger.user.info('副本物品注销', { roomId: gameRoomId, dungeon: gameRoom.itemDungeonId, count: n });
    }
    // ★ 副本刷新持久化：结算完成 → 删除磁盘副本（对局已结束，无需再恢复）
    try { require('./battleEngine').battleReset(gameRoomId); } catch (e) { console.warn('[persist] 战斗状态重置失败', e && e.message); }
    roomPersistence.removeRoom(gameRoomId);
    gameRooms.delete(gameRoomId);
  }

  // ★ P1 全员异化自动结算：全队 SAN≤0 → 强制结束副本（异化惩罚由 settleCopy 内部 san≤0 分支处理）
  function checkAllAlienated(gameRoom) {
    if (!gameRoom || !gameRoom.players || gameRoom._settling) return;
    const players = Array.from(gameRoom.players.values());
    if (!players.length) return;
    const allAlienated = players.every(p => ((p && p.attr) || {}).san <= 0);
    if (!allAlienated) return;
    gameRoom._settling = true;
    const gid = gameRoom.id;
    io.to(gid).emit('publicMsg', { msg: '⚠️ 全队理智归零，全员异化——本轮副本强制结算，奖励不予发放。', sender: '系统' });
    settleCopy(gid, { alienated: true });
  }

  socket.on('completeCopy', ({ abandon } = {}) => {
    let gameRoomId = null;
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) { gameRoomId = id; break; }
    }
    if (!gameRoomId) return socket.emit('error', { msg: '未在游戏房间中' });
    settleCopy(gameRoomId, { abandoned: !!abandon });
  });

  // ========== 结算属性加点确认（★ 预算校验：与 applyAttrPoints 对齐，杜绝无限加点） ==========
  socket.on('applySettlementPoints', ({ allocated }) => {
    const character = socket.character;
    if (!character) return socket.emit('error', { msg: '未加载角色' });
    const pts = character.attrPoints || 0;
    const sum = Object.values(allocated || {}).reduce((a, b) => a + (b || 0), 0);
    if (sum < 0 || sum > pts) return socket.emit('error', { msg: '可分配属性点不足' });
    for (const [attr, value] of Object.entries(allocated || {})) {
      if (value > 0 && character.attr[attr] !== undefined) character.attr[attr] += value;
    }
    character.attrPoints = pts - sum;
    character.attr.maxHp = character.attr.con * 2;
    character.attr.hp = Math.min(character.attr.hp, character.attr.maxHp);
    storage.saveCharacter(character);
    socket.emit('pointsApplied', { attr: character.attr, attrPoints: character.attrPoints });
    logger.user.info('属性加点应用', { uid: character.uid, allocated, remaining: character.attrPoints });
  });


  // ★ 聊天+投票域（2026-08-16 拆分至 ./gameVote）
  require('./gameVote').registerVote(socket, io, state);

}

module.exports = { registerGame };
