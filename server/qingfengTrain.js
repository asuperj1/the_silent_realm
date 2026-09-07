/**
 * qingfengTrain.js — 青峰山虚空列车 副本核心逻辑
 *
 * 规则：
 * - 全程无骰子，纯属性数值阈值判定
 * - 时序隔离：本副本不写入任何洛雅剧情
 * - 计时统一使用「对局轮数」，无秒级CD
 * - sceneSwitchEnable: false，背景图不切换
 */

// ==================== 全局开关 ====================
// 陈慧存活状态 —— 跨世界彩蛋开关
// 由副本结局写入，供纪元1200渔村副本读取
let chenHuiAlive = false;

function isChenHuiAlive() { return chenHuiAlive; }
function setChenHuiAlive(val) { chenHuiAlive = val; }

// ==================== 空间系统（单人独立 + 子空间 + 自动战斗触发） ====================
// 空间 = 主车厢 + 子空间（配电间/餐车餐室）；车内/车外、餐厅/配电间/车厢互不视为同一空间。
// monsters：进入该空间时自动触发的未清除怪物（formless=无形之子 / shoggoth=修格斯幼体）
// ★ P3 配置外置化：空间邻接/怪物分布/初始状态迁入 config/dungeons/qingfeng_train.json
// ★ 通用副本框架：qingfengTrain 作为框架的专属引擎（config.engine），通用能力（状态/线索/真相/回顾）委托框架
const DF = require('./dungeonFramework');
const DUNGEON_CONFIG = DF.getDungeonConfig('qingfeng_train_800') || require('../config/dungeons/qingfeng_train.json');
const SPACES = DUNGEON_CONFIG.spaces;

/** 获取某空间可移动到的相邻空间（含子空间进出） */
function getAdjacentSpaces(carId) {
  return (SPACES[carId] || {}).adj || [];
}

/** 获取空间展示名 */
function getSpaceLabel(carId) {
  return (SPACES[carId] || {}).label || carId;
}

/** 获取某空间尚未清除的怪物列表（自动战斗触发依据）；已清则返回空 */
// ★ 5号车卧铺：条件触发战斗——进入不引怪，需 carStates.car_5_sleeper.formlessTriggered=true 才出怪
function getSpaceMonsters(carId, state) {
  const s = SPACES[carId];
  if (!s || !s.monsters) return [];
  const out = [];
  if (s.monsters.formless) {
    const cs = (state.carStates || {})[carId] || {};
    if (carId === 'car_5_sleeper' && !cs.formlessTriggered) {
      // ★ 未触发条件 → 5号车暂时安全，不引怪（允许安全探索）
    } else if (!cs.clearedSpawn) {
      out.push({ type: 'formless', count: s.monsters.formless });
    }
  }
  if (s.monsters.shoggoth) {
    if (!state.shoggothDefeated) out.push({ type: 'shoggoth', count: 1 });
  }
  return out;
}

// ==================== 怪物数据加载 ====================
let MONSTERS = {};
try {
  MONSTERS = require('../data/character_skill.json');
} catch (e) {
  console.log('[青峰山] 怪物数据加载失败，使用内嵌默认值');
}

// ==================== 副本状态创建（★ 委托通用框架：config.initialState 提供青峰山专属字段） ====================
function createDungeonState() {
  return DF.createDungeonState(DUNGEON_CONFIG);
}

