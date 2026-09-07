/**
 * battleHandler.js — 战斗 / KP 交互域（T-5 拆分产物）
 * 5 事件：playerAction / chooseStatOption / privateAction / useSkill / groupAction
 * 域内私有 helper：isDirectedAtKP（仅 playerAction 使用）。
 */

const storage = require('./storage');
const logger = require('./logger');
const gameLogic = require('./gamelogic');
const statResolver = require('./statResolver');
const actionClassifier = require('./actionClassifier');
const dungeonOutlines = require('./dungeonOutlines');
const qingfengTrain = require('./qingfengTrain');
const actionSystem = require('./actionSystem');
const battleEngine = require('./battleEngine');
const battleStats = require('./battleStats');
const DF = require('./dungeonFramework'); // ★ 通用副本框架（空间/怪物通用化）
const BATTLE_ROLES = require('../config/battle_roles.json');
const SKILL_BATTLE = require('../config/skill_battle.json');
// ★ 克苏鲁未知恐惧：线索→怪物真名解锁（模块级函数 startBattleForRoom/expandMonsters 直接使用）
const { getUnlockedMonsters, MONSTER_OBSCURE } = require('./state');
const PROFESSIONS = require('../config/professions.json');
const { applyCopyScoring, matchSceneImage } = require('./room');

// ★ 探索新回合掷骰广播（2026-08-23）：为新回合为每位在线玩家掷好探索骰(1D6 = 操作次数上限)，
//   随 exploreRound 广播 diceMap → 前端据此播放骰子动画并定格真实面值，实现“结束行动后才重新投掷”。
//   explorePlayerDice 首次调用即掷骰并缓存，与后续 exploreConsume 返回的 dice 一致。
function emitExploreRound(room, io, gameRoomId, reason) {
  const diceMap = {};
  for (const sid of room.players.keys()) {
    try {
      const d = actionSystem.explorePlayerDice(gameRoomId, sid);
      diceMap[sid] = d.dice || 1;
    } catch (e) { diceMap[sid] = 1; }
  }
  io.to(gameRoomId).emit('exploreRound', { round: room._exploreRound, phase: 'new', reason, diceMap });
}


// ★ 拆分（2026-08-16）：纯辅助/战斗驱动已迁至 ./battleCore
const BC = require('./battleCore');
const { careerEnergyDice, lootPartKey, lootActionFor, isLootAction, placeIntoInventory, rollLootToBag, rollBattleLootOptions, isDirectedAtKP, parseMoveTarget, classifyExploreAction, buildPlayerSnapshot, collectBattlePlayers, equipInBattle, useItemInBattle, parseKpTurnCost, applyKpTurnCost, expandMonsters, executePlayerMove, startBattleForRoom, driveBattle, endBattle } = BC;
// ★ 物品框架（改进①：药水临时 buff 衰减 + 事件发布依赖）
const { getItemEngine } = require('./itemEngine/ItemEngine');
const itemEngine = getItemEngine();
// ★ 事件驱动系统（改进②统一回合 / 改进③ battleTurn 统一转发）
const eventBus = require('./eventBus');
const EVENTS = require('./eventTypes');
const turnService = require('./turnService');

// ★ 改进③：battleTurn 事件订阅 → socket 广播（仅注册一次，消除 driveBattle 双路径）
let _turnForwarderBound = false;

// ★ P3 成本控制：用户级 KP 行动节流（同一玩家 6 秒内最多 1 次行动触发 AI，防连点刷屏）
const kpThrottleMap = new Map(); // sid -> lastActionTime
const KP_ACTION_MIN_INTERVAL = 6000;

