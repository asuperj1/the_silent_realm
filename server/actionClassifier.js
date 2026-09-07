/**
 * actionClassifier.js — 玩家行为三级分发机制
 *
 * 在 DeepSeek API 调用前对玩家消息自动归类：
 *   层级A（主线有效行为）→ 正常结算判定，推进主线
 *   层级B（无关休闲/整活行为）→ 先生成场景副作用反馈，再软性引导
 *   层级C（违规危险行为）→ 提示世界观限制 + 场景惩罚
 */

// ★ 无关命令 / 敏感词 / 元游戏指令 拦截配置（config/kp_filter.json）
const fs = require('fs');
const path = require('path');
const KP_FILTER_PATH = path.join(__dirname, '..', 'config', 'kp_filter.json');
let KP_FILTER = {};
let _filterMtime = -1;
/** 热加载过滤配置：按文件修改时间增量读取，添加/修改敏感词后保存即生效，无需重启服务器 */
function loadKpFilter() {
  try {
    const st = fs.statSync(KP_FILTER_PATH);
    if (st.mtimeMs !== _filterMtime) {
      _filterMtime = st.mtimeMs;
      KP_FILTER = JSON.parse(fs.readFileSync(KP_FILTER_PATH, 'utf8'));
    }
  } catch (e) { /* 配置读取失败时保持旧配置 */ }
  return KP_FILTER || {};
}

// ==================== 层级A：主线有效行为关键词 ====================
const TIER_A_PATTERNS = [
  // 移动/探索
  /前往|走去|移动到|进入|探索|搜查|检查|调查|观察|查看|搜寻|翻找|打开/,
  // 战斗相关
  /攻击|战斗|击退|防御|闪避|逃跑|撤离|使用武器|开枪|挥拳/,
  // NPC交互
  /陈慧|列车员|对话|交谈|询问|求救|救人|救出|营救/,
  // 道具交互
  /拾取|拿起|携带|使用道具|装备|撬棍|手电|光源|急救/,
  // 线索相关
  /线索|广播|日记|便签|护照|工程图|日志/,
  // 车厢操作
  /推门|拉门|破门|撬开门|爬行|贴地|开启通道|关闭通风口/,
  // 逃生
  /逃生|逃离|离开列车|疏散/
];

// ==================== 层级C：违规危险行为 ====================
const TIER_C_PATTERNS = [
  // 跳出世界观
  /打电话|发微信|上网|百度|谷歌|报警|110|120|119|发短信|刷手机|拍照发朋友圈/,
  // 严重破坏性
  /炸毁列车|引爆|自杀|跳车|砸窗跳车|破坏虚空裂隙/,
  // 超自然破坏
  /召唤|施法|魔法|灵力|气功波|变身|飞行|穿墙|隐身|读心/,
  // 元游戏
  /退出游戏|关闭服务器|删除角色|修改数据|开挂|作弊/
];

// ==================== 层级B：兜底（所有未被A/C匹配的行为） ====================
const TIER_B_PATTERNS = [
  // 闲聊/社交
  /聊天|开玩笑|打趣|吐槽|抱怨|安慰|调侃|打招呼|你好|嗨|哈喽/,
  // 无意义动作
  /跳舞|唱歌|吹口哨|发呆|坐着|躺着|睡觉|打哈欠|伸懒腰|踱步|来回走|转圈/,
  // 整活
  /假装|表演|模仿|搞笑|幽默|摆pose|比心|自拍|画画|写日记/,
  // 无关提问
  /今天星期几|几点了|天气|吃什么|饿了吗|渴了|好无聊|有意思/
];

// ==================== 分类函数 ====================

/**
 * 对玩家消息进行三级分类
 * @param {string} content - 玩家输入内容
 * @param {object} state - 副本当前状态（可选，用于更精准判定）
 * @returns {{ tier: 'A'|'B'|'C', reason: string, penalty: object|null }}
 */