// ==================== 广播入场判定（★ 开场：普通隧道 · 《我打造了旧日支配者神话》废都世界观 · 双套开场白） ====================
// ① 醒来·环境描写（车窗外是普通隧道；“废都”世界观：一座辉煌都市被旧日力量抹去、只剩沉默的黑暗）
// ② 引导性行动提示（含公文包） ③ 伪造广播 + PER察觉
// 风格：外部保持普通隧道，不做夸张异象；世界观遵循《我打造了旧日支配者神话》的废都——繁华城市沉沦、秩序崩坏、
//       旧日神话在暗处滋长；不直呼其名，以含蓄的异常与记忆缺失营造氛围
// isSolo=true 单人游玩视角（"你"）；isSolo=false 多人合作视角（"你们"）
function processEntryBroadcast(state, playerAttr, isSolo) {
  const per = playerAttr.per || 40;
  const messages = [];

  // ① 醒来·环境描写（单人 / 多人两套文案：普通隧道 + 废都世界观暗示）
  messages.push({
    type: 'scene',
    content: isSolo
      ? '尖锐的电流嗡鸣像一根细针，把你从黑暗中挑了出来。你猛地睁开眼——后脑一阵钝痛，喉咙发干，空气里弥漫着铁锈、机油和某种甜腻的腐味。\n\n几乎听不到任何声音，也没有车厢广播响起。\n\n你环顾四周：车厢里空无一人。座椅上散落着翻倒的行李、皱成一团的制服、几份沾了灰的报纸。暖黄色的车厢灯在头顶忽明忽灭，像一颗垂死的心脏。\n\n你总觉得哪里不对。记忆里，这辆列车不该是这样安静。它曾满载乘客，如今却像被隔离于世界之外，只剩下一片寂静，和窗外漆黑无比的隧道。'
      : '尖锐的电流嗡鸣像一根细针，把你们从黑暗中挑了出来。你们先后睁开眼，发现自己躺在同一节车厢的座椅上——后脑一阵钝痛，喉咙发干，空气里弥漫着铁锈、机油和某种甜腻的腐味。\n\n车窗外，是黑漆漆的隧道——混凝土的洞壁湿漉漉地反着光，昏黄的信号灯每隔一阵就闪动一下。几乎听不到任何声音，也没有车厢广播响起。\n\n你们彼此确认：没有人受伤，但这趟车上似乎只剩你们了。座椅上散落着翻倒的行李、皱成一团的制服、几份沾了灰的报纸。暖黄色的车厢灯在头顶忽明忽灭，像一颗垂死的心脏。\n\n你们总觉得哪里不对。记忆里，记忆里，这辆列车不该是这样安静。它曾满载乘客，如今却像被隔离于世界之外，只剩下一片寂静，和窗外漆黑无比的隧道。',
    suspect: false
  });

  // ② 引导性行动提示（含公文包钩子，单人/多人两套）
  messages.push({
    type: 'hint',
    content: isSolo
      ? '你注意到座位旁边放着一只公文包，皮面磨得发亮，金属扣上刻着一行小字「G314 乘务组」。\n\n【建议行动】\n▸ 打开座位旁的公文包看看（回合值 0.5）\n▸ 检查车厢内的广播与紧急疏散图（回合值 0.5）\n▸ 起身走向相邻车厢，看看这列车到底还有没有人（回合值 0.5）'
      : '你们注意到，座位旁边放着一只公文包，皮面磨得发亮，金属扣上刻着一行小字「G314 乘务组」。\n\n【建议行动】\n▸ 打开座位旁的公文包看看（回合值 0.5）\n▸ 分头检查车厢内的广播与紧急疏散图（回合值 0.5）\n▸ 结伴走向相邻车厢，看看这列车到底还有没有人（回合值 0.5）',
    suspect: false
  });

  // ③ 伪造广播（环境描写后片刻响起，双套共用——声音平整异常，与这座废都的沉寂格格不入）
  messages.push({
    type: 'broadcast',
    source: '列车广播',
    content: '就在你环顾四周时，车厢顶部的广播喇叭忽然发出一声刺耳的电流爆鸣——「滋——」。随后响起一个平静的男性声音：「各位乘客，这里是列车长广播。G314 列车已安全通过青峰山隧道，目前行驶平稳。为确保您的安全，请所有乘客前往 2 号车厢集合，工作人员将在那里引导您从紧急出口有序撤离。」',
    suspect: false
  });

  // ④ PER察觉（广播异常——不属于这座废都的声音）
  if (per >= 75) {
    messages.push({
      type: 'system',
      content: '你察觉到广播中的异常——那个声音过于清晰平整，没有呼吸停顿、没有隧道内的环境混响。它不像是在这列火车上发出的声音，倒像是……某个不属于这座废都的东西，正借这列火车，向你们传达着某种意图。它想引你们走向 2 号车厢——那里，或许正有什么，在等着你们。',
      suspect: true
    });
    state.miGoDeceived = false;
  }

  state.turn = 1;
  state.phase = 'explore';
  return messages;
}