// 战斗/KP 交互域（5 事件）
function registerBattle(socket, io, state) {
  const { gameRooms, enqueueDeepSeek, getPlayerListForKp,
          buildDungeonContext, buildQingfengKnowledgeContext, recordSceneSnapshot } = state;

  // ★ 改进③：订阅 BATTLE_TURN（引擎已 emit），统一转发 battleTurn 给房间
  if (!_turnForwarderBound) {
    _turnForwarderBound = true;
    eventBus.on(EVENTS.BATTLE_TURN, (ev) => {
      if (!ev.actor || !ev.data) return;
      // ★ 尖塔式：队伍回合广播（全队共享回合，无单一行动者）
      if (ev.data.teamTurn) {
        io.to(ev.actor).emit('battleTurn', { teamTurn: true, status: ev.data.status });
        return;
      }
      if (!ev.data.sid) return;
      const { sid, ap, apDice, intents, status } = ev.data;
      io.to(ev.actor).emit('battleTurn', { for: sid, ap, apDice, intents, status });
    });
  }

  // ★ 回合推进：每轮玩家行动 +1，并广播 turnUpdate（供前端技能 CD 回合刷新 / 回合显示）
  // ★ 同时衰减药水临时 buff（每回合 -1，到期减回属性）
  // ★ 改进②：统一回合入口（tickTurn 驱动 buff/CD/倒计时 + TURN_ADVANCED 事件）
  function advanceTurn(room) {
    if (!room) return 1;
    const turn = turnService.advanceRoomTurn(room);
    if (room.players) {
      Array.from(room.players.keys()).forEach(sid => {
        const s = io.sockets.sockets.get(sid);
        if (s && s.character) {
          const decay = itemEngine.onTurnStart(s.character);
          if (decay && decay.length) {
            storage.saveCharacter(s.character);
            s.emit('characterUpdate', { uid: s.character.uid, attr: { ...s.character.attr } });
          }
        }
        if (s) s.emit('turnUpdate', { turn });
      });
    }
    return turn;
  }

  // ★ 对讲机：联系陈慧（每 2 回合一次 + 首呼无冷却 + 消耗 0.5 回合值 + 电流音 + 信号差 + 自报身份）
  // 供 playerAction 关键词拦截与 walkieCall 点击事件共用
  function doWalkie(room, socket, playerChar) {
    if (!room || !room.dungeonState) return;
    const dstate = room.dungeonState;
    const gameRoomId = room.id;
    const name = playerChar?.name || socket.character?.name || '未知';
    const attr = playerChar?.attr || socket.character?.attr || {};
    const lastTurn = room._walkieLastTurn || 0;
    const cooldownElapsed = room.turn - lastTurn;
    // 冷却：已使用过（无论接通与否）且距上次使用不足 2 回合
    if (lastTurn > 0 && cooldownElapsed < 2) {
      socket.emit('privateMsg', { msg: `「滋——」你按下对讲机，扬声器却只发出短促的电流「啵」声，随即彻底沉默——设备还在冷却（每 2 回合可使用一次，还需 ${2 - cooldownElapsed} 回合）。`, sender: '对讲机' });
      io.to(gameRoomId).emit('publicMsg', { msg: '（对讲机发出一声短促的电流「啵」声，随即沉默）', sender: '系统' });
      return;
    }
    room._walkieLastTurn = room.turn;
    // ★ 对讲机行动消耗 0.5 回合值（KP 判定体系内的固定消耗）
    room._kpTurn = room._kpTurn || {};
    if (room._kpTurn[socket.id] === undefined) room._kpTurn[socket.id] = 0;
    room._kpTurn[socket.id] = Math.round((room._kpTurn[socket.id] + 0.5) * 100) / 100;
    const round = room._exploreRound || 1;
    if (room._kpTurn[socket.id] >= 1.5) {
      // 回合值满 → 强制结束本大回合
      room._kpTurn[socket.id] = 0;
      room._exploreRound = actionSystem.exploreStart(gameRoomId).round;
      emitExploreRound(room, io, gameRoomId, 'cost_full');
      io.to(gameRoomId).emit('exploreUpdate', { sid: socket.id, name, dice: 1, actionCost: 0.5, cost: 0, forcedEnd: true, ended: false, skipped: false, reason: '', used: 1, round: room._exploreRound });
    } else {
      io.to(gameRoomId).emit('exploreUpdate', { sid: socket.id, name, dice: 1, actionCost: 0.5, cost: room._kpTurn[socket.id], forcedEnd: false, ended: false, skipped: false, reason: '', used: 1, round });
    }
    // 对讲机叙事（电流音 + 信号差 + 自报身份）
    const wk = qingfengTrain.walkieTalkie(dstate, attr);
    socket.emit('privateMsg', { msg: wk.msg, sender: '对讲机' });
    io.to(gameRoomId).emit('publicMsg', { msg: '（一阵刺耳的对讲机电流声从车厢里响起：「滋——滋啦——沙沙沙——」）', sender: '系统' });
    // ★ P1 素材档案库：接通后收录陈慧证词（NPC 档案，去重）
    if (wk.success && socket.character) {
      const arc = qingfengTrain.getWalkieArchive(wk.stage, wk.msg);
      gameLogic.addArchiveEntry(socket.character, 'npcQuotes', { id: arc.id, title: arc.title, content: arc.content, source: '对讲机' });
      storage.saveCharacter(socket.character);
    }
  }

  // ★ 对讲机点击呼叫事件（快捷栏 / 线索栏点击对讲机触发）
  socket.on('walkieCall', () => {
    if (!socket.characterUid || !socket.character) {
      socket.emit('error', { msg: '请先选择角色' });
      return;
    }
    let wid = null;
    for (const [id, r] of gameRooms) {
      if (r.players.has(socket.id)) { wid = id; break; }
    }
    const wroom = gameRooms.get(wid);
    if (!wroom) { socket.emit('privateMsg', { msg: '（未在副本中，对讲机没有信号）', sender: '对讲机' }); return; }
    doWalkie(wroom, socket, socket.character);
  });

  // ========== 游戏交互 ==========
  // ★ 消息内容清洗：限长 + 去控制字符（防御滥用与存储型 XSS 前提）
  function sanitizeContent(v) {
    return String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 500);
  }
  socket.on('playerAction', ({ content: rawContent }) => {
    const content = sanitizeContent(rawContent);
    if (!content) { socket.emit('error', { msg: '消息不能为空' }); return; }
    if (!socket.characterUid) {
      socket.emit('error', { msg: '请先选择角色' });
      return;
    }
    let gameRoomId = null;
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) { gameRoomId = id; break; }
    }
    if (!gameRoomId) {
      const name = socket.character?.name || '未知';
      io.to(socket.roomId || socket.id).emit('publicMsg', { msg: content, sender: name });
      socket.emit('error', { msg: '当前不在副本中，消息仅发送给同一大厅成员' });
      return;
    }
    const room = gameRooms.get(gameRoomId);
    if (!room) return;
    const name = socket.character?.name || '未知';
    // ★ P3 成本控制：用户级节流（不推进回合、不调用 KP，防止连点刷屏触发两次 AI）
    const now = Date.now();
    const lastAct = kpThrottleMap.get(socket.id) || 0;
    if (now - lastAct < KP_ACTION_MIN_INTERVAL) {
      socket.emit('error', { msg: '🕰️ KP 正在回应上一条行动，请稍候片刻再行动…' });
      return;
    }
    kpThrottleMap.set(socket.id, now);
    // ★ 回合机制：玩家每发起一次主要行动，房间回合 +1 并广播
    advanceTurn(room);
    // ★ KP 回合值状态（sid → 累计回合值）：由 KP 每次行动后判定【回合值】动态分配
    room._kpTurn = room._kpTurn || {};
    if (room._kpTurn[socket.id] === undefined) room._kpTurn[socket.id] = 0;
    let consume = null; // 探索消耗结果（供 KP 回合值应用回调访问）

    // 副本中动态评分
    if (room.copyState) {
      applyCopyScoring(room.copyState, content);
    }

    // ★ 敏感词/无关命令预检（公共广播前）：命中敏感词时公共频道脱敏广播，避免不当内容传播
    const preReject = actionClassifier.checkRejection(content);
    const broadcastMsg = (preReject && preReject.rejected && preReject.type === 'sensitive')
      ? actionClassifier.maskSensitive(content, preReject.matched)
      : content;
    // 始终将玩家原话广播到公共频道（队友可见）
    io.to(gameRoomId).emit('publicMsg', { msg: broadcastMsg, sender: name });

    // === 判断消息意图：对 KP 个人提问 vs 通用行动描述 ===
    const directedAtKP = isDirectedAtKP(content);
    const dungeonOutline = dungeonOutlines.getOutline(room.currentDungeonId || room.copyState?.name);
    const playerList = getPlayerListForKp(room, io);
    const baseContext = {
      dungeonOutline,
      currentDungeonId: room.currentDungeonId || '',
      worldTag: room.worldTag || '',
      era: room.era || 0
    };

    // === 青峰山虚空列车 ===
    if (room.dungeonState) {
      const state = room.dungeonState;
      const playerChar = socket.character;
      // ★ 单人独立车厢：KP 上下文按当前玩家所在车厢
      const myCar = (room.players.get(socket.id) || {}).carId || state.currentCar || 'car_4_dining';
      const roomId = gameRoomId;

      // ★ 无关命令 / 敏感词 / 元游戏指令拦截（复用公共广播前的预检结果）：不扣回合值、不算行动（不消耗操作次数）、不调用 KP，仅给提示
      const rejection = preReject;
      if (rejection && rejection.rejected) {
        socket.emit('privateMsg', { msg: rejection.reply, sender: '系统' });
        io.to(gameRoomId).emit('publicMsg', { msg: `⚠️ ${name} 的指令未被 KP 回应（${rejection.reason}）`, sender: '系统' });
        logger.user.info('KP指令拦截', { from: socket.id, name, content, type: rejection.type, reason: rejection.reason });
        return;
      }

      // ★★★ 探索回合体系（战斗行为系统1.0）：非战斗时生效（1D6 操作次数 + ★KP判定回合值 + 1.5 强制结束 + 多人同步）
      const battleActive = !!(state.activeCombat && battleEngine.battleStatus(roomId).started);
      if (!battleActive) {
        if (!room._exploreRound) {
          room._exploreRound = actionSystem.exploreStart(roomId).round; // 首次行动初始化大回合
          emitExploreRound(room, io, gameRoomId);   // ★ 首回合也广播（带掷骰），骰子在回合开始即展示
        }
        const moveTargetCheck = parseMoveTarget(content);
        const costType = moveTargetCheck ? 'move' : classifyExploreAction(content);
        consume = actionSystem.exploreConsume(roomId, socket.id, costType);
        // ★ 回合值由 KP 判定：exploreConsume 仅管理操作次数（used/dice）；实际回合值在 KP 响应后按【回合值】应用
        io.to(gameRoomId).emit('exploreUpdate', {
          sid: socket.id, name,
          dice: consume.dice, actionCost: 0,
          cost: room._kpTurn[socket.id] || 0, forcedEnd: false, ended: consume.ended,
          skipped: consume.skipped, reason: consume.reason, used: consume.used,
          round: room._exploreRound
        });
        // 本大回合已结束 / 操作次数用尽 → 阻止继续探索，等待下一回合
        if (consume.skipped) {
          const msg = consume.reason === 'limit'
            ? `🎲 本回合操作次数（${consume.dice} 次）已用完，请点击「结束回合」或等所有玩家行动后进入下一回合。`
            : `⏳ 第 ${room._exploreRound} 回合已结束，等待所有玩家行动后进入下一回合。`;
          socket.emit('privateMsg', { msg, sender: '系统' });
          return;
        }
        // 多人同步：所有玩家结束本大回合 → 进入下一大回合（重新掷骰）
        const activeSids = Array.from(room.players.keys()).filter(sid => room.players.get(sid) && !room.players.get(sid).offline);
        if (actionSystem.exploreAllEnded(roomId, activeSids).allEnded) {
          room._exploreRound = actionSystem.exploreStart(roomId).round;
          emitExploreRound(room, io, gameRoomId);
        }
      }

      // ★ 移动指令 → 统一移动执行（共享 executePlayerMove：邻接校验 + 空间/回合 + 毒雾 + 战斗触发）
      const moveTarget = parseMoveTarget(content);
      if (moveTarget) {
        const player = room.players.get(socket.id);
        if (player) {
          const mv = executePlayerMove(room, io, gameRoomId, state, socket, player, moveTarget);
          if (!mv.ok) {
            socket.emit('error', { msg: mv.error || '无法移动' });
          } else {
            const mresult = { moved: mv.moved, turn: mv.turn, combat: mv.combat, enemies: mv.enemies, poisonDmg: mv.poisonDmg };
            io.to(gameRoomId).emit('dungeonActionResult', { action: 'move_car', payload: { carId: moveTarget }, result: mresult, target: 'public', actorSocketId: socket.id });
            io.to(gameRoomId).emit('roomUpdate', { players: Array.from(room.players.values()) });
          }
        }
      }

      // ★ 条件触发战斗（非移动行动）：当前空间出现未清除怪物且战斗未启动 → 启动战斗
      // 典型：5号车卧铺阅读日记(L4/L5)置 formlessTriggered 后，下一次行动自动进入战斗
      if (!moveTarget) {
        const curCar = (room.players.get(socket.id) || {}).carId || state.currentCar || 'car_4_dining';
        // ★ 框架化：专属引擎怪物触发优先；纯数据副本走通用框架（config.spaces 怪物分布）
        const curEnemies = (room.engine && typeof room.engine.getSpaceMonsters === 'function')
          ? room.engine.getSpaceMonsters(curCar, state)
          : (room.dungeonConfig ? DF.getSpaceMonsters(room.dungeonConfig, curCar, state) : []);
        if (curEnemies.length > 0 && !battleEngine.battleStatus(gameRoomId).started) {
          startBattleForRoom(room, io, gameRoomId, state, curCar, curEnemies);
        }
      }

      // ★ 对讲机支线（青峰山专属引擎钩子）：联系陈慧（每 2 回合一次 + 首呼无冷却 + 消耗 0.5 回合值）
      if (room.engine && typeof room.engine.walkieTalkie === 'function' && /对讲机|呼叫|联系陈慧|7频段|walkie|通话/.test(content)) {
        doWalkie(room, socket, playerChar);
        return;
      }

      const dungeonContext = buildDungeonContext(state, playerChar, myCar);

      // ★ 三级行为分类
      const classification = actionClassifier.classifyAction(content, state);

      // ★ 模块化知识库（按车厢定向投喂）
      const knowledgeCtx = buildQingfengKnowledgeContext(state, myCar);

      if (directedAtKP) {
        // ★ 玩家向 KP 个人提问 → 私密频道回应
        enqueueDeepSeek(gameRoomId, {
          ...baseContext,
          dungeonContext,
          actionTier: classification.tier,
          qingfengCarKnowledge: knowledgeCtx.carKnowledge,
          qingfengAdjacentKnowledge: knowledgeCtx.adjacentKnowledge,
          qingfengNpcActive: knowledgeCtx.npcActive,
          playerAction: `（私密提问·来自公共频道）${name} 私下向你提问：${content}\n【当前小队】${playerList}\n请用第二人称回答，并列出2-3个可选行动方向，每条必须包含鉴定类型、鉴定阈值及成功/失败后果。`,
          roomHistory: room.history.slice(-5)
        }, result => {
          room.history.push({ role: 'user', content: `（私密）${name}: ${content}` });
          room.history.push({ role: 'assistant', content: result.story });
          // ★ KP 回合值：向 KP 提问同样消耗行动并按【回合值】判定
          applyKpTurnCost(room, io, gameRoomId, socket.id, name, result.story, consume);
          socket.emit('privateMsg', { msg: result.story, sender: 'KP' });
        }, err => {
          logger.error.error('KP私密回应失败', { error: err.message });
          socket.emit('privateMsg', { msg: '（虚空列车的通讯暂时中断…）', sender: 'KP' });
        });
      } else {
        // ★ 通用行动 → 公共频道·团队面向·第三人称
        // ★ KP 对话中获得道具：探索/搜索类行动自动掉落进格子化背包（真实落袋）
        rollLootToBag(socket, myCar, content);
        // 层级B/C：注入引导/惩罚提示词
        let tierGuide = '';
        const isTierA = classification.tier === 'A';
        if (classification.tier === 'B') {
          tierGuide = actionClassifier.getTierBGuidePrompt(myCar, name);
        } else if (classification.tier === 'C') {
          tierGuide = actionClassifier.getTierCPenaltyPrompt(classification.penalty?.message || '');
        }

        // ★ 第一次调用：公共频道的叙事内容（含【风险/收益】【可选方向】）
        enqueueDeepSeek(gameRoomId, {
          ...baseContext,
          dungeonContext,
          actionTier: classification.tier,
          tierGuide,
          qingfengCarKnowledge: knowledgeCtx.carKnowledge,
          qingfengAdjacentKnowledge: knowledgeCtx.adjacentKnowledge,
          qingfengNpcActive: knowledgeCtx.npcActive,
          playerAction: `（全局行动·团队面向${isTierA ? '' : '·休闲引导'}）${name}：${content}\n【当前小队成员】${playerList}\n\n以团队视角叙述，用第三人称指代玩家。为每位成员各列1个简短行动选项。\n\n【强制输出格式】每个行动选项后必须严格按以下结构输出，标签独占一行：\n\n【风险/收益】\n（在此写出该行动的风险和潜在收益，必须包含具体数值影响）\n\n【可选方向】\n（在此列出该行动可能的分支走向）`,
          roomHistory: room.history.slice(-10)
        }, result => {
          room.history.push({ role: 'user', content: `${name}: ${content}` });
          room.history.push({ role: 'assistant', content: result.story });
          recordSceneSnapshot(room, { img: null, story: result.story, tags: result.tags || [], sceneDesc: '' });
          // ★ KP 回合值：解析【回合值】应用到探索回合值罗盘
          applyKpTurnCost(room, io, gameRoomId, socket.id, name, result.story, consume);
          io.to(gameRoomId).emit('aiReply', {
            from: 'KP', story: result.story,
            img: null, tags: result.tags || [], sceneDesc: ''
          });
          // ★ 第二次调用：单人细化·纯数值数据表
          enqueueDeepSeek(gameRoomId, {
            ...baseContext,
            temperature: 0.25,    // ★ 表格生成强制低温度防中英混杂
            top_p: 0.5,
            dungeonContext,
            qingfengCarKnowledge: knowledgeCtx.carKnowledge,
            qingfengAdjacentKnowledge: knowledgeCtx.adjacentKnowledge,
            qingfengNpcActive: knowledgeCtx.npcActive,
            playerAction: `（单人细化·数值判定）基于当前游戏状态，为 "${name}" 的 "${content}" 行动的每个可能选项生成纯数据表格。\n\n表格五列：行动名称 | 鉴定要求 | 成功数值变化 | 失败数值变化 | 回合值\n\n严格要求：\n- 只输出Markdown表格，禁止任何叙述文字\n- 表格列头必须使用中文：行动名称 | 鉴定要求 | 成功数值变化 | 失败数值变化 | 回合值\n- 鉴定要求写"属性名 阈值"，如"侦查 50"或"力量 40"\n- 数值变化必须给出具体数字，如"HP-3, SAN+1"或"力量+5, HP-2"\n- 回合值写 0.25~1 之间的 0.25 整数倍，按该行动复杂度/耗时/风险评估（如 0.5）\n- 禁止模糊词汇，必须给出确定数值`,
            roomHistory: []
          }, result2 => {
            // 解析表格为结构化选项
            const parsedOptions = statResolver.parseTable(result2.story);
            const character = socket.character;
            if (parsedOptions && character) {
              // 存储选项供后续选择
              statResolver.storeOptions(socket.id, parsedOptions, character);
              socket.emit('statOptions', {
                options: parsedOptions,
                rawTable: result2.story
              });
            } else {
              // 解析失败时降级为纯文本展示
              socket.emit('privateMsg', { msg: result2.story, sender: 'KP' });
            }
          }, err2 => {
            logger.error.error('青峰山单人细化DeepSeek失败', { error: err2.message });
            socket.emit('privateMsg', { msg: '（KP 正在整理详细判定信息，请稍候…）', sender: 'KP' });
          });
        }, err => {
          logger.error.error('青峰山全局行动DeepSeek失败', { error: err.message });
          io.to(gameRoomId).emit('publicMsg', { msg: '（虚空列车的通讯暂时中断…）', sender: 'KP' });
        });
      }
      return;
    }

    // === 通用副本 ===
    if (directedAtKP) {
      // 对 KP 个人提问 → 私密频道
      enqueueDeepSeek(gameRoomId, {
        ...baseContext,
        playerAction: `（私密提问·来自公共频道）玩家 "${name}" 向你私下提问：${content}\n【当前小队】${playerList}\n请用第二人称回答，并列出2-3个可选行动方向，每条必须包含鉴定类型、鉴定阈值及成功/失败后果。`,
        roomHistory: room.history.slice(-5)
      }, result => {
        room.history.push({ role: 'user', content: `（私密）${name}: ${content}` });
        room.history.push({ role: 'assistant', content: result.story });
        socket.emit('privateMsg', { msg: result.story, sender: 'KP' });
      }, err => {
        logger.error.error('通用副本KP私密回应失败', { error: err.message });
      });
    } else {
      // 通用行动 → 公共频道·团队面向·第三人称
      // ★ 第一次调用：公共频道的叙事内容（含【风险/收益】【可选方向】）
      enqueueDeepSeek(gameRoomId, {
        ...baseContext,
        playerAction: `（全局行动·团队面向）玩家 "${name}" 进行了以下行动：${content}\n【当前小队成员】${playerList}\n\n以团队视角叙述，用第三人称指代玩家。为每位成员各列1个简短行动选项。\n\n【强制输出格式】每个行动选项后必须严格按以下结构输出，标签独占一行：\n\n【风险/收益】\n（在此写出该行动的风险和潜在收益，必须包含具体数值影响）\n\n【可选方向】\n（在此列出该行动可能的分支走向）`,
        roomHistory: room.history.slice(-10)
      }, result => {
        room.history.push({ role: 'user', content: `${name}: ${content}` });
        room.history.push({ role: 'assistant', content: result.story });
        const scene = matchSceneImage(result.tags);
        recordSceneSnapshot(room, { img: scene.imgUrl, story: result.story, tags: scene.tags, sceneDesc: scene.sceneDesc });
        io.to(gameRoomId).emit('aiReply', {
          from: 'KP', story: result.story,
          img: scene.imgUrl, tags: scene.tags, sceneDesc: scene.sceneDesc
        });
        // ★ 第二次调用：单人细化·纯数值数据表
        enqueueDeepSeek(gameRoomId, {
          ...baseContext,
          temperature: 0.25,    // ★ 表格生成强制低温度防中英混杂
          top_p: 0.5,
          playerAction: `（单人细化·数值判定）基于当前游戏状态，为 "${name}" 的 "${content}" 行动的每个可能选项生成纯数据表格。\n\n表格五列：行动名称 | 鉴定要求 | 成功数值变化 | 失败数值变化 | 回合值\n\n严格要求：\n- 只输出Markdown表格，禁止任何叙述文字\n- 表格列头必须使用中文：行动名称 | 鉴定要求 | 成功数值变化 | 失败数值变化 | 回合值\n- 鉴定要求写"属性名 阈值"，如"侦查 50"或"力量 40"\n- 数值变化必须给出具体数字，如"HP-3, SAN+1"或"力量+5, HP-2"\n- 回合值写 0.25~1 之间的 0.25 整数倍，按该行动复杂度/耗时/风险评估（如 0.5）\n- 禁止模糊词汇，必须给出确定数值`,
          roomHistory: []
        }, result2 => {
          // 解析表格为结构化选项
          const parsedOptions = statResolver.parseTable(result2.story);
          const character = socket.character;
          if (parsedOptions && character) {
            statResolver.storeOptions(socket.id, parsedOptions, character);
            socket.emit('statOptions', {
              options: parsedOptions,
              rawTable: result2.story
            });
          } else {
            socket.emit('privateMsg', { msg: result2.story, sender: 'KP' });
          }
        }, err2 => {
          logger.error.error('通用副本单人细化DeepSeek失败', { error: err2.message });
          socket.emit('privateMsg', { msg: '（KP 正在整理详细判定信息，请稍候…）', sender: 'KP' });
        });
      }, err => {
        logger.error.error('通用副本全局行动DeepSeek失败', { error: err.message });
      });
    }
  });

  // ========== 探索回合：手动结束本大回合 ==========
  socket.on('exploreEnd', () => {
    if (!socket.characterUid) return;
    let gameRoomId = null;
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) { gameRoomId = id; break; }
    }
    if (!gameRoomId) return;
    const room = gameRooms.get(gameRoomId);
    if (!room || !room.dungeonState) return;
    const name = socket.character?.name || '未知';
    const res = actionSystem.exploreEndPlayer(gameRoomId, socket.id);
    if (!res.ok) { socket.emit('error', { msg: '本回合尚未开始' }); return; }
    // ★ P2 多人等待提示：找出首个未结束的队友，供前端显示"等待 X 结束回合…"
    const activeSids = Array.from(room.players.keys()).filter(sid => room.players.get(sid) && !room.players.get(sid).offline);
    let waitingFor = null;
    for (const sid of activeSids) {
      if (sid === socket.id) continue;
      const p = room.players.get(sid);
      if (p && !actionSystem.explorePlayerDice(gameRoomId, sid).ended) { waitingFor = p.name || '队友'; break; }
    }
    io.to(gameRoomId).emit('exploreUpdate', {
      sid: socket.id, name, ended: true, dice: res.dice, cost: res.cost,
      round: room._exploreRound || 0, waitingFor
    });
    // 多人同步：所有玩家结束 → 下一大回合
    if (actionSystem.exploreAllEnded(gameRoomId, activeSids).allEnded) {
      room._exploreRound = actionSystem.exploreStart(gameRoomId).round;
      emitExploreRound(room, io, gameRoomId);
    }
  });

  // ========== 战利品三选一（战斗胜利后） ==========
  socket.on('chooseLoot', ({ index }) => {
    if (!socket.character) return;
    let gameRoomId = null;
    for (const [id, room] of gameRooms) { if (room.players.has(socket.id)) { gameRoomId = id; break; } }
    const room = gameRoomId ? gameRooms.get(gameRoomId) : null;
    if (!room || !room._pendingLoot) { socket.emit('error', { msg: '无待选战利品' }); return; }
    if (index < 0) { room._pendingLoot = null; socket.emit('lootGranted', { itemId: null, itemName: '已放弃战利品' }); return; }
    const opt = room._pendingLoot.options[index];
    if (!opt) { socket.emit('error', { msg: '无效选择' }); return; }
    const name = socket.character.name || '玩家';
    try { placeIntoInventory(socket.character.inventory || (socket.character.inventory = []), opt); } catch (e) { /* ignore */ }
    try { storage.saveCharacter(socket.character); } catch (e) { console.warn('[persist] 战利品存档失败', e && e.message); }
    room._pendingLoot = null;
    socket.emit('lootGranted', { itemId: opt.itemId, itemName: opt.itemName || opt.name, icon: opt.icon, quality: opt.quality });
    io.to(gameRoomId).emit('publicMsg', { msg: `${name} 选择了战利品「${opt.itemName || opt.name}」`, sender: '战利品' });
  });

  // ========== 战斗：玩家行动（普攻/技能/吃药/换装/撤退/结束） ==========
  socket.on('battleAction', ({ action, skillDmg, skillId, itemUid, slot, target }) => {
    if (!socket.characterUid) return;
    let gameRoomId = null;
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) { gameRoomId = id; break; }
    }
    if (!gameRoomId) return;
    const room = gameRooms.get(gameRoomId);
    if (!room || !room.dungeonState) return;
    const state = room.dungeonState;
    let res;
    if (action === 'attack') {
      res = battleEngine.battlePlayerAct(gameRoomId, socket.id, { action: 'attack', target });
    } else if (action === 'skill') {
      const name = skillId || (typeof skillDmg === 'string' ? skillDmg : '');
      res = battleEngine.battlePlayerAct(gameRoomId, socket.id, { action: 'skill', skillId: name, target });
    } else if (action === 'item') {
      const used = useItemInBattle(socket, itemUid);
      if (!used.ok) { socket.emit('error', { msg: used.msg }); return; }
      res = battleEngine.battlePlayerAct(gameRoomId, socket.id, { action: 'item', apCost: 0, hpDelta: used.hpDelta, sanDelta: used.sanDelta, shield: used.shield, effects: used.effects, msg: used.msg });
    } else if (action === 'resourceSkill') {
      // ★ 特殊资源技能（不耗 AP，消耗特殊资源：招架/炁盾/战吼…）
      res = battleEngine.battlePlayerAct(gameRoomId, socket.id, { action: 'resourceSkill', target });
    } else if (action === 'reload') {
      // ★ 装填（枪手：消耗1AP，回子弹 gainOnReload）
      res = battleEngine.battlePlayerAct(gameRoomId, socket.id, { action: 'reload' });
    } else if (action === 'markWeak') {
      // ★ 标记弱点（侦探：消耗2探知，目标易伤+1）
      res = battleEngine.battlePlayerAct(gameRoomId, socket.id, { action: 'markWeak', target });
    } else if (action === 'flee') {
      res = battleEngine.battlePlayerAct(gameRoomId, socket.id, 'flee');
    } else if (action === 'equip') {
      // ★ 战斗内换装：先换装重算快照 → 引擎扣 AP（换武器 5 / 防具饰品 3）
      if (!socket.character) { socket.emit('error', { msg: '无角色' }); return; }
      const eqOk = equipInBattle(socket, itemUid, slot);
      if (!eqOk.ok) { socket.emit('error', { msg: eqOk.msg }); return; }
      const snap = buildPlayerSnapshot(socket.character, null, socket.id);
      battleEngine.battleUpdatePlayer(gameRoomId, socket.id, snap);
      const realSlot = eqOk.slot || slot || '';
      res = battleEngine.battlePlayerAct(gameRoomId, socket.id, { action: 'equip', slot: realSlot, cost: realSlot === 'weapon' ? 5 : 3 });
    } else {
      res = battleEngine.battlePlayerAct(gameRoomId, socket.id, 'end');
    }
    // ★ 操作失败（能量不足/冷却中/已行动/未轮到…）：仅反馈操作者本人，不广播全局日志、不推进回合
    if (!res.ok) {
      socket.emit('battleError', { msg: res.msg || '行动失败' });
      return;
    }
    io.to(gameRoomId).emit('battleEvent', { sid: socket.id, ...res, status: res.status });
    if (res.over) {
      const winLabel = (res.win === true || res.win === 'players') ? 'players' : (res.win === 'monsters' ? 'monsters' : 'fled');
      endBattle(room, io, gameRoomId, state, winLabel, state?.activeCombat?.space);
      // ★ P1 全员异化：战斗结束后检查全队 SAN≤0 → 自动结算（gameHandler 订阅处理）
      eventBus.emit('ALL_ALIENATED_CHECK', { gameRoomId });
      return;
    }
    // 结束行动轮 / 撤退 / 能量不足推进 → 下一行动者
    if (res.end || res.flee || (res.ok && !res.over && res.energy < 2)) {
      driveBattle(room, io, gameRoomId, state);
    }
    // 否则（能量仍够）等待玩家继续本行动轮
  });

  // ========== 催促队友行动（战斗快捷栏按钮） ==========
  // ★ 尖塔式：全队共享回合 → 自己"行动过后"才能催促尚未行动的队友
  socket.on('battleUrge', () => {
    if (!socket.characterUid) return;
    let gameRoomId = null;
    for (const [id, room] of gameRooms) { if (room.players.has(socket.id)) { gameRoomId = id; break; } }
    if (!gameRoomId) return;
    const room = gameRooms.get(gameRoomId);
    if (!room || !room.dungeonState) return;
    const st = battleEngine.battleStatus(gameRoomId);
    if (!st || !st.started || st.over) { socket.emit('error', { msg: '当前不在战斗中' }); return; }
    if (st.phase !== 'player') { socket.emit('error', { msg: '当前是怪物回合，无需催促' }); return; }
    // 自己需已结束行动，才能催促队友
    const me = (st.units || []).find(u => u.sid === socket.id);
    if (!me || !me.acted) { socket.emit('error', { msg: '你还没行动，先结束行动再催促队友' }); return; }
    // 找第一个未行动、未死亡、未离线的队友
    const target = (st.units || []).find(u => u.sid !== socket.id && !u.dead && !u.acted && !u.offline);
    if (!target) { socket.emit('error', { msg: '所有队友都已行动，无需催促' }); return; }
    // ★ 冷却：每 3 秒一次，防刷屏
    const now = Date.now();
    if (room._urgeCooldown && (now - room._urgeCooldown) < 3000) return;
    room._urgeCooldown = now;
    const myName = socket.character?.name || '某玩家';
    const targetName = target.name || '队友';
    // 给目标队友私密提示
    const targetSock = io.sockets.sockets.get(target.sid);
    if (targetSock) targetSock.emit('privateMsg', { msg: `📣 ${myName} 正催促你尽快行动！`, sender: '队友' });
    // 全房间广播
    io.to(gameRoomId).emit('publicMsg', { msg: `📣 ${myName} 催促 ${targetName} 尽快行动`, sender: '战斗' });
    logger.user.info('催促队友行动', { from: socket.id, to: target.sid, roomId: gameRoomId });
  });

  // ========== P0: 选项数值选择 ==========
  socket.on('chooseStatOption', ({ optionIndex }) => {
    if (!socket.characterUid || !socket.character) {
      socket.emit('error', { msg: '请先选择角色' });
      return;
    }
    const character = socket.character;
    // ★ 读取待选选项（含 KP 判定的回合值 cost），供执行后应用
    const pendingOpts = statResolver.getOptions(socket.id);
    const opt = (pendingOpts && pendingOpts[optionIndex]) || null;
    const { success, result } = statResolver.applyChoice(character, optionIndex, socket.id);

    if (!success) {
      socket.emit('privateMsg', { msg: `（${result.error}）`, sender: 'KP' });
      return;
    }

    // 持久化角色数据
    storage.saveCharacter(character);

    // ★ 应用选项回合值：KP 已在单人表格中判定该行动的回合消耗
    if (opt && opt.cost) {
      let kpRoomId = null;
      for (const [id, r] of gameRooms) { if (r.players.has(socket.id)) { kpRoomId = id; break; } }
      const kpRoom = gameRooms.get(kpRoomId);
      if (kpRoom) {
        kpRoom._kpTurn = kpRoom._kpTurn || {};
        if (kpRoom._kpTurn[socket.id] === undefined) kpRoom._kpTurn[socket.id] = 0;
        kpRoom._kpTurn[socket.id] = Math.round((kpRoom._kpTurn[socket.id] + opt.cost) * 100) / 100;
        if (kpRoom._kpTurn[socket.id] >= 1.5) {
          kpRoom._kpTurn[socket.id] = 0;
          kpRoom._exploreRound = actionSystem.exploreStart(kpRoomId).round;
          emitExploreRound(kpRoom, io, kpRoomId, 'cost_full');
        }
        io.to(kpRoomId).emit('exploreUpdate', {
          sid: socket.id, name: character.name,
          dice: 1, actionCost: opt.cost, cost: kpRoom._kpTurn[socket.id], forcedEnd: false,
          ended: false, skipped: false, reason: '', used: 1, round: kpRoom._exploreRound || 1
        });
      }
    }

    // 通知前端更新属性面板
    socket.emit('characterUpdate', {
      uid: character.uid,
      attr: { ...character.attr },
      hp: character.hp || character.attr?.hp,
      san: character.san || character.attr?.san
    });

    // 私密频道反馈判定结果
    const checkResult = result.checkPassed ? '✅ 成功' : '❌ 失败';
    const detailLines = [
      `【选项】${result.optionName}`,
      `【判定】${result.checkAttr} ${result.threshold}（你的属性值：${result.playerAttrValue ?? '-'}）→ ${checkResult}`,
    ];
    if (result.appliedChanges.length > 0) {
      const changes = result.appliedChanges.map(c => {
        const sign = c.change >= 0 ? '+' : '';
        return `${c.attr} ${sign}${c.change}`;
      }).join('，');
      detailLines.push(`【数值变化】${changes}`);
    } else {
      detailLines.push(`【数值变化】无变化`);
    }
    if (opt && opt.cost) detailLines.push(`【回合值】-${opt.cost}`);
    detailLines.push(`【当前状态】HP ${result.newHp}/${character.attr.maxHp}，SAN ${result.newSan}/${character.attr.maxSan}`);

    socket.emit('privateMsg', {
      msg: detailLines.join('\n\n'),
      sender: 'KP'
    });
  });

  socket.on('privateAction', ({ content }) => {
    if (!socket.characterUid) {
      socket.emit('error', { msg: '请先选择角色' });
      return;
    }
    // 回显玩家原话到私密频道
    socket.emit('privateMsg', { msg: content, sender: '你' });

    let gameRoomId = null;
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) { gameRoomId = id; break; }
    }
    if (!gameRoomId) {
      socket.emit('privateMsg', { msg: '（未在副本中，KP 暂不可用）', sender: 'KP' });
      return;
    }
    const room = gameRooms.get(gameRoomId);
    if (!room) return;
    const name = socket.character?.name || '未知';
    const dungeonOutline = dungeonOutlines.getOutline(room.currentDungeonId || room.copyState?.name);
    const playerList = getPlayerListForKp(room, io);

    // 青峰山副本：仅8号车厢毒雾区私密频道受干扰
    if (room.dungeonState) {
      const state = room.dungeonState;
      // ★ 单人独立车厢：按当前玩家所在车厢判断
      const myCar = (room.players.get(socket.id) || {}).carId || state.currentCar || 'car_4_dining';
      if (myCar === 'car_8_cabin') {
        socket.emit('privateMsg', { msg: '（虚空列车信息干扰严重，私密频道不可用）', sender: 'KP' });
        return;
      }
      // 其他车厢：私密频道正常
      const playerChar = socket.character;
      const dungeonContext = buildDungeonContext(state, playerChar, myCar);
      const classification = actionClassifier.classifyAction(content, state);
      const knowledgeCtx = buildQingfengKnowledgeContext(state, myCar);

      // ★ 增强 prompt：要求 KP 明确给出判定数值、可选方向及后果
      enqueueDeepSeek(gameRoomId, {
        playerAction: `（私密频道·单人）${name} 悄悄进行了以下行动：${content}\n【当前小队】${playerList}\n【当前车厢】${myCar}\n【玩家属性】STR ${playerChar?.attr?.str || '?'} DEX ${playerChar?.attr?.dex || '?'} CON ${playerChar?.attr?.con || '?'} INT ${playerChar?.attr?.int ?? playerChar?.attr?.per ?? '?'} CHA ${playerChar?.attr?.cha ?? '?'} LCK ${playerChar?.attr?.lck ?? '?'} WIL ${playerChar?.attr?.wil ?? '?'}\n请用第二人称"你"对${name}一人叙述结果。格式要求：\n1. 先描述行动发生的场景和即时结果（1-2句）\n2. 在回复末尾（scene_tag 之前）输出一行【回合值】X（0.25~1 之间 0.25 的整数倍，按本次行动复杂度/耗时/风险判定）\n3. 【判定】给出涉及的属性鉴定类型和具体阈值（如 INT 鉴定 60）\n4. 【结果】说明成功/失败的后果和造成的影响\n5. 【建议】列出2-3个后续可选行动，每条格式：▸ 行动名称（回合值 X）—— 鉴定类型 阈值（成功→后果；失败→后果）`,
        roomHistory: room.history.slice(-5),
        dungeonOutline,
        currentDungeonId: room.currentDungeonId || '',
        worldTag: room.worldTag || '',
        era: room.era || 0,
        dungeonContext,
        actionTier: classification.tier,
        qingfengCarKnowledge: knowledgeCtx.carKnowledge,
        qingfengAdjacentKnowledge: knowledgeCtx.adjacentKnowledge,
        qingfengNpcActive: knowledgeCtx.npcActive
      }, result => {
        room.history.push({ role: 'user', content: `（私密）${name}: ${content}` });
        room.history.push({ role: 'assistant', content: result.story });
        // ★ KP 回合值：私密行动同样由 KP 判定【回合值】并累计（不占公共操作次数）
        applyKpTurnCost(room, io, gameRoomId, socket.id, name, result.story, null);
        socket.emit('privateMsg', { msg: result.story, sender: 'KP' });
      }, err => {
        logger.error.error('青峰山私人行动DeepSeek失败', { error: err.message });
        socket.emit('privateMsg', { msg: '（虚空列车的通讯暂时中断…）', sender: 'KP' });
      });
      return;
    }

    // 通用副本：私密行动
    enqueueDeepSeek(gameRoomId, {
      playerAction: `（私密频道·单人）玩家 "${name}" 悄悄进行了以下行动：${content}\n【当前小队】${playerList}\n请用第二人称"你"对${name}一人叙述结果。格式要求：\n1. 先描述行动发生的场景和即时结果（1-2句）\n2. 【判定】给出涉及的属性鉴定类型和具体阈值\n3. 【结果】说明成功/失败的后果和影响\n4. 【建议】列出2-3个后续可选行动方向`,
      roomHistory: room.history.slice(-5),
      dungeonOutline,
      currentDungeonId: room.currentDungeonId || '',
      worldTag: room.worldTag || '',
      era: room.era || 0
    }, result => {
      room.history.push({ role: 'user', content: `（私密）${name}: ${content}` });
      room.history.push({ role: 'assistant', content: result.story });
      socket.emit('privateMsg', { msg: result.story, sender: 'KP' });
    }, err => {
      logger.error.error('通用副本私人行动DeepSeek失败', { error: err.message });
    });
  });

  socket.on('useSkill', ({ skillName }) => {
    if (!socket.character) return;
    const character = socket.character;
    // 出战技能判定：旧职业用 skills，新职业技能树角色用 equippedSkills
    const isOwned = (character.skills || []).includes(skillName) || (character.equippedSkills || []).includes(skillName);
    if (!isOwned) {
      socket.emit('error', { msg: '无此技能' }); return;
    }
    // 先定位房间（回合判定需要当前回合号）
    let gameRoomId = null;
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) { gameRoomId = id; break; }
    }
    const room = gameRoomId ? gameRooms.get(gameRoomId) : null;
    const currentTurn = room ? (room.turn || 1) : 1;
    // ★ 回合制技能 CD：释放当回合不计 CD，下一回合开始倒计时
    const cdTurns = gameLogic.getSkillCooldownTurns(character.career, skillName);
    const used = character.skillCooldowns && character.skillCooldowns[skillName];
    if (used && typeof used.turn === 'number') {
      const remain = cdTurns - (currentTurn - used.turn);
      if (remain > 0) {
        socket.emit('error', { msg: `技能冷却中（剩余 ${remain} 回合）` }); return;
      }
    }
    // SAN 消耗
    if (character.attr.san < 5) {
      socket.emit('error', { msg: 'SAN不足，无法释放技能' }); return;
    }
    character.attr.san -= 5;
    if (!character.skillCooldowns) character.skillCooldowns = {};
    character.skillCooldowns[skillName] = { turn: currentTurn, cd: cdTurns };

    // 属性极值惩罚
    const imbalance = gameLogic.checkAttrImbalance(character.attr);
    if (imbalance) { character.attr.san -= 2; }

    storage.saveCharacter(character);

    if (!gameRoomId) {
      socket.emit('error', { msg: '当前不在副本中' });
      return;
    }
    // ★ 技能释放推进回合
    if (room) advanceTurn(room);
    const name = character.name;
    io.to(gameRoomId).emit('publicMsg', { msg: `${name} 使用了技能【${skillName}】`, sender: '战斗' });

    // 同步队伍成员状态
    io.to(gameRoomId).emit('roomPlayersUpdate', {
      players: Array.from(room.players.values()),
      hostId: null
    });

    const playerList = getPlayerListForKp(room, io);

    // ★ 构建知识库上下文（若在青峰山副本中）
    const skillCtx = {};
    if (room.dungeonState) {
      const knowledgeCtx = buildQingfengKnowledgeContext(room.dungeonState);
      skillCtx.qingfengCarKnowledge = knowledgeCtx.carKnowledge;
      skillCtx.qingfengAdjacentKnowledge = knowledgeCtx.adjacentKnowledge;
      skillCtx.qingfengNpcActive = knowledgeCtx.npcActive;
      skillCtx.dungeonContext = buildDungeonContext(room.dungeonState, character);
      skillCtx.actionTier = 'A'; // 技能使用始终为主线行为
    }

    enqueueDeepSeek(gameRoomId, {
      ...skillCtx,
      playerAction: `（全局行动·团队面向）玩家 "${name}" 释放了技能【${skillName}】。\n【当前小队成员】${playerList}\n请以团队视角用第三人称描述技能效果，为每位成员列出可选行动。`,
      roomHistory: room.history.slice(-5)
    }, result => {
      room.history.push({ role: 'assistant', content: result.story });
      const scene = matchSceneImage(result.tags);
      recordSceneSnapshot(room, { img: scene.imgUrl, story: result.story, tags: scene.tags, sceneDesc: scene.sceneDesc });
      io.to(gameRoomId).emit('aiReply', {
        from: 'KP', story: result.story,
        img: scene.imgUrl, tags: scene.tags, sceneDesc: scene.sceneDesc
      });
    }, err => {
      logger.error.error('技能DeepSeek调用失败', { error: err.message });
    });
  });

  // ========== 集体行动（DeepSeek 响应） ==========
  socket.on('groupAction', ({ action, description }) => {
    let gameRoomId = null;
    for (const [id, room] of gameRooms) {
      if (room.players.has(socket.id)) {
        gameRoomId = id;
        break;
      }
    }
    if (!gameRoomId) {
      socket.emit('error', { msg: '未加入游戏房间' });
      return;
    }
    const room = gameRooms.get(gameRoomId);
    if (!room) return;
    const name = socket.character?.name || '未知';
    const fullAction = description ? `${action} —— ${description}` : action;
    io.to(gameRoomId).emit('publicMsg', { msg: `集体行动：${fullAction}`, sender: name });

    const playerList = getPlayerListForKp(room, io);

    // ★ 构建知识库上下文（若在青峰山副本中）
    const groupCtx = {};
    if (room.dungeonState) {
      const knowledgeCtx = buildQingfengKnowledgeContext(room.dungeonState);
      groupCtx.qingfengCarKnowledge = knowledgeCtx.carKnowledge;
      groupCtx.qingfengAdjacentKnowledge = knowledgeCtx.adjacentKnowledge;
      groupCtx.qingfengNpcActive = knowledgeCtx.npcActive;
      groupCtx.dungeonContext = buildDungeonContext(room.dungeonState, socket.character);
      groupCtx.actionTier = 'A';
    }

    enqueueDeepSeek(gameRoomId, {
      ...groupCtx,
      playerAction: `（全局行动·团队面向）小队发起了集体行动：${fullAction}\n【当前小队成员】${playerList}\n请以团队视角用第三人称叙述，为每位成员列出后续可选行动。`,
      roomHistory: room.history.slice(-10)
    }, result => {
      room.history.push({ role: 'assistant', content: result.story });
      recordSceneSnapshot(room, { img: null, story: result.story, tags: result.tags || [] });
      io.to(gameRoomId).emit('aiReply', { from: 'KP', story: result.story, img: null, tags: result.tags || [] });
    }, err => {
      logger.error.error('集体行动DeepSeek调用失败', { error: err.message });
    });
  });
}

module.exports = { registerBattle };
