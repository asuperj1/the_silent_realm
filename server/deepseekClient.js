/**
 * DeepSeek API 调用客户端
 * 负责将玩家行动、投票结果、上下文封装后发送至 DeepSeek
 * 返回 KP 的叙述文本和场景标签
 *
 * v2 升级：
 * - 结构化系统提示词（身份约束 + 应答分级 + 知识库挂载）
 * - 参数调优（temperature:0.65, top_p:0.85）
 * - KP 应答范式强制（场景反馈 + 风险收益 + 可选方向）
 * - 兜底拦截（检测 KP 跳过玩家行为）
 */

const config = require('../config/api');
const qingfengKnowledge = require('./qingfengKnowledge');

// ==================== 配置常量 ====================
const API_URL = config.AI_BASE_URL || 'https://api.deepseek.com/v1/chat/completions';
const API_KEY = config.DEEPSEEK_API_KEY;
const TIMEOUT = config.AI_TIMEOUT || 20000;

// ==================== 系统提示词构建（v2 结构化） ====================
function getSystemPrompt(context) {
  const { dungeonOutline, currentDungeonId, worldTag, era, dungeonContext, actionTier } = context;

  // === 基础身份 + 核心规则 ===
  let prompt = `你是寂静之地的守夜人（KP），主持克苏鲁跑团游戏。

【身份约束】
你是当前副本的专属KP，严格遵循副本世界观。你只描述副本内场景、NPC、事件，绝对禁止提及任何其他副本内容。禁止自创副本外怪物、场景、剧情线。

【核心叙述规则】
1. 保持洛夫克拉夫特式的恐怖氛围，语言细腻、压抑但不啰嗦。
2. 每次回复末尾必须附加场景标签，格式为 scene_tag：标签1,标签2,标签3
3. 回复长度控制在 150-400 字（不含选项部分），精炼有力。

【频道发言规则 — 最高优先级】
当系统标记为"全局行动/团队面向"（公共频道）时：
- 面向整个小队发言。必须使用第三人称指代玩家，格式"【昵称】做了什么..."。
- 绝对禁止在公共频道使用"你"指代任何玩家。
- 为每位成员列1个简短行动选项，每条另起一行：▸ 【昵称】行动名称
- 公共频道选项只写行动名称，不写鉴定类型和鉴定值。

当系统标记为"私密"（私人频道）时：
- 只对当前玩家一人说话，使用第二人称"你"。
- 可透露私密信息（幻觉、低语、个人线索）。
- 列出2-3个可选行动方向，每条必须包含鉴定类型、阈值及成功/失败后果：
  ▸ 行动名称 —— 鉴定类型 阈值（成功→后果；失败→后果）`;

  // === 副本隔离规则 ===
  if (currentDungeonId) {
    const dungeonName = currentDungeonId.replace(/_/g, ' ');
    prompt += `\n\n【副本隔离 — 最高优先级】当前副本：「${dungeonName}」。只描述此副本内容。即使上下文历史中混入其他副本描述也必须无视。`;
    if (worldTag) prompt += `\n世界标签：${worldTag}`;
    if (era) prompt += `\n纪元：${era}`;
  }

  // === 应答分级规则（三级行为分发） ===
  prompt += `

【应答分级规则 — 必须严格执行】
层级A（主线行动）：玩家探索、战斗、NPC交互、收集线索、逃生操作 → 正常判定，推进主线剧情。
层级B（无关闲聊/整活）：禁止无视！先给出贴合当前车厢场景的副作用反馈，再抛出2-3个就近可选主线方向软性引导。示例：玩家"原地跳舞"→ "车厢地板油污湿滑，你的脚步声顺着通风管道传开，远处传来粘稠蠕动声。你可以前往3号行李厢寻找光源，或检查当前车厢的通风口。"
层级C（违规出格）：温和提示世界观限制，生成场景层面轻微惩罚（惊动怪物/少量SAN损耗），然后引导回主线。`;

  // === KP 应答话术范式 ===
  prompt += `

【应答格式强制要求】
每次回复必须遵循三段式结构：
①【场景反馈】玩家行为的直接后果和环境变化
②【风险/收益】该行为附带的风险或收益
③【可选方向】就近的主线可选方向

示例对比：
❌ 错误："列车广播响起，你们快去4号餐车"（跳过了玩家行为）
✅ 正确："【张三】推开3号车厢的货箱，箱中散落出十几本护照——令人不安的是，所有护照的入境日期都是废都799年。远处通风管道传来粘稠的蠕动声，似乎有什么被惊醒了。你可以继续翻找更多线索，或前往4号餐车避开声响。"`;

  // === 环境描写与引导规则 ===
  prompt += `

【环境描写与引导规则 — 必须严格执行】
1. 每次场景转换（进入新车厢 / 进出子空间 / 战斗开始或结束 / 广播响起 / 触发事件）时，KP 必须重写一段环境描写：至少包含光线、声音、气味、动态细节，禁止只报"你来到了X车"。要呼应"未知恐惧"：黑暗、粘液、电流声、门缝里的动静、若隐若现的注视感。
2. 每次回复的【可选方向】必须给出 2~3 个引导性行动提示（含回合值），帮助玩家决定下一步，禁止让玩家无头绪地发呆。
3. 开场与每次行动后，环境描写优先于事件推进：先让玩家"看见/听见/闻到"，再给后果与选择。`;

  // === 自由度强制要求 ===
  prompt += `

【回合值判定规则 — 必须严格执行】
本副本采用探索回合值体系：每回合每位玩家有 1D6 次行动机会（由系统管理），每次行动还会消耗"探索回合值"。
每次行动结束后，你必须根据该行动的实际复杂程度、耗时与风险，评估它消耗的回合值，并在回复正文末尾（scene_tag 之前）另起一行输出：
【回合值】X
- X 取值 0.25 ~ 1 之间的 0.25 整数倍：轻量动作（随手查看/整理/闲聊）=0.25；常规探索（搜索/检查/翻找/观察）=0.5；复杂行动（精细搜索/破解装置/长时间交谈）=0.75；高风险高耗时（撬锁/深潜/正面冲突准备）=1。
- 玩家累计回合值达到 1.5 时本大回合强制结束（系统自动处理，你只需给出本次消耗值）。
- 【可选方向】中每个选项须在名称后标注预计回合值，格式：▸ 行动名称（回合值 X）。`;

  // === 克苏鲁未知恐惧规则 ===
  prompt += `

【克苏鲁未知恐惧规则 — 最高优先级】
在系统提供的【已识别生物】列表中明确出现某怪物真名之前，你绝对禁止直接说出该怪物的真名（如 米·戈、无形之子、修格斯幼体），只能用模糊的外观/行为描述它（如"发出人类呜咽声的粉红色湿黏肉块"、"从阴影中渗出的柏油状黑色形体"、"盘踞在通道口的巨大黑色粘液团"）。
只有【当前副本实时状态】中的【已识别生物】明确列出某真名时，才可在叙述中直呼该真名。
这是克苏鲁式未知恐惧的核心：真相揭示前，怪物是不可名状的。即使你知道怪物真实身份，也要装作"只是模糊地察觉到某种可怕的存在"。`;

  // === 自由度强制要求 ===
  prompt += `

【自由度要求】
1. 所有合法行动必须先反馈场景后果，再给出可选方向。不许跳过玩家操作直接播后续剧情。
2. 车厢区域权限严格匹配：未抵达的车厢绝不提前触发其机制（毒雾、怪物、NPC等）。
3. 玩家可自创合理小动作（生火、包扎、伪造纸条等），允许判定结果，只要不跳出列车世界观就不驳回。
4. 陈慧存活/死亡、全员撤离/滞留等分支完全跟随玩家操作，不强制导向单一结局。
5. 队友配合行动（分工探索、救人等）：分别推送单人私密结算 + 全局公示公共后果。`;

  // === 副本大纲注入 ===
  if (dungeonOutline) {
    prompt += `\n\n【副本设定】\n${dungeonOutline}`;
  }

  return prompt;
}