// ==================== ★ 初始装备包：公文包 + 对讲机 + 乘务组交接便签 ====================
// 玩家苏醒后座位旁即有一只初始公文包（见开场白）；copyStart 时发放到背包
const STARTER_KIT = [
  { itemId: 'QFSP-BRIEFCASE', itemName: '陈旧的公文包', type: 'plot', icon: '💼', quality: 'gold', desc: '皮面磨得发亮，金属扣上刻着一行小字「G314 乘务组」。里面只有三样东西：一份乘务组交接便签、一部老式对讲机，以及一片空荡荡的隔层。' },
  { itemId: 'QFSP-WALKIE', itemName: '对讲机', type: 'plot', icon: '📻', quality: 'blue', desc: '老式对讲机，频段标着 7。按下通话键，只有刺耳的电流杂音「滋——滋啦——沙沙沙——」。你可以试着用它呼叫某个人——每两个回合可使用一次，信号似乎很不稳定。' },
  { itemId: 'CLUE-L0', itemName: '线索·乘务组交接便签', type: 'plot', icon: '📜', quality: 'gold', desc: '「乘务组交接记录——G314 次。昨晚 23:40 全组点名，列车长失踪；23:47 广播被外部信号劫持。任何人听到广播，都不要信，不要前往 2 号车。陈慧（乘务员）已前往 7 号车检修。本便签交新任值班员。若你看到这份便签，说明我们也失联了。」' }
];

/** 获取初始装备包物品定义（浅拷贝，供发放） */
function getStarterKit() {
  return STARTER_KIT.map(k => ({ ...k }));
}

// ==================== ★ 对讲机支线：联系陈慧（信号差 + 电流音 + 自报身份） ====================
// state.walkieStage: 0=未接通 1=已初识 2=信任 3=指引 4=终局（随线索进度推进）
function walkieTalkie(state, playerAttr) {
  const per = playerAttr.per || 40;
  const noise = '「滋——滋啦——沙沙沙——」';
  const stage = state.walkieStage || 0;

  // 信号判定：PER 越高接通率越高（高 PER 还能听出背景里的第二个呼吸声）
  const successRate = per >= 70 ? 0.7 : 0.5;
  if (Math.random() > successRate) {
    return {
      success: false,
      msg: `${noise}\n你按下通话键，扬声器里只有持续不断的电流杂音。两秒后，一声尖锐的啸叫刺入耳膜，随即重归沉寂——信号太差了，对方似乎没有收到你的呼叫。`,
      stage
    };
  }

  // 接通：按阶段返回信息
  if (stage === 0) {
    state.walkieStage = 1;
    const extra = per >= 70 ? '\n\n在杂音的间隙里，你隐约听见背景中还有另一个……呼吸声。很轻，很平稳，不像人的。' : '';
    return {
      success: true,
      msg: `${noise}\n两三秒后，杂音被压下去，一个女人的声音断断续续地传来——她先自报身份：\n\n「……滋——这里是陈慧。G314 次……乘务员。有人吗？有人在听吗？」\n「……广播……别听广播的。我是人，我有呼吸，我有犹豫……那些声音没有。」\n「滋——我在……7 号车……设备间。门卡死了……外面有东西在敲门。它……它学我说话……」\n（信号再次中断：「滋——沙沙沙——」）${extra}`,
      stage: 1
    };
  }

  if (stage === 1) {
    const clues = state.cluesFound || [];
    if (clues.length >= 2) state.walkieStage = 2;
    return {
      success: true,
      msg: `${noise}\n「……滋——又是你们。好……我以为信号早就断了。」陈慧的声音比上次更清晰了些，但仍夹着杂音。\n「黑色的东西……像柏油一样，在车顶和走廊里蠕动。它们怕光。找到光源……越多越好。」\n「滋——你们……在哪一节车？报一下……我好知道你们走到哪了。」`,
      stage: state.walkieStage
    };
  }

  if (stage === 2) {
    if (state.chenHui && state.chenHui.rescued) state.walkieStage = 3;
    return {
      success: true,
      msg: `${noise}\n「……滋——听着，我摸到规律了。广播……是假的，是那个东西在学列车长的声音。它想骗你们去 2 号车，那里是它的……猎场。」\n「8 号车……车尾，有幼体。那个最大的东西。但……唯一的生路……也在 8 号车尾的侧壁。角阀……嗯……你们要是能到 7 号车，我能……当面说。」`,
      stage: state.walkieStage
    };
  }

  if (stage === 3) {
    state.walkieStage = 4;
    return {
      success: true,
      msg: `${noise}\n「……滋——是你们！太好了……还活着。」陈慧的声音里带着劫后余生的颤抖。\n「8 号车尾的侧壁，有紧急疏散通道。角阀锈住了……力气够大一次就能扳开，不然就得磨上三个回合。毒雾……贴地爬……别站起来。」\n「滋——我……我在出口等你们。活着出去，听到没？」`,
      stage: 4
    };
  }

  // stage 4 终局
  return {
    success: true,
    msg: `${noise}\n「……滋——还在吗？出口……就在前面了。贴着地面爬，别回头，别抬头。它……它讨厌光，讨厌活着的呼吸声。我在这边……我在这边等你们。」`,
    stage: 4
  };
}

