/**
 * statResolver.js — 选项数值解析与应用引擎 (P0)
 *
 * 职责：
 *   1. 解析 DeepSeek 第二次调用返回的 Markdown 四列表格
 *   2. 为每位玩家存储待选选项（按 socket.id 索引）
 *   3. 根据玩家选择 + 属性阈值判定，应用数值变化
 *   4. 选项被选择后自动清理
 *
 * 表格格式：
 *   | 行动名称 | 鉴定要求 | 成功数值变化 | 失败数值变化 |
 *   | 用力撬开 | 力量 55   | STR+5, HP-2  | HP-5         |
 */

// 属性名映射（支持中文、英文缩写、混合写法）
const ATTR_MAP = {
  '力量': 'str', 'str': 'str', 'STR': 'str',
  '敏捷': 'dex', 'dex': 'dex', 'DEX': 'dex',
  '体质': 'con', 'con': 'con', 'CON': 'con',
  '感知': 'per', 'per': 'per', 'PER': 'per',
  '侦查': 'per', '侦察': 'per',
  '意志': 'wil', 'wil': 'wil', 'WIL': 'wil', '意志力': 'wil', 'will': 'wil', 'WILL': 'wil',
  '智力': 'int', 'int': 'int', 'INT': 'int',
  '魅力': 'cha', 'cha': 'cha', 'CHA': 'cha',
  '幸运': 'lck', 'lck': 'lck', 'LCK': 'lck',
  '生命': 'hp', 'hp': 'hp', 'HP': 'hp', '生命值': 'hp',
  '理智': 'san', 'san': 'san', 'SAN': 'san', '理智值': 'san',
  '最大生命': 'maxHp', 'maxhp': 'maxHp', 'MAXHP': 'maxHp',
  '最大理智': 'maxSan', 'maxsan': 'maxSan', 'MAXSAN': 'maxSan',
};

// 待选选项存储：socketId -> { options, characterSnapshot }
const _pendingOptions = new Map();

// ==================== 表格解析 ====================

/**
 * 解析 DeepSeek 产出的 Markdown 表格为结构化选项数组
 * @param {string} tableText - DeepSeek 返回的表格文本
 * @returns {Array|null} [{ name, checkAttr, threshold, successDelta, failDelta }] 或 null
 */
function parseTable(tableText) {
  if (!tableText || typeof tableText !== 'string') return null;

  const lines = tableText.trim().split('\n').filter(l => l.trim());
  if (lines.length < 3) return null; // 至少需要表头+分隔行+一行数据

  // 找表格起始行
  let headerIdx = -1;
  let separatorIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (headerIdx === -1) {
        // 判断是否是表头行（包含中文字符而非纯 |---|---| 分隔线）
        if (/[\u4e00-\u9fff]/.test(trimmed)) {
          headerIdx = i;
        } else if (trimmed.match(/^\|[\s\-:]+\|[\s\-:]+\|/)) {
          separatorIdx = i;
        }
      } else if (separatorIdx === -1) {
        if (trimmed.match(/^\|[\s\-:]+\|[\s\-:]+\|/)) {
          separatorIdx = i;
        }
      }
    }
  }
  if (headerIdx === -1) return null;
  if (separatorIdx === -1) separatorIdx = headerIdx + 1; // 容错

  // 解析表头定位列索引
  const headers = _splitRow(lines[headerIdx]);
  const colName = _findCol(headers, ['行动名称', '行动', '选项', 'Action', 'action']);
  const colCheck = _findCol(headers, ['鉴定要求', '鉴定', '判定', 'Check', 'check']);
  const colSuccess = _findCol(headers, ['成功数值变化', '成功变化', '成功', 'Success', 'success']);
  const colFail = _findCol(headers, ['失败数值变化', '失败变化', '失败', 'Failure', 'fail']);
  const colCost = _findCol(headers, ['回合值', '回合消耗', '行动回合', 'Cost', 'cost']);

  if (colName === -1 || colCheck === -1 || (colSuccess === -1 && colFail === -1)) {
    return null; // 必要列缺失
  }

  // 解析数据行
  const options = [];
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;

    const cells = _splitRow(trimmed);
    const name = cells[colName] || '';
    const checkRaw = cells[colCheck] || '';
    const successRaw = colSuccess !== -1 ? (cells[colSuccess] || '') : '';
    const failRaw = colFail !== -1 ? (cells[colFail] || '') : '';

    if (!name) continue;

    // 解析鉴定要求 "属性名 阈值"
    const { attr: checkAttr, threshold } = _parseCheck(checkRaw);
    // 解析数值变化
    const successDelta = _parseDelta(successRaw);
    const failDelta = _parseDelta(failRaw);
    // ★ 解析回合值（0.25~1.5），缺省 0.5
    const cost = colCost !== -1 ? _parseCost(cells[colCost]) : 0.5;

    options.push({ name, checkAttr, threshold, successDelta, failDelta, cost });
  }

  return options.length > 0 ? options : null;
}

/** 解析回合值 "0.5"/"回合0.5" → 0.5；无效返回默认 0.5 */
function _parseCost(raw) {
  if (!raw || raw === '-' || raw === '—') return 0.5;
  const m = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (m) {
    const v = parseFloat(m[1]);
    if (isFinite(v) && v > 0 && v <= 1.5) return v;
  }
  return 0.5;
}

// ==================== 选项管理 ====================

/**
 * 为玩家存储待选选项
 * @param {string} socketId - 玩家 socket.id
 * @param {Array} options - 解析后的选项数组
 * @param {Object} character - 玩家角色对象（用于阈值判定快照）
 */