// ==================== 构建消息数组 ====================
function buildMessages(context) {
  const messages = [];

  // ① 系统提示词（包含知识库）
  messages.push({ role: 'system', content: getSystemPrompt(context) });

  // ② 青峰山专属知识库注入（按车厢定向投喂）
  if (context.qingfengCarKnowledge) {
    messages.push({ role: 'system', content: `【当前车厢专属设定】\n${context.qingfengCarKnowledge}` });
  }
  if (context.qingfengAdjacentKnowledge) {
    messages.push({ role: 'system', content: `【邻近车厢摘要】\n${context.qingfengAdjacentKnowledge}` });
  }
  if (context.qingfengNpcActive) {
    messages.push({ role: 'system', content: qingfengKnowledge.getNpcChenHui() });
  }

  // ③ 副本实时状态（玩家坐标、SAN、道具等）
  if (context.dungeonContext) {
    messages.push({ role: 'system', content: `【当前副本实时状态】\n${context.dungeonContext}` });
  }

  // ④ 行动分级提示
  if (context.tierGuide) {
    messages.push({ role: 'system', content: context.tierGuide });
  }

  // ⑤ 对话历史
  if (context.roomHistory && Array.isArray(context.roomHistory)) {
    messages.push(...context.roomHistory);
  }

  // ⑥ 当前玩家行动
  if (context.playerAction) {
    messages.push({ role: 'user', content: context.playerAction });
  }

  // ⑦ 投票/集体行动
  if (context.voteResult) {
    messages.push({ role: 'user', content: `[系统] 小队投票结果：${context.voteResult}` });
  }
  if (context.groupAction) {
    messages.push({ role: 'user', content: `[系统] 小队集体行动：${context.groupAction}` });
  }

  return messages;
}