// ==================== ★ 线索物品方案：每收集一条线索 → 生成剧情物证入背包（剧情分区） ====================
// 物品内容即线索叙事；收集后对应怪物真名随之解锁（见 state.js CLUE_MONSTER_LOCK）
// ★ 线索目录已迁入 config/dungeons/qingfeng_train.json（clues），由通用框架读取

/** 依据线索ID获取剧情物证定义（★ 委托框架） */
function getClueItem(clueId) {
  return DF.getClue(DUNGEON_CONFIG, clueId);
}

// ==================== ★ P1 素材档案库映射（青峰山） ====================
// 线索自动收录：books(古籍/文本) / anomalies(异象见闻) / npcQuotes(NPC证词)
const CLUE_ARCHIVE_MAP = {
  'L0': { category: 'books', title: '乘务组交接便签', content: '「乘务组交接记录——G314 次。昨晚 23:40 全组点名，列车长失踪；23:47 广播被外部信号劫持。任何人听到广播，都不要信，不要前往 2 号车。陈慧（乘务员）已前往 7 号车检修。」' },
  'L1': { category: 'anomalies', title: '乘客护照异象', content: '散落的护照签发日期全部是废都799年，没有一本更晚的；其中一张照片上的脸像被水泡过一样模糊不清。' },
  'L2': { category: 'anomalies', title: '乘客便签（柏油状东西）', content: '「广播里说去7号车集合——但我刚刚看到7号车门外有东西在动，黑色的、像柏油一样从门缝渗进来。」' },
  'L3': { category: 'anomalies', title: '列车长尸体', content: '列车长仰倒于控制台前，颈部覆盖半凝固黑色粘液。尸体姿势端正、面色如生——瞳孔反光的方式不像死人。' },
  'L4': { category: 'books', title: '卧铺日记（一）', content: '「第三天。广播还在重复一样的话。我已经分不清哪个声音是真的……列车在加速，窗外的黑暗像活的一样在流动。」' },
  'L5': { category: 'books', title: '卧铺日记（二）', content: '「陈姐说往7号车跑，她被困在末尾的设备间里。那地方门被卡死了，可她还在敲。去找陈姐，她知道怎么出去。」' },
  'L6': { category: 'anomalies', title: '广播劫持日志', content: '广播系统日志：23:47:00 正常广播后，23:47:03 信号被外部源劫持，自动广播系统从未恢复控制权。' },
  'L7': { category: 'npcQuotes', title: '陈慧的证言（真相）', content: '陈慧告知全部真相：米·戈伪装机制、8号车修格斯幼体潜伏位置、8号车尾唯一逃生路径。' },
  'L8': { category: 'books', title: '隧道工程图', content: '紧急疏散通道位于8号车尾侧壁——「掰开侧壁角阀，闭气贴地通过。注意：8号车有东西盘踞在通道口。」' }
};
// 线索 → 解锁的怪物图鉴（识破后收录真名）
const CLUE_MONSTER_ARCHIVE = {
  'L3': [{ key: 'miGo', title: '米·戈', content: '发出人类呜咽声的粉红色湿黏肉块——伪装的记忆里，它是乘坐这班列车、模仿人类声带的存在。' }],
  'L6': [{ key: 'miGo', title: '米·戈', content: '米·戈：23:47 劫持广播的外部源，模仿列车长声音制造诱骗广播。' }],
  'L2': [{ key: 'formless', title: '无形之子', content: '无形之子：从阴影渗出的柏油状黑色形体，怕光，在车顶与走廊蠕动。' }],
  'L8': [{ key: 'shoggoth', title: '修格斯幼体', content: '修格斯幼体：盘踞在8号车通道口的巨大黑色粘液团，拥有时空锁定能力。' }],
  'L7': [
    { key: 'miGo', title: '米·戈', content: '米·戈：伪装列车长、劫持广播的存在。' },
    { key: 'formless', title: '无形之子', content: '无形之子：怕光的柏油状黑色形体。' },
    { key: 'shoggoth', title: '修格斯幼体', content: '修格斯幼体：8号车尾通道口的巨大粘液团。' }
  ]
};

