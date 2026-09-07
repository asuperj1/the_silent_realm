/**
 * dungeonFramework.js — 通用副本框架（数据驱动）
 *
 * 副本 = config/dungeons/<id>.json 配置 + 可选专属引擎（config.engine 指向 server/ 下的模块）
 * 新增副本只需放置一个 JSON 配置即可获得：状态工厂 / 空间系统 / 线索目录 / 真相层级 / 副本回顾；
 * 复杂剧情（对讲机、NPC、专属结局等）通过 config.engine 挂载专属脚本（如 qingfengTrain）。
 *
 * 配置 Schema（config/dungeons/<id>.json）：
 *   id              必填 注册 key（如 qingfeng_train_800）
 *   name            必填 副本展示名（与游戏内 copyName 一致，供注册表匹配）
 *   worldTag/era    可选 世界观标签/纪元（注入 KP 上下文）
 *   exclusiveMap    可选 专属大地图路径
 *   sceneSwitchEnable 可选 是否允许场景切换（默认 true）
 *   engine          可选 专属引擎模块名（server/ 下，加载后提供 collectClue/processEntryBroadcast 等钩子）
 *   startCar        必填 初始空间
 *   spaces          必填 空间邻接/怪物分布；monsters.formless/shoggoth 触发未清怪物；monsterGate 表示需该 carStates flag=true 才出怪
 *   initialCarStates 必填 各空间初始状态
 *   clues           可选 线索目录 { id: { name, icon, desc } }
 *   truthThresholds 可选 { 线索数: 层级 } 驱动真相层级（如 { "3": 1, "5": 2, "7": 3 }）
 *   truthLabels     可选 层级标签数组（0~3）
 *   initialState    可选 额外初始状态字段（专属引擎用）
 */
const fs = require('fs');
const path = require('path');

const DUNGEONS_DIR = path.join(__dirname, '..', 'config', 'dungeons');
let _registry = null;

/** 扫描 config/dungeons/ 建立副本注册表（带缓存） */
function scanRegistry() {
  if (_registry) return _registry;
  _registry = [];
  try {
    for (const f of fs.readdirSync(DUNGEONS_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(DUNGEONS_DIR, f), 'utf8'));
        if (cfg && cfg.id && cfg.name) _registry.push(cfg);
      } catch (e) {
        console.warn('[dungeonFramework] 配置解析失败', f, e.message);
      }
    }
  } catch (e) { /* 目录不存在则空注册表 */ }
  return _registry;
}

/** 按副本展示名解析（copyName 匹配） */
function resolveDungeon(copyName) {
  if (!copyName) return null;
  return scanRegistry().find(c => c.name === copyName) || null;
}

/** 按注册 id 取配置 */
function getDungeonConfig(dungeonId) {
  if (!dungeonId) return null;
  return scanRegistry().find(c => c.id === dungeonId) || null;
}

/**
 * 通用状态工厂：配置 → 副本状态（合并 initialState 专属字段，深拷贝防共享）
 */
function createDungeonState(config) {
  const base = {
    dungeonId: config.name,            // 保持副本展示名（旧字段兼容）
    dungeonConfigId: config.id,        // ★ 框架注册 id（前端/服务端按此识别框架副本）
    turn: 0,
    phase: 'entry',                    // entry | explore | showdown | escape | settled
    currentCar: config.startCar,
    carStates: JSON.parse(JSON.stringify(config.initialCarStates || {})),
    cluesFound: [],
    truthTier: 0,
    activeCombat: null,
    sceneSwitchEnable: config.sceneSwitchEnable !== false
  };
  return Object.assign(base, config.initialState ? JSON.parse(JSON.stringify(config.initialState)) : {});
}

// ==================== 空间系统（通用） ====================
function getAdjacent(config, spaceId) { return ((config.spaces || {})[spaceId] || {}).adj || []; }
function getSpaceLabel(config, spaceId) { return ((config.spaces || {})[spaceId] || {}).label || spaceId; }

/**
 * 通用怪物触发：spaces[id].monsters（formless/shoggoth）+ 通用清除标记
 * - formless：该空间未 clearedSpawn 才出怪；若配置 monsterGate，需对应 carStates flag=true 才出（如 5号车 formlessTriggered）
 * - shoggoth：全局 shoggothDefeated=false 才出
 */
function getSpaceMonsters(config, spaceId, state) {
  const s = (config.spaces || {})[spaceId];
  if (!s || !s.monsters) return [];
  const out = [];
  const cs = (state.carStates || {})[spaceId] || {};
  if (s.monsters.formless) {
    const gate = s.monsterGate;
    const gated = gate ? !cs[gate] : false;
    if (!cs.clearedSpawn && !gated) out.push({ type: 'formless', count: s.monsters.formless });
  }
  if (s.monsters.shoggoth) {
    if (!state.shoggothDefeated && !state.shoggothTriggered) out.push({ type: 'shoggoth', count: 1 });
  }
  return out;
}

// ==================== 线索目录 + 真相层级（通用） ====================
function getClue(config, clueId) { return (config.clues || {})[clueId] || null; }
function getClueCatalog(config) { return config.clues || {}; }

/** 通用真相层级：按 truthThresholds 由线索数驱动（{线索数: 层级}） */
function updateTruthTier(config, state) {
  const t = config.truthThresholds || {};
  const count = (state.cluesFound || []).length;
  let tier = 0;
  for (const [th, v] of Object.entries(t)) {
    if (count >= parseInt(th, 10)) tier = Math.max(tier, parseInt(v, 10));
  }
  state.truthTier = Math.max(state.truthTier || 0, Math.min(tier, 3));
  if (tier >= 3) state.miGoDeceived = false; // ★ 通用钩子：完全真相解除米·戈欺骗（若无此字段则无害）
  return state.truthTier;
}

// ==================== 副本回顾（结算展示） ====================
function buildReview(config, state) {
  const clues = (state.cluesFound || []).map(id => {
    const c = getClue(config, id) || {};
    return { id, name: c.name || c.itemName || id, icon: c.icon || '📜' };
  });
  const labels = config.truthLabels || ['真相未明', '碎片拾取', '拼图成形', '完全真相'];
  return {
    clues,
    truthTier: state.truthTier || 0,
    truthLabel: labels[Math.min(3, state.truthTier || 0)] || '真相未明',
    turns: state.turn || 0,
    walkieStage: state.walkieStage || 0,
    walkieLabel: ['未接通', '初识', '信任', '指引', '终局'][Math.min(4, state.walkieStage || 0)] || '',
    chenHuiAlive: !!(state.chenHui && state.chenHui.alive),
    chenHuiRescued: !!(state.chenHui && state.chenHui.rescued)
  };
}

/** 专属引擎装载（config.engine → require('./<engine>')），失败返回 null */
function loadEngine(config) {
  if (!config || !config.engine) return null;
  try { return require('./' + config.engine); } catch (e) {
    console.warn('[dungeonFramework] 专属引擎加载失败', config.engine, e.message);
    return null;
  }
}

module.exports = {
  scanRegistry, resolveDungeon, getDungeonConfig,
  createDungeonState,
  getAdjacent, getSpaceLabel, getSpaceMonsters,
  getClue, getClueCatalog, updateTruthTier,
  buildReview, loadEngine
};
