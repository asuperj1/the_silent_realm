/**
 * eventRecorder.js — 事件驱动订阅者（评估改进① 落地示例 + 副本"记录"数据源）
 *
 * 职责：订阅核心业务事件，把结构化事件追加到所属游戏房间的 eventLog（上限 300 条），
 * 随 roomPersistence 落盘；副本刷新/恢复时可一并还原（供前端"副本日志"还原历史记录）。
 *
 * 设计意图：业务系统只需 emit 事件，记录与展示完全解耦——新增事件无需改业务调用链。
 * 本模块不修改任何业务状态，只读地消费事件（观察者模式）。
 */
const state = require('./state');
const { eventBus, EVENTS, gameRooms } = state;

// ★ 需要记录的业务事件清单（可按需增删，无需改动业务系统）
const WATCHED = [
  EVENTS.BATTLE_START, EVENTS.BATTLE_TURN, EVENTS.BATTLE_DAMAGE, EVENTS.BATTLE_HEAL,
  EVENTS.BATTLE_DEATH, EVENTS.BATTLE_END,
  EVENTS.PLAYER_HP_CHANGED, EVENTS.PLAYER_SAN_CHANGED,
  EVENTS.ITEM_GAINED, EVENTS.ITEM_USED, EVENTS.ITEM_EQUIPPED, EVENTS.LOOT_ROLLED,
  EVENTS.ROOM_JOINED, EVENTS.ROOM_LEFT,
  EVENTS.COPY_START, EVENTS.COPY_END, EVENTS.CLUE_FOUND,
  EVENTS.MONSTER_SPAWNED, EVENTS.MONSTER_DEFEATED,
  EVENTS.TURN_ADVANCED, EVENTS.SKILL_CD_READY
];

let _started = false;

/** 幂等启动：注册全部订阅（仅一次，避免每连接重复注册） */
function ensureStarted() {
  if (_started) return;
  _started = true;
  WATCHED.forEach(type => {
    eventBus.on(type, (ev) => {
      try {
        // actor 通常是房间 id（事件结构体约定）；部分事件把 roomId 放 data 中
        const roomId = (ev.actor && gameRooms.has(ev.actor)) ? ev.actor : (ev.data && ev.data.roomId);
        if (!roomId || !gameRooms.has(roomId)) return;
        const room = gameRooms.get(roomId);
        if (!room.eventLog) room.eventLog = [];
        room.eventLog.push({
          t: Date.now(),
          type: ev.type,
          actor: typeof ev.actor === 'string' ? ev.actor.slice(0, 32) : ev.actor,
          value: ev.value,
          data: ev.data ? JSON.parse(JSON.stringify(ev.data)) : null
        });
        if (room.eventLog.length > 300) room.eventLog.splice(0, room.eventLog.length - 300);
      } catch (e) { /* 记录失败不影响业务 */ }
    });
  });
}

module.exports = { ensureStarted, WATCHED };