/** 线索 → 档案条目（P1 素材档案库） */
function getArchiveForClue(clueId) {
  return CLUE_ARCHIVE_MAP[clueId] || null;
}

/** 线索 → 怪物图鉴条目列表（识破收录） */
function getMonsterArchivesForClue(clueId) {
  return CLUE_MONSTER_ARCHIVE[clueId] || [];
}

/** 对讲机阶段 → 陈慧证词条目（NPC 档案） */
function getWalkieArchive(stage, msg) {
  const titles = { 1: '陈慧的联络·初识', 2: '陈慧的联络·信任', 3: '陈慧的联络·指引', 4: '陈慧的联络·终局' };
  const title = titles[stage] || ('陈慧的联络·阶段' + stage);
  const brief = String(msg || '').replace(/「滋——.*?」/g, '').replace(/\s+/g, ' ').slice(0, 120);
  return { id: 'chenhui_walkie_' + stage, title, content: brief || title, source: '对讲机' };
}

// ==================== ★ 任务系统（文档模块2：主线/支线，状态从副本 state 派生） ====================
const TASKS = [
  { id: 'main_escape', type: '主线', title: '逃离青峰山列车', desc: '找到 8 号车尾的紧急疏散通道，活着离开这列列车。' },
  { id: 'side_clue', type: '支线', title: '拼凑真相', desc: '收集列车上的线索（至少 3 条），厘清这列车上发生了什么。' },
  { id: 'side_chenhui', type: '支线', title: '联系陈慧', desc: '用对讲机联系乘务员陈慧，从她口中获取关键情报。' },
  { id: 'side_rescue', type: '支线', title: '营救陈慧', desc: '前往 7 号车设备间，救出被困在门后的陈慧。' },
  { id: 'side_shoggoth', type: '支线', title: '清除修格斯幼体', desc: '击败盘踞在 8 号车通道口的修格斯幼体，打通逃生通道。' }
];

/**
 * 依据副本实时状态计算任务状态
 * status: todo(未开始) / doing(进行中) / done(已完成)
 */
function getTasks(state) {
  const found = (state.cluesFound || []).length;
  const chenHuiRescued = !!(state.chenHui && state.chenHui.rescued);
  const walkieStage = state.walkieStage || 0;
  return TASKS.map(t => {
    let status = 'todo';
    switch (t.id) {
      case 'main_escape': status = (state.ending && state.ending.grade) ? 'done' : (state.escapeStarted ? 'doing' : 'todo'); break;
      case 'side_clue': status = found >= 3 ? 'done' : (found > 0 ? 'doing' : 'todo'); break;
      case 'side_chenhui': status = walkieStage >= 1 ? 'done' : 'todo'; break;
      case 'side_rescue': status = chenHuiRescued ? 'done' : 'todo'; break;
      case 'side_shoggoth': status = state.shoggothDefeated ? 'done' : 'todo'; break;
    }
    return { ...t, status };
  });
}

/**
 * ★ P3 副本回顾：从副本状态汇总一局探索的时间线（线索/真相/对讲机/回合/陈慧）
 * 供结算弹窗"副本回顾"区域展示，强化探索成就感与长期留存。
 */
function buildReview(state) {
  return DF.buildReview(DUNGEON_CONFIG, state);
}

// ==================== 线索收集判定 ====================
function collectClue(state, clueId, playerAttr) {
  if (state.cluesFound.includes(clueId)) {
    return { success: false, msg: '你已经收集过这条线索。' };
  }

  const per = playerAttr.per || 40;
  const str = playerAttr.str || 40;
  const wil = playerAttr.wil || 40;
  let canCollect = false;
  let msg = '';

  switch (clueId) {
    case 'L1': // 3号行李厢·护照
      canCollect = true;
      msg = '你在散落的行李箱中发现数本护照，所有人的签发日期都在废都799年——没有一本更晚的。';
      break;
    case 'L2': // 2号二等座·便签
      canCollect = per >= 50;
      msg = canCollect
        ? '一张揉皱的便签压在座椅缝隙中：「广播里说去7号车集合——但我刚刚看到7号车门外有东西在动，黑色的、像柏油一样从门缝渗进来。乘务员倒在了过道上，没人敢过去。」'
        : '你在座椅缝隙中摸到了什么，但光线太暗看不清。';
      break;
    case 'L3': // 1号驾驶室·列车长尸体
      canCollect = true;
      msg = '列车长的尸体仰倒在控制台前，颈部覆盖着半凝固的黑色粘液。尸体姿势端正、面色如生——没有腐败气味，瞳孔反光的方式不像死人。';
      // SAN判定
      if (wil < 60) {
        return { success: true, msg, sanLoss: 3, sanLossReason: '驾驶室初见' };
      }
      break;
    case 'L4': // 5号卧铺·日记第一页
      canCollect = true;
      msg = '「第三天。广播还在重复一样的话。我已经分不清哪个声音是真的……」';
      if (wil < 50) {
        return { success: true, msg, sanLoss: 5, sanLossReason: '阅读日记' };
      }
      break;
    case 'L5': // 5号卧铺·日记后页
      if (!state.cluesFound.includes('L4')) {
        return { success: false, msg: '你需要先阅读日记的前半部分。' };
      }
      canCollect = true;
      msg = '「陈姐说往7号车跑，她被困在末尾的设备间里。那地方门被卡死了，可她还在敲。去找陈姐，她知道怎么出去。」';
      if (wil < 50) {
        return { success: true, msg, sanLoss: 1, sanLossReason: '阅读日记后页' };
      }
      break;
    case 'L6': // 4号餐车·广播面板
      canCollect = per >= 55;
      msg = canCollect
        ? '广播控制面板的系统日志显示：23:47:00正常广播后，23:47:03信号被外部源劫持。自动广播系统从未恢复控制权。'
        : '控制面板的屏幕闪烁不定，你看不清系统日志。';
      break;
    case 'L7': // 陈慧本人
      canCollect = state.carStates.car_7_service.chenHuiRescued;
      msg = '陈慧告知你全部真相：米·戈伪装机制、8号车修格斯幼体潜伏位置、8号车尾唯一逃生路径。';
      break;
    case 'L8': // 3号行李厢·工程图
      canCollect = str >= 60;
      msg = canCollect
        ? '隧道工程图标注了紧急疏散通道位置在8号车尾侧壁——「掰开侧壁角阀，闭气贴地通过。注意：8号车有东西盘踞在通道口。」'
        : '工具箱锁得太紧，你无法撬开。需要更大的力量或合适的工具。';
      break;
    default:
      return { success: false, msg: '未知线索。' };
  }

  if (canCollect) {
    state.cluesFound.push(clueId);
    updateTruthTier(state);
  }

  return { success: canCollect, msg };
}

// ==================== 真相层级更新（★ 委托框架：config.truthThresholds 驱动） ====================
function updateTruthTier(state) {
  return DF.updateTruthTier(DUNGEON_CONFIG, state);
}