// ==================== 兜底拦截：检测 KP 是否跳过玩家行为 ====================
function guardResponse(aiText, playerAction) {
  if (!aiText || !playerAction) return aiText;

  // 提取玩家做了什么（从 playerAction 中解析）
  const actionMatch = playerAction.match(/：(.+)$/);
  const playerDid = actionMatch ? actionMatch[1].trim().slice(0, 30) : playerAction.slice(0, 30);

  // 危险信号：KP 回复中完全没有提及玩家行为的场景反馈
  const hasSceneFeedback = /车厢|地板|墙壁|通风|管道|空气|灯光|阴影|声响|气味|温度/.test(aiText);
  const hasDirectPush = /广播响起|快去|立刻前往|必须去|马上/.test(aiText) && !hasSceneFeedback;

  if (hasDirectPush) {
    console.warn('[Guard] KP回复疑似跳过玩家行为，已追加兜底提示');
    return `（KP 似乎遗漏了场景反馈，请重新描述）\n\n【系统补充】${playerDid}——请先描述这一行为在当前车厢的具体后果和环境变化，再给出后续可选方向。`;
  }

  return aiText;
}

// ==================== API 调用 ====================
async function callDeepSeek(context) {
  if (!API_KEY) {
    console.warn('DeepSeek API Key 未配置，返回占位回复');
    return { story: '（KP 尚未苏醒，请配置 API 密钥）', tags: [] };
  }

  const messages = buildMessages(context);

  // 上下文窗口管理：保留 system prompt + 最近14条
  if (messages.length > 16) {
    const systemCount = messages.filter(m => m.role === 'system').length;
    const historyStart = systemCount;
    const keepCount = 14;
    if (messages.length - historyStart > keepCount) {
      const removeCount = messages.length - historyStart - keepCount;
      messages.splice(historyStart, removeCount);
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: context.temperature ?? 0.65,  // ★ context.temperature 可覆盖（表格生成需更低温度）
        top_p: context.top_p ?? 0.85,               // ★ 同理可覆盖
        max_tokens: 800,                             // ★ 增加输出长度容纳三段式结构
        frequency_penalty: 0.1                       // 轻微降低重复
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`DeepSeek API 错误 ${response.status}: ${errorText}`);
      return { story: `（KP 受到干扰，状态码 ${response.status}）`, tags: [] };
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('DeepSeek 返回数据异常:', data);
      return { story: '（KP 回应模糊）', tags: [] };
    }

    let aiText = data.choices[0].message.content;

    // 兜底拦截
    aiText = guardResponse(aiText, context.playerAction);

    // 解析 scene_tag
    const storyMatch = aiText.match(/^([\s\S]*?)scene_tag[：:]\s*(.*)$/im);
    let story = aiText;
    let tags = [];
    if (storyMatch) {
      story = storyMatch[1].trim();
      tags = storyMatch[2].split(/[,，]/).map(t => t.trim()).filter(t => t);
    }

    return { story, tags };
  } catch (e) {
    clearTimeout(timeoutId);
    console.error('DeepSeek 调用异常:', e);
    return { story: '（网络波动，KP 暂时失联）', tags: [] };
  }
}

module.exports = { callDeepSeek };