/**
 * turnService.js — 统一回合推进入口（评估改进②）
 *
 * 目标：探索回合（battleHandler.advanceTurn / 副本行动）与战斗回合（battleEngine.endMonsterPhase）
 * 统一经由 timerScheduler.tickTurn 驱动事件调度器，保证 buff 持续 / 技能 CD / 副本倒计时
 * 在探索与战斗中使用同一逻辑时间轴一致过期。
 *
 * 用法：
 *   const turn = turnService.advanceRoomTurn(room);   // room 需含 id 与 turn 字段
 */
const timerScheduler = require('./timerScheduler');
const eventBus = require('./eventBus');
const EVENTS = require('./eventTypes');

const TurnService = {
  /**
   * 推进一个"房间级"通用回合（探索回合 / 行动回合）
   * @param {object} room 游戏房间（须含 id 与 turn 字段）
   * @returns {number} 新回合号
   */
  advanceRoomTurn(room) {
    if (!room) return 1;
    room.turn = (room.turn || 1) + 1;
    const turn = room.turn;
    // ★ 统一回合入口：驱动事件调度器（buff/CD/倒计时到期）+ 广播回合推进事件
    if (room.id) {
      timerScheduler.tickTurn(room.id);
      eventBus.emit(EVENTS.TURN_ADVANCED, { actor: room.id, value: turn });
    }
    return turn;
  }
};

module.exports = TurnService;