// ==================== 米·戈真假情报判定 ====================
function evaluateMiGoInfo(state, playerAttr, actionType) {
  const per = playerAttr.per || 40;

  if (state.truthTier >= 3) {
    return { real: false, suspect: true, msg: '[系统] 你已掌握完全真相，自动识破米·戈的伪装。' };
  }

  if (state.miGoDeceived === false) {
    return { real: false, suspect: true, msg: '[系统] 你已经知道广播不可信。' };
  }

  switch (actionType) {
    case 'hear_broadcast':
      if (per >= 65) {
        state.miGoDeceived = false;
        return { real: false, suspect: true, msg: '你注意到广播语音异常——没有呼吸停顿，没有环境混响。这是伪造的。' };
      }
      return { real: false, suspect: false, msg: null };
    case 'hear_voice':
      if (per >= 70) {
        return { real: false, suspect: true, msg: '你察觉那个"人声"没有呼吸声和环境的自然混响。' };
      }
      return { real: false, suspect: false, msg: null };
    case 'see_fake_body':
      if (per >= 55) {
        return { real: false, suspect: true, msg: '你凑近观察——尸体没有腐烂的气味，皮肤纹理过于均匀。这不是真人。' };
      }
      return { real: false, suspect: false, msg: null };
    default:
      return { real: false, suspect: false, msg: null };
  }
}

// ==================== 陈慧交互 ====================
function interactWithChenHui(state, playerAttr, action) {
  const str = playerAttr.str || 40;

  switch (action) {
    case 'knock_and_identify':
      // 敲门表明来意，自动通过
      state.carStates.car_7_service.chenHuiRescued = true;
      state.chenHui.rescued = true;
      if (!state.cluesFound.includes('L7')) {
        state.cluesFound.push('L7');
        updateTruthTier(state);
      }
      return {
        success: true,
        msg: '7号车末尾的设备间门后传来急促的敲击声，随即一个压低的女性声音：「你……你是活人吗？我是陈慧，这列车的乘务员。门被卡死了，帮帮我——」',
        chenHuiDialogue: [
          '「广播里的声音不是我们的。从昨晚开始，控制台就被外来信号接管了。」',
          '「它能模仿任何人的声音——真人说话会有呼吸、会有犹豫，但那些没有。」',
          '「黑色的东西在2号车顶上蠕动，就是它们把走廊里的人拖走了。别抬头太久。」',
          '「8号车里有幼体——那些东西的幼崽，盘踞在车尾。但唯一的逃生通道就在8号车尾侧壁。如果你们愿意带上我，我有办法让它露出一瞬的空档。」'
        ]
      };

    case 'force_door':
      if (str >= 55) {
        state.carStates.car_7_service.chenHuiRescued = true;
        state.chenHui.rescued = true;
        if (!state.cluesFound.includes('L7')) {
          state.cluesFound.push('L7');
          updateTruthTier(state);
        }
        return { success: true, msg: '你用力撞开卡死的设备间门。陈慧跌坐在地上，膝盖擦伤但目光清醒。「你是来救我的？谢谢……8号车里的东西是冲着逃生通道去的，我们得快。」' };
      }
      return { success: false, msg: '门被塌落的货架卡得死死的，你的力量不足以撬开。也许可以敲门表明来意，看看门里的人能否从里面配合。' };

    case 'join_party':
      if (!state.chenHui.rescued) {
        return { success: false, msg: '你还没找到陈慧。' };
      }
      state.chenHui.withParty = true;
      return { success: true, msg: '陈慧加入了你的队伍。她紧跟在身后，随时准备提供情报和帮助。' };

    default:
      return { success: false, msg: '未知交互。' };
  }
}

// ==================== 玩家替陈慧承伤 ====================
function coverChenHui(state, damage) {
  if (!state.chenHui.withParty || !state.chenHui.alive) return 0;
  // 消耗自身HP×2代替陈慧受伤
  const coverCost = damage * 2;
  state.chenHui.injured = false; // 成功掩护，陈慧不受伤
  return coverCost;
}

