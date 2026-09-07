/**
 * timerScheduler.js — 回合制时间调度器（游戏内部逻辑时间轴）
 *
 * 以"回合"为单位存储所有定时任务：多少回合后执行、到期回调、是否循环。
 * 每回合推进时（tickTurn）扫描定时器，执行到期任务。
 * 替代操作系统的 sleep：buff 持续回合、debuff 过期、技能 CD、副本倒计时全部靠它。
 *
 * 用法：
 *   const timerId = Scheduler.schedule(3, (ev) => { ... }, { loop: true, type: 'buff', target: 'uid' });
 *   Scheduler.cancel(timerId);
 *   // 每回合推进处调用：
 *   Scheduler.tickTurn();
 */
const logger = require('./logger');
const EVENTS = require('./eventTypes');
const eventBus = require('./eventBus');

const Scheduler = {
  /** 任务池：[{ id, remaining, every, cb, type, target, data, loop }] */
  _tasks: [],
  _nextId: 1,

  /**
   * 注册一个回合制定时任务
   * @param {number} rounds 多少回合后执行（>=1）
   * @param {Function} cb 到期回调 (ev) => void；ev={ type, target, data, task }
   * @param {object} [opts]
   *   - loop: 是否循环（循环则每 rounds 回合重复，默认 false）
   *   - type: 任务标签（'buff'|'skillCd'|'countdown'|'debuff'|'timer' 等，便于调试/取消）
   *   - target: 目标标识（uid / socketId / 房间 id / buff id）
   *   - data:  附加数据
   * @returns {number} 定时任务 id（用于 cancel）
   */
  schedule(rounds, cb, opts = {}) {
    const r = Math.max(1, Math.round(rounds) || 1);
    const task = {
      id: this._nextId++,
      remaining: r,
      every: opts.loop ? r : null,
      loop: !!opts.loop,
      cb: typeof cb === 'function' ? cb : () => {},
      type: opts.type || 'timer',
      target: opts.target || null,
      data: opts.data || null
    };
    this._tasks.push(task);
    return task.id;
  },

  /** 取消一个定时任务（按 id） */
  cancel(id) {
    const before = this._tasks.length;
    this._tasks = this._tasks.filter(t => t.id !== id);
    return before !== this._tasks.length;
  },

  /** 取消某目标下全部任务（如玩家离开房间 / buff 清除） */
  cancelByTarget(target) {
    const before = this._tasks.length;
    this._tasks = this._tasks.filter(t => t.target !== target);
    return before - this._tasks.length;
  },

  /** 取消某类型标签下全部任务（如全部 buff） */
  cancelByType(type) {
    const before = this._tasks.length;
    this._tasks = this._tasks.filter(t => t.type !== type);
    return before - this._tasks.length;
  },

  /**
   * 每回合推进：所有任务剩余回合 -1，扫描到期任务执行回调；
   * 循环任务重置剩余回合，一次性任务移除。
   * 同时广播 TURN_ADVANCED 事件（供其他系统监听回合变化）。
   * @param {string|object} roomRef 房间标识（可选，用于事件 payload）
   * @returns {number} 本轮执行的任务数
   */
  tickTurn(roomRef) {
    const due = [];
    for (const t of this._tasks) {
      t.remaining--;
      if (t.remaining <= 0) due.push(t);
    }
    for (const t of due) {
      try {
        t.cb({ type: t.type, target: t.target, data: t.data, task: t, actor: t.target, value: 1 });
        eventBus.emit(EVENTS.TIMER_FIRED, { actor: roomRef || t.target, data: { timerId: t.id, tag: t.type, target: t.target } });
      } catch (e) {
        logger.error.error('定时任务异常', { type: t.type, target: t.target, error: e.message });
      }
      if (t.loop) t.remaining = t.every;
    }
    if (due.length) {
      this._tasks = this._tasks.filter(t => t.loop || !due.includes(t));
    }
    return due.length;
  },

  /** 待执行任务数（含循环） */
  pendingCount() {
    return this._tasks.length;
  },

  /** 某目标下的任务数 */
  countByTarget(target) {
    return this._tasks.filter(t => t.target === target).length;
  },

  /** 清空全部任务 */
  clear() {
    this._tasks = [];
  }
};

module.exports = Scheduler;
