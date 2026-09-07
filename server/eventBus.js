/**
 * eventBus.js — 全局事件管理器（事件驱动核心）
 *
 * 支持：注册监听 on / 触发事件 emit / 取消监听 off / 一次性 once / 清空 clear。
 * 事件统一携带结构体：{ type, actor, value, data, timestamp }
 *   - type:  事件类型（见 eventTypes.js）
 *   - actor: 事件主体（谁发起的：socketId / uid / 职业 id / 房间 id）
 *   - value: 主数值（伤害值、HP 变化、回合数等）
 *   - data:  附加数据（对象：物品、技能、buff、目标等）
 *
 * 设计意图：业务系统（战斗/背包/副本/怪物 AI）只 emit 自己的事件 + 订阅关心的事件，
 * 不互相直接调用；新增 buff/副本/系统时只需订阅事件，无需改旧系统调用链。
 */
const logger = require('./logger');

const EventBus = {
  /** Map<type, Set<fn>> */
  _listeners: new Map(),

  /** 注册监听；返回取消函数 */
  on(type, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this.off(type, fn);
  },

  /** 一次性监听：触发一次后自动取消 */
  once(type, fn) {
    const wrap = (ev) => { this.off(type, wrap); try { fn(ev); } catch (e) { logger.error.error('事件回调异常', { type, error: e.message }); } };
    return this.on(type, wrap);
  },

  /** 触发事件：广播给所有监听者；单个监听者异常不影响其他 */
  emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set || set.size === 0) return 0;
    const ev = Object.assign({ type, timestamp: Date.now() }, payload || {});
    let count = 0;
    for (const fn of Array.from(set)) {
      try { fn(ev); count++; } catch (e) {
        logger.error.error('事件回调异常', { type, error: e.message });
      }
    }
    return count;
  },

  /** 取消监听（指定类型 + 函数） */
  off(type, fn) {
    const set = this._listeners.get(type);
    if (set && fn) set.delete(fn);
  },

  /** 按类型移除全部监听 / 无参清空全部 */
  clear(type) {
    if (type) this._listeners.delete(type);
    else this._listeners.clear();
  },

  /** 指定类型的监听者数量 */
  listenerCount(type) {
    const set = this._listeners.get(type);
    return set ? set.size : 0;
  },

  /** 当前监听总数 */
  total() {
    let n = 0;
    for (const set of this._listeners.values()) n += set.size;
    return n;
  }
};

module.exports = EventBus;