// ==================== 无形之子战斗逻辑 ====================
function fightFormlessSpawn(state, playerAttr, count) {
  const spawnData = MONSTERS.formless_spawn || { hp: 15, damageFormula: 'CON×0.3', minDamage: 3 };
  const con = playerAttr.con || 40;
  const str = playerAttr.str || 40;

  // 群体共享斥力场
  let hpPerUnit = spawnData.hpPerUnit || 15;
  if (count >= 3) {
    hpPerUnit += (spawnData.swarmBonusHp || 5);
  }

  // 单体伤害
  let baseDamage = Math.floor(con * 0.3);
  if (baseDamage < (spawnData.minDamage || 3)) baseDamage = spawnData.minDamage;

  // 群体伤害倍率
  let multiplier = 1;
  if (count >= 4) {
    multiplier = spawnData.swarmDamageMultiplier || 1.5;
  }

  const totalDamage = Math.floor(baseDamage * count * multiplier);

  // 玩家反击（徒手击退单只）
  let killedCount = 0;
  if (str >= 60) {
    killedCount = Math.min(count, Math.floor(str / 60));
  }

  const playerHpLoss = (str >= 60)
    ? Math.floor(con * 0.2 * (count - killedCount))
    : totalDamage;

  return {
    enemyCount: count,
    enemyHpEach: hpPerUnit,
    playerHpLoss: Math.max(0, playerHpLoss),
    killedCount,
    remainingCount: count - killedCount,
    swarmActive: count >= 4
  };
}

// ==================== 修格斯遭遇战 ====================
function shoggothEncounter(state, playerAttr) {
  const con = playerAttr.con || 40;
  const wil = playerAttr.wil || 40;

  state.shoggothTriggered = true;
  state.carStates.car_8_cabin.shoggothTriggered = true;
  state.shoggothTurn = 1;

  // SAN损耗
  let sanLoss = 15;
  if (wil >= 75) sanLoss = 5;

  const messages = [{
    type: 'horror',
    content: '8号车尾的黑暗中，一团只有货车车厢大小的漆黑原生质体在通道口缓缓展开——一种无法名状的巨大生物。它的表面不断鼓出又瘪下，无数半成形的眼睛与拟足在粘液中沉浮，发出潮湿的、像泥浆沸腾的声音。它堵住了唯一的逃生通道。',
    sanLoss,
    shoggothTurn: 1
  }];

  return {
    messages,
    sanLoss,
    phase1Damage: Math.floor(con * 0.3),
    phase2Damage: Math.floor(con * 0.8),
    canDefeatByLight: state.lightSources >= 3,
    defeatThreshold: 50,
    instantDeathTurn: 3
  };
}

// ==================== 逃生通道开启 ====================
function openEscapeGateway(state, playerAttr) {
  const str = playerAttr.str || 40;

  if (str >= 60) {
    state.carStates.car_8_cabin.gatewayOpened = true;
    return {
      success: true,
      turnsNeeded: 1,
      msg: '你用力扳开8号车尾侧壁的角阀，一道扭曲的光缝在金属板上撕裂开来——紧急虚空疏散通道已经开启。那个巨大的黑色粘液团在强光与缺口处退缩了一瞬。'
    };
  }

  // STR不足，需要3回合
  return {
    success: false,
    turnsNeeded: 3,
    perTurnHpLoss: 3,
    msg: '角阀锈蚀得很紧，你需要时间慢慢扳开——估计需要3个回合。注意8号车盘踞的幼体正在逼近。'
  };
}

// ==================== 毒雾伤害 ====================
function calculatePoisonDamage(playerAttr, isCrawling) {
  if (isCrawling) return 1; // 贴地移动
  return 3; // 正常站立
}


// ★ 结局结算（2026-08-16 拆分至 ./qingfengEnding）
const { calculateEnding, getEndingRewards } = require('./qingfengEnding');

// ==================== 模块导出 ====================
module.exports = {
  createDungeonState,
  processEntryBroadcast,
  collectClue,
  updateTruthTier,
  evaluateMiGoInfo,
  interactWithChenHui,
  coverChenHui,
  fightFormlessSpawn,
  shoggothEncounter,
  openEscapeGateway,
  calculatePoisonDamage,
  calculateEnding,
  getEndingRewards,
  isChenHuiAlive,
  setChenHuiAlive,
  getClueItem,
  getStarterKit,
  walkieTalkie,
  // 空间系统
  SPACES,
  getAdjacentSpaces,
  getSpaceLabel,
  getSpaceMonsters,
  MONSTERS,
  // P3 副本回顾
  buildReview,
  // P1 素材档案库映射
  getArchiveForClue,
  getMonsterArchivesForClue,
  getWalkieArchive,
  // 任务系统
  TASKS,
  getTasks
};
