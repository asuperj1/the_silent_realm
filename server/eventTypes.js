/**
 * eventTypes.js — 事件类型常量表（事件驱动系统）
 *
 * 约定：所有业务事件名集中于此，业务系统用常量引用（避免字符串硬编码分叉）。
 * 事件结构：{ type, actor, value, data, timestamp }
 *   actor: 主体标识（socketId / uid / 职业 / 房间）
 *   value: 主数值（伤害 / HP 变化 / 回合数 / 金币等）
 *   data:  附加数据对象
 */
const EVENTS = {
  // ============ 战斗 ============
  BATTLE_START: 'battle:start',                 // actor: 房间id, data:{players, monsters}
  BATTLE_END: 'battle:end',                     // actor: 房间id, value: win('players'|'monsters'|'fled'), data:{winner}
  BATTLE_TURN: 'battle:turn',                   // actor: 房间id, value: 回合号, data:{sid, ap}
  BATTLE_PLAYER_ACT: 'battle:player:act',       // actor: socketId, data:{action, skillId, target}
  BATTLE_DAMAGE: 'battle:damage',               // actor: 攻击方, data:{target, kind:'phys'|'mag'|'true', hits}, value: 总伤
  BATTLE_HEAL: 'battle:heal',                   // actor: 治疗方, data:{target}, value: 治疗量
  BATTLE_DEATH: 'battle:death',                 // actor: 击杀方, data:{target}, value: target 剩余HP(0)
  BATTLE_DEBUFF_APPLIED: 'battle:debuff:applied', // actor: 施加方, data:{target, buff:{id,value,turns}}
  BATTLE_BUFF_EXPIRED: 'battle:buff:expired',   // actor: 目标, data:{buffId}, value: 层数

  // ============ 玩家 ============
  PLAYER_HP_CHANGED: 'player:hp',               // actor: uid, value: HP 变化量, data:{hp, maxHp, cause}
  PLAYER_SAN_CHANGED: 'player:san',             // actor: uid, value: SAN 变化量, data:{san, cause}
  PLAYER_DISCONNECTED: 'player:disconnected',   // actor: socketId, data:{roomId}（断线/刷新，供战斗跳过等订阅）

  // ============ 背包 / 物品 ============
  ITEM_GAINED: 'item:gained',                   // actor: uid, data:{item, count, dungeonId}
  ITEM_USED: 'item:used',                       // actor: uid, data:{item, effects}
  ITEM_EQUIPPED: 'item:equipped',               // actor: uid, data:{item, slot}
  LOOT_ROLLED: 'loot:rolled',                   // actor: uid, data:{dungeonId, scene, drops}

  // ============ 房间 / 副本 ============
  ROOM_JOINED: 'room:joined',                   // actor: socketId, data:{roomId, copyName}
  ROOM_LEFT: 'room:left',                       // actor: socketId, data:{roomId}
  ROOM_RESUMED: 'room:resumed',                 // actor: 房间id, data:{uid}（断线/刷新恢复对局）
  COPY_START: 'copy:start',                     // actor: 房间id, data:{copyName, dungeonState}
  COPY_END: 'copy:end',                         // actor: 房间id, data:{copyName, grade, totalScore}
  CLUE_FOUND: 'clue:found',                     // actor: 房间id, data:{clueId, finder}

  // ============ 怪物 AI ============
  MONSTER_SPAWNED: 'monster:spawned',           // actor: 房间id, data:{type, count, carId}
  MONSTER_DEFEATED: 'monster:defeated',         // actor: 房间id, data:{type, killerUid}

  // ============ 回合 / 时间调度 ============
  TURN_ADVANCED: 'turn:advanced',               // actor: 房间id, value: 回合号（调度器推进后广播）
  BUFF_TICK: 'buff:tick',                       // actor: 目标, data:{buffId}（buff 持续到期前每回合）
  SKILL_CD_READY: 'skill:cd:ready',             // actor: socketId, data:{skillName}（技能 CD 到期）
  TIMER_FIRED: 'timer:fired'                    // actor: 房间id, data:{timerId, tag}（通用定时到期）
};

module.exports = EVENTS;