function classifyAction(content, state) {
  if (!content || typeof content !== 'string') {
    return { tier: 'B', reason: '空消息', penalty: null };
  }

  const trimmed = content.trim();

  // 先检查层级C（违规危险）—— 优先级最高
  for (const pattern of TIER_C_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        tier: 'C',
        reason: `行为触犯世界观边界：${trimmed.slice(0, 20)}...`,
        penalty: {
          sanLoss: 1,
          alertMonster: true,
          message: '你的行动违背了这个世界的物理法则。虚空似乎被你的异常行为惊扰，远处传来不祥的蠕动声...'
        }
      };
    }
  }

  // 检查层级A（主线有效行为）
  for (const pattern of TIER_A_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        tier: 'A',
        reason: `主线有效行为：${trimmed.slice(0, 20)}...`,
        penalty: null
      };
    }
  }

  // 检查层级B（明确匹配）
  for (const pattern of TIER_B_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        tier: 'B',
        reason: `休闲/整活行为：${trimmed.slice(0, 20)}...`,
        penalty: null
      };
    }
  }

  // 默认兜底B级：未匹配任何模式的消息
  return {
    tier: 'B',
    reason: `未识别行为类型，默认按休闲处理：${trimmed.slice(0, 20)}...`,
    penalty: null
  };
}

/**
 * 生成层级B的引导性提示词片段（注入到 playerAction）
 * @param {string} currentCar - 当前车厢
 * @param {string} playerName - 玩家名称
 * @returns {string}
 */
function getTierBGuidePrompt(currentCar, playerName) {
  const carGuides = {
    car_1_cab: '调查列车长的尸体、检查操控台是否有遗留信息、返回2号车厢',
    car_2_economy: '检查过道上的乘务员尸体、小心车顶滴落的粘液、翻找散落行李、前往1号或3号车厢',
    car_3_luggage: '透过车窗观察隧道外沿车顶攀爬的粉红色湿黏肉块、翻找货箱寻找道具、尝试打开上锁工具箱、前往2号或4号车厢',
    car_4_dining: '检查厨房是否有食物和光源、翻阅吧台广播日志、前往3号或5号车厢',
    car_5_sleeper: '搜查床铺寻找乘客遗留物品、注意走廊动静、前往4号或6号车厢',
    car_6_mail: '翻找货物邮件寻找补给、注意货堆缝隙的动静、前往5号或7号车厢',
    car_7_service: '注意设备间里的敲击声（可能是陈慧）、清除堵路的柏油状黑色形体、前往6号或8号车厢',
    car_8_cabin: '贴地爬行避开毒雾、警惕盘踞通道口的巨大黑色粘液团、检查侧壁发光裂缝（逃生通道）'
  };

  const guide = carGuides[currentCar] || '探索当前车厢环境、寻找线索或道具';
  return `【软性引导】${playerName}的行为没有实质推进剧情。请先生成贴合当前车厢环境的场景副作用反馈，然后抛出2-3个就近可选主线方向引导玩家回归：${guide}。`;
}

/**
 * 生成层级C的惩罚提示词片段
 * @param {string} penaltyMessage - 惩罚消息
 * @returns {string}
 */
function getTierCPenaltyPrompt(penaltyMessage) {
  return `【世界观违规】${penaltyMessage} 请温和提示玩家这个世界没有这些现代/超自然概念，但不要生硬忽略。生成场景层面的轻微惩罚（如惊动怪物、消耗少量SAN），然后引导回主线。`;
}

// ==================== 无关命令 / 敏感词 / 元游戏指令 拦截 ====================
// ★ 合法行动白名单：即使文本包含无关/元游戏词，命中合法行动动作（移动/探索/交互/道具等）也一律放行，防止误伤
const REJECT_WHITELIST_RE = /前往|走去|走到|移动到|去往|返回|回到|回去|搜索|翻找|检查|查看|调查|搜查|搜刮|寻找|探索|观察|环顾|拾取|拿起|拿取|使用|装备|对话|交谈|询问|询问|求救|救人|营救|撬棍|手电|光源|急救|打开|推门|拉门|破门|撬开|通风|陈慧|列车员|日记|便签|护照|工程图|日志|广播|行李|货箱|公文包|撬|捡/;
const REJECT_REPLY_DEFAULT = {
  irrelevant: '「虚空列车的信号过滤器发出一声轻响：这条指令与本次探索无关，KP 无法回应。请把注意力放回当前车厢的场景上。」',
  sensitive: '「该内容不适合在本次探索中发送，已忽略。请回到克苏鲁的黑暗中继续你们的旅程。」',
  meta: '「你无法在这里执行这个指令——列车只回应真实的行动。」'
};