function storeOptions(socketId, options, character) {
  if (!socketId || !options || !options.length) return;
  _pendingOptions.set(socketId, {
    options,
    characterSnapshot: character ? {
      attr: { ...character.attr },
      name: character.name,
    } : null,
    timestamp: Date.now()
  });
}

/**
 * 获取玩家待选选项
 */
function getOptions(socketId) {
  const data = _pendingOptions.get(socketId);
  return data ? data.options : null;
}

/**
 * 清除玩家待选选项
 */
function clearOptions(socketId) {
  _pendingOptions.delete(socketId);
}

// ==================== 数值应用 ====================

/**
 * 应用玩家选择的选项，执行阈值判定和数值变化
 * @param {Object} character - 玩家角色对象（会直接修改其 attr）
 * @param {number} optionIndex - 选择的选项索引
 * @param {string} socketId - 用于清除待选
 * @returns {{ success: boolean, result: object }}
 */
function applyChoice(character, optionIndex, socketId) {
  const data = _pendingOptions.get(socketId);
  if (!data || !data.options || optionIndex < 0 || optionIndex >= data.options.length) {
    return { success: false, result: { error: '选项已过期或无效' } };
  }

  const option = data.options[optionIndex];
  const attr = character.attr;
  if (!attr) return { success: false, result: { error: '角色属性缺失' } };
  const hidden = character.hidden || {};

  // 阈值判定
  const checkAttr = option.checkAttr;
  const threshold = option.threshold || 50;
  let checkPassed = false;

  if (checkAttr && ATTR_MAP[checkAttr] && attr[ATTR_MAP[checkAttr]] !== undefined) {
    const attrKey = ATTR_MAP[checkAttr];
    const attrVal = attr[attrKey] || 0;
    checkPassed = attrVal >= threshold;
  } else {
    // 无有效鉴定属性时，默认通过（纯叙事选项）
    checkPassed = true;
  }

  // 应用数值变化
  const delta = checkPassed ? option.successDelta : option.failDelta;
  const appliedChanges = _applyDelta(attr, delta, hidden);

  // 边界保护
  if (attr.hp !== undefined) attr.hp = Math.max(0, Math.min(attr.maxHp || 999, attr.hp));
  if (attr.san !== undefined) attr.san = Math.max(0, Math.min(attr.maxSan || 999, attr.san));

  // 清除待选
  clearOptions(socketId);

  return {
    success: true,
    result: {
      optionName: option.name,
      checkPassed,
      checkAttr: checkAttr || '无',
      threshold,
      playerAttrValue: checkAttr ? (attr[ATTR_MAP[checkAttr]] || 0) : null,
      appliedChanges,
      newHp: attr.hp,
      newSan: attr.san,
      newStr: attr.str,
      newDex: attr.dex,
      newCon: attr.con,
      newPer: attr.per,
      newWil: attr.wil,
    }
  };
}

// ==================== 内部工具函数 ====================

function _splitRow(line) {
  return line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
}

function _findCol(headers, candidates) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (candidates.some(c => h.includes(c.toLowerCase()))) return i;
  }
  return -1;
}

/**
 * 解析鉴定要求 "力量 55" → { attr: "力量", threshold: 55 }
 */
function _parseCheck(raw) {
  if (!raw || raw === '-' || raw === '—' || raw === '无') {
    return { attr: null, threshold: 0 };
  }
  // 匹配 "力量 55" 或 "侦查 50" 等
  const match = raw.match(/([\u4e00-\u9fff]+|[a-zA-Z]+)\s*(\d+)/);
  if (match) {
    return { attr: match[1], threshold: parseInt(match[2], 10) };
  }
  return { attr: raw.replace(/\d/g, '').trim(), threshold: parseInt(raw.match(/\d+/)?.[0] || '0', 10) };
}

/**
 * 解析数值变化 "HP-3, SAN+1" → { hp: -3, san: 1 }
 */
function _parseDelta(raw) {
  const delta = {};
  if (!raw || raw === '-' || raw === '—' || raw === '无' || raw === '无变化') return delta;

  // 支持 "HP-3, SAN+1" 或 "STR+5, HP-2" 或 "力量+5, HP-2"
  const parts = raw.split(/[,，、;；\s]+/);
  for (const part of parts) {
    const match = part.match(/([\u4e00-\u9fff]+|[a-zA-Z]+)\s*([+-]\d+)/);
    if (!match) continue;
    const key = ATTR_MAP[match[1]] || null;
    if (!key) continue;
    const val = parseInt(match[2], 10);
    delta[key] = (delta[key] || 0) + val;
  }
  return delta;
}

/**
 * 将 delta 应用到角色属性上
 * ★ 6 维镜像同步：per↔int、wil↔hidden.will（cha↔hidden.soul）
 */
function _applyDelta(attr, delta, hidden = {}) {
  const changes = [];
  for (const [key, val] of Object.entries(delta)) {
    if (attr[key] !== undefined) {
      attr[key] += val;
      changes.push({ attr: key, change: val, newValue: attr[key] });
      // ★ 镜像同步
      if (key === 'per' && attr.int !== undefined) attr.int = attr.per;
      if (key === 'int' && attr.per !== undefined) attr.per = attr.int;
      if (key === 'wil' && hidden.will !== undefined) hidden.will = attr.wil;
      if (key === 'will' && hidden.will !== undefined) { hidden.will = attr.will; if (attr.wil !== undefined) attr.wil = hidden.will; }
      if (key === 'cha' && hidden.soul !== undefined) hidden.soul = attr.cha;
    }
  }
  return changes;
}

// ==================== 导出 ====================
module.exports = {
  parseTable,
  storeOptions,
  getOptions,
  clearOptions,
  applyChoice,
};