/** 匹配过滤词列表：支持普通词（包含匹配）与 /正则/ 格式（正则执行），返回命中的词 */
function matchFilterWords(c, list) {
  const out = [];
  (list || []).forEach(w => {
    if (!w || !String(w).trim()) return;
    const ws = String(w).trim();
    if (/^\/.+\/[a-z]*$/.test(ws)) {
      try {
        const m = /^\/(.+)\/([a-z]*)$/.exec(ws);
        const re = new RegExp(m[1], m[2]);
        if (re.test(c)) out.push(ws);
      } catch (e) { /* 忽略非法正则 */ }
    } else if (c.includes(ws)) {
      out.push(ws);
    }
  });
  return out;
}
/** 敏感内容脱敏：将命中的敏感词替换为 ***（用于公共频道广播，避免不当内容传播） */
function maskSensitive(content, matched) {
  let s = String(content || '');
  (matched || []).forEach(w => {
    if (!w || !String(w).trim()) return;
    const ws = String(w).trim();
    try {
      if (/^\/.+\/[a-z]*$/.test(ws)) {
        const m = /^\/(.+)\/([a-z]*)$/.exec(ws);
        const re = new RegExp(m[1], (m[2] || '').includes('g') ? m[2] : (m[2] + 'g'));
        s = s.replace(re, '***');
      } else {
        s = s.split(ws).join('***');
      }
    } catch (e) { /* ignore */ }
  });
  return s;
}

/**
 * 无关命令 / 敏感词 / 元游戏指令 拦截判定（在消耗操作次数与调用 KP 之前调用）
 * @param {string} content - 玩家输入
 * @returns {{ rejected: boolean, type: string|null, reply: string|null, reason: string|null, matched: string[] }}
 */
function checkRejection(content) {
  const cfg = loadKpFilter();
  const c = (content || '').trim();
  if (!c) return { rejected: false, type: null, reply: null, reason: null, matched: [] };
  // 合法行动白名单优先放行（移动/探索/交互/道具等），防止误伤
  if (REJECT_WHITELIST_RE.test(c)) return { rejected: false, type: null, reply: null, reason: null, matched: [] };
  const reply = Object.assign({}, REJECT_REPLY_DEFAULT, cfg.reply || {});
  // 1) 敏感词（最高优先级）
  const sMatched = matchFilterWords(c, cfg.sensitiveWords);
  if (sMatched.length) return { rejected: true, type: 'sensitive', reply: reply.sensitive, reason: '内容包含敏感词', matched: sMatched };
  // 2) 元游戏指令（跳出世界观）
  const mM = matchFilterWords(c, cfg.metaCommands);
  if (mM.length) return { rejected: true, type: 'meta', reply: reply.meta, reason: '元游戏指令', matched: mM };
  // 3) 无关搞怪命令（与副本探索无关）
  const iM = matchFilterWords(c, cfg.irrelevantCommands);
  if (iM.length) return { rejected: true, type: 'irrelevant', reply: reply.irrelevant, reason: '与副本探索无关', matched: iM };
  return { rejected: false, type: null, reply: null, reason: null, matched: [] };
}

module.exports = {
  classifyAction,
  getTierBGuidePrompt,
  getTierCPenaltyPrompt,
  checkRejection,
  maskSensitive,
  TIER_A_PATTERNS,
  TIER_B_PATTERNS,
  TIER_C_PATTERNS
};
