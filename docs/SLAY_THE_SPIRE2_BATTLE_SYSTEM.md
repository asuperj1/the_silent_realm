# 杀戮尖塔 2 式战斗系统设计（以技能 / 普攻 / 装备 / 消耗品为准）

> **版本**: v1.0  
> **日期**: 2026-08-15  
> **状态**: 待评审 → 分阶段落地  
> **依据**: 现有「战斗行为系统 1.0」（C++ `battle_engine` + `actionSystem.js`）、`BATTLE_SYSTEM_PRESET.md`、13 职业技能树、六槽装备 ItemEngine、EffectEngine、克苏鲁未知恐惧怪物锁定  
> **核心变更**: 把「技能/普攻/装备/消耗品」从 **KP 叙事驱动** 改为 **引擎数值结算**，并引入杀戮尖塔 2 的**回合结构、敌人意图、格挡、状态（buff/debuff）** 三大支柱。

---

## 0. 一句话概述

> 战斗是一套**回合制数值博弈**：每回合玩家获得行动点（AP），用 **技能 / 普攻 / 消耗品** 执行行动，**装备** 提供常驻属性与战斗被动；怪物头顶**显示意图**（攻击 / 防御 / 施法），玩家据此规划；**格挡**与**状态（增益 / 减益 / 中毒）** 在回合边界结算。战斗内数值完全由引擎裁决，KP 退居「叙事旁白 + 场外判定」角色。

---

## 1. 设计目标与核心原则

### 1.1 设计目标
| # | 目标 | 衡量 |
|---|------|------|
| G1 | 战斗数值化、可计算、可预测 | 技能/普攻/装备/消耗品都有确定数值结算，无骰子玄学 |
| G2 | 策略深度（杀戮尖塔式） | 敌人意图可见、能量有限、状态管理、装备搭配 |
| G3 | 保留克苏鲁 TRPG 特色 | 怪物真名锁定、SAN 资源、KP 叙事与判定、探索/战斗无缝切换 |
| G4 | 契合现有代码与数据 | 复用 `battle_engine`、`EffectEngine`、技能树、六槽装备、掉落 |

### 1.2 核心原则
1. **以技能/普攻/装备/消耗品为唯四行动来源**：战斗中没有"自由发挥"，只有这四类可执行操作（撤退/结束除外）。
2. **引擎裁决，KP 润色**：数值结算（伤害/治疗/状态）由引擎执行并广播；KP 只对结果做叙事包装与场外属性判定。
3. **战斗内不掷判定骰**：延续现有「全程无骰子，属性阈值比较」规则；能量获得保留职业能量骰特色（见 §3）。
4. **回合边界统一结算**：状态衰减、格挡清零、dot 伤害、装备回合被动都在固定时间点结算，杜绝时序歧义。

---

## 2. 战斗回合结构

### 2.1 宏观流程
```
battleStart（进入战斗）
   ├─ 初始化战场：玩家状态快照、怪物满血、回合 = 1、全方格挡 = 0、状态清空
   ├─ 玩家回合开始（battleTurn）
   │    ├─ ① 结算【回合开始】事件（按固定顺序，见 §2.3）
   │    ├─ ② 获得本回合行动点（AP = 职业能量骰结果）
   │    ├─ ③ 广播敌人意图（battleIntent）
   │    └─ ④ 等待玩家行动（battleAction：普攻/技能/消耗品/结束）
   ├─ 玩家行动循环（能量充足可连续行动）
   │    ├─ 执行行动 → 引擎结算 → 广播 battleEvent
   │    └─ 若怪物全灭 / 全员阵亡 / 撤退 → battleEnd
   ├─ 玩家回合结束（主动结束 或 AP 不足）
   ├─ 敌人回合（battleEvent type=monster）
   │    ├─ ① 每个存活怪物按【意图】行动（攻击/防御/施法）
   │    ├─ ② 结算玩家持伤（中毒等 dot）
   │    └─ ③ 玩家格挡清零（杀戮尖塔规则）
   ├─ 回合 +1
   └─ 回到「玩家回合开始」（意图重掷/轮换）
```

### 2.2 关键时间点（时序协议）
| 时间点 | 触发内容 | 结算顺序 |
|--------|---------|---------|
| **T0 战斗开始** | 应用装备/被动的 `onBattleStart`；怪物抽取首个意图 | 玩家被动 → 怪物意图 |
| **T1 玩家回合开始** | `onTurnStart` 被动；dot 扣血（先结算持伤）；清玩家格挡；获得 AP；刷新意图 | 持伤 → 清格挡 → 回 AP → 意图 |
| **T2 玩家行动** | 执行普攻/技能/消耗品；`onAttack/onUseSkill/onUseItem` 词条联动 | 按技能效果数组顺序 |
| **T3 敌人回合** | 每个怪物按意图行动；怪物格挡清零 | 按怪物 index 顺序 |
| **T4 回合结束** | 状态回合数衰减；buff/debuff 到期移除；回合 +1 | 玩家状态 → 怪物状态 |

> 格挡规则采用杀戮尖塔：**格挡是临时值**，玩家格挡在 T1 清零（防溢出）、怪物格挡在 T3 清零。

### 2.3 事件协议（Socket 广播）
沿用并扩展现有事件，新增 `battleIntent`：

| 事件 | 方向 | 载荷 | 说明 |
|------|------|------|------|
| `battleStart` | server→all | `{status, intents}` | 战斗开始，含意图初始 |
| `battleTurn` | server→all | `{for, ap, apDice, intents, status}` | 轮到某玩家，广播其 AP 与全部意图 |
| `battleIntent` | server→all | `{intents}` | 意图刷新（敌人施法前/换回合） |
| `battleAction` | client→server | `{action, skillId?, itemUid?, targetIdx?}` | 玩家行动 |
| `battleEvent` | server→all | `{sid?, type, msg, dmg?, heal?, block?, statusChanges?, status}` | 每次行动/敌人行动的结算结果 |
| `battleEnd` | server→all | `{win, msg, reward?}` | 结束（含战利品掉落） |

---

## 3. 能量体系（行动点 AP）

### 3.1 设计取向
- 杀戮尖塔：每回合固定 3 点能量，卡牌 0~3 费。
- 本项目保留**职业能量骰**特色（克苏鲁随机性），但**收敛数值量级**，避免现有 3D6（3~18）导致的无限倾泻。

### 3.2 规则
- 每回合 AP = **职业能量骰结果**，骰面标准化：
  - 常规职业：`1D6+2`（3~8）
  - 高机动/爆发职业（武士/诡术小丑/警官）：`2D4+2`（4~10）
  - 法系（炼金/环法）：`1D8+2`（3~10）
  - 肉盾（角斗士/骑士）：`1D6+1`（2~7）
- AP 上限 10，不跨回合累计。
- 装备/技能可提供「+AP」「回 AP」词条（如 `onTurnStart → ap+1`）。

### 3.3 行动费用
| 行动 | 费用 | 说明 |
|------|------|------|
| **普攻** | 1 | 基础攻击 |
| **技能** | 1 ~ 3 | 按技能强度（普攻的 1.2~3 倍强度） |
| **消耗品** | 0 ~ 1 | 药水 0（仍算一次行动）、手雷类 1 |
| **结束回合** | 0 | 主动结束 |

> 每回合 AP 只够 2~5 次行动（杀戮尖塔的「能量有限 → 策略取舍」）。

---

## 4. 伤害与防御结算链（唯一公式）

### 4.1 属性到战斗面板
沿用现有前端 `getCombatStats` 映射，作为服务端权威（迁入引擎）：
```
物攻 physAtk = 8 + STR × 定位系数
法攻 magAtk  = 8 + (PER+WIL)/2 × 定位系数
物防 physDef = 6 + CON × 定位系数
法防 magDef  = 6 + (PER+WIL)/2 × 定位系数
穿透 pierce  = STR × 定位系数
格挡 blockBonus = DEX × 定位系数
护盾 shieldBase = WIL × 定位系数
```
> 定位系数（坦克/战士/刺客/法师）沿用 `ROLE_RATIO`，并作为服务端配置 `config/battle_roles.json`。

### 4.2 伤害结算链（按序执行，缺省 0）
```
① 基础伤害 = 技能/普攻的 base（技能白字）
② 攻击加成 = attack × ratio（物理用 physAtk，法术用 magAtk）
③ 力量修正 = (1 + 力量×0.10)                     // 力量状态：每层 +10% 伤害
④ 易伤修正 = × (1 + 0.5 × 易伤层数)              // 易伤：每层受伤害 +50%
⑤ 护甲减免 = max(0, 防御 × (1 − 穿透%))          // 穿透降低护甲生效比例
⑥ 格挡吸收 = min(block, 计算到 ⑤ 的伤害)         // 先扣格挡
⑦ 最终 HP 伤害 = max(1, 伤害 − 护甲减免 − 格挡)
```
- **真实伤害 trueDmg**：跳过 ③④⑤，仅扣格挡。
- **毒素/灼烧 dot**：按层数 × 每层固定值，无视防御，仅被「免疫」类状态抵消。

### 4.3 护盾（吸收盾）与格挡（临时甲）
| 机制 | 来源 | 结算 | 清零 |
|------|------|------|------|
| **格挡 block** | 技能防御技/装备词条 | 承受伤害优先扣 | T1/T3 清零 |
| **护盾 shield** | 装备/技能/被动 | 在格挡之后、HP 之前吸收 | 不自动清零，受击消耗 |

---

## 5. 技能系统（核心数值化改造）

### 5.1 现状问题
技能（`useSkill`）目前只扣 5 SAN + 推进回合 + CD，**效果由 KP 口头叙述，无数值结算** → 战斗不可预测、装备/属性无意义。

### 5.2 新技能 Schema（标准数据模型）
```json
{
  "id": "fu_lu_zhen_xie",
  "name": "符箓镇邪",
  "career": "fangshi",
  "school": "符咒",
  "grade": "normal",
  "icon": "📜",
  "ap": 2,                       // 能量费用（1~3）
  "type": "attack",              // attack | defense | heal | control | buff | utility
  "target": "single",            // single | all | self | allies
  "element": "holy",             // physical | holy | corrosion | explosion | burn | true
  "damage": { "base": 12, "scale": "magAtk", "ratio": 0.6 },
  "heal":   { "base": 0, "scale": "magAtk", "ratio": 0.4 },
  "block":  8,                   // 直接获得格挡
  "effects": [                   // 追加状态（§10）
    { "id": "vulnerable", "value": 2, "turns": 2 },
    { "id": "immobilize", "turns": 1 }
  ],
  "cd": 2,                       // 回合冷却（0 = 无）
  "sanCost": 0,                  // 新增：技能可改为消耗 SAN 而非纯能量
  "desc": "投掷封印符箓，单体神圣伤害并施加易伤 2 层"
}
```

### 5.3 技能效果字段字典（标准化）
| 字段 | 类型 | 说明 |
|------|------|------|
| `damage.base` | number | 固定白字伤害 |
| `damage.scale` | `physAtk`\|`magAtk` | 加成面板 |
| `damage.ratio` | 0~2 | 面板加成比例 |
| `damage.hits` | int | 段数（多段触发多次 onAttack） |
| `heal` | object | 同 damage 结构（用 magAtk 或固定） |
| `block` | number | 给目标（默认自己）加格挡 |
| `effects[]` | array | 施加状态（§10 状态表） |
| `ap` | int | 能量费用 |
| `cd` | int | 回合冷却 |
| `sanCost` | int | SAN 消耗（部分禁忌技能） |

### 5.4 技能来源与生成
1. **旧职业**（`professions.json` skills）：把现有 `effect` 对象**迁移/标准化**为上述 schema（自动迁移脚本：`holyDmg→damage.base+element:holy` 等）。
2. **新职业**（`skill_tree.json` 13 职业×3 流派）：为每个技能**补全战斗数值**——生成 `config/skill_battle.json`（skillId → 完整战斗 schema），按品级定基准（normal 白字 8~14 / good 14~22 / epic 22~34 / s 34~50）。
3. 技能 CD 由「秒」改为「回合」（现有 `cooldownToTurns` 已实现）。

### 5.5 被动技能
- 职业被动（`passive`）+ 装备被动在 T0 战斗开始注册为**常驻被动**，在 `onTurnStart / onAttack / onHurt / onKill` 等触发点生效（见 §7.3）。

---

## 6. 普攻

### 6.1 规则
- 费用 1 AP，可无限次（只要 AP 够）。
- 目标：敌方单体（可多段）。
- 伤害公式：`base 4 + 主攻面板 × 0.5`（物理职业用 physAtk，法系职业用 magAtk）。
- 触发 `onAttack` 词条。

### 6.2 普攻强化来源（成长路径）
- 装备词条（如「普攻伤害 +6」「普攻附带 1 层中毒」）。
- 状态力量（普攻吃力量加成）。
- 武器（weapon 槽）数值 = 普攻主要成长。

---

## 7. 装备系统（常驻属性 + 战斗被动）

### 7.1 现状
装备 `onEquip` stat 词条已实现（六槽），但**战斗中没有主动/被动行为**。

### 7.2 常驻属性（保留现有）
- 六槽（weapon/head/body/hand/foot/accessory），`EffectEngine.computePassiveBonus` 叠加进属性。

### 7.3 战斗被动词条（新增，杀戮尖塔「遗物」式）
装备 `effects[]` 新增 `trigger` 字段，在战斗时间点自动触发：

| trigger | 触发时机 | 示例词条 |
|---------|---------|---------|
| `onBattleStart` | T0 | 「战斗开始获得 6 格挡」 |
| `onTurnStart` | T1 | 「每回合开始 +1 力量」 |
| `onAttack` | 普攻/技能命中后 | 「攻击附带 1 层中毒」 |
| `onHurt` | 受击后 | 「受击回复 2 HP」 |
| `onKill` | 击杀敌人后 | 「击杀 +2 能量（回 2 AP）」 |
| `onBattleEnd` | 战斗结束 | 「胜利回复 10 HP」 |

**示例**（追加到装备实例 `effects`）：
```json
{ "trigger": "onTurnStart", "kind": "buff", "stat": "strength", "value": 1, "turns": 1 }
{ "trigger": "onAttack", "kind": "debuff", "stat": "poison", "value": 1, "turns": 3 }
```

### 7.4 品质影响
装备品质（白→红）决定战斗词条**数量与数值**：白 0~1 条 / 绿 1 条 / 蓝 2 条 / 紫 2~3 条 / 橙 3 条 / 红 3~4 条（数值随品质放大）。

---

## 8. 消耗品（战斗行动）

### 8.1 规则
- 战斗中可从快捷栏/背包**直接使用消耗品**（`battleAction {action:'item', itemUid}`）。
- 费用 0（药水）/ 1（投掷类伤害道具）。
- 结算复用 `EffectEngine.useItem`，效果在战斗上下文执行（`hp/san/stat buff/shield/damage/statusEffects`）。
- 战斗中**最多每回合使用 1 个消耗品**（策略取舍，防无限吃药）。

### 8.2 战斗效果示例
| 物品 | 战斗效果 |
|------|---------|
| 浓血 | HP +35（即时） |
| 力量药水 | +10 力量 2 回合（复用 `itemBuffs`） |
| 急救包 | HP +20 |
| 手雷 | 全体 12 真实伤害 + 1 AP |

---

## 9. 敌人意图系统（杀戮尖塔核心）

### 9.1 概念
每个怪物每回合头顶显示**意图**：即将执行的行动（攻击 / 防御 / 施法）。玩家看到后规划：集火 / 打格挡 / 防守。

### 9.2 意图数据模型
```json
{
  "type": "formless",
  "name": "无形之子",
  "hp": 15, "maxHp": 15,
  "dex": 15,
  "def": 3, "magDef": 2,          // 防御面板
  "intents": [                     // 意图循环（按序轮换 / 可随机）
    { "move": "attack", "label": "撕咬", "dmgBase": 4, "scale": "physAtk", "ratio": 0.4, "hitAll": false },
    { "move": "block",  "label": "蠕动护体", "block": 6 },
    { "move": "buff",   "label": "狂暴化", "self": { "id": "strength", "value": 1, "turns": 1 } },
    { "move": "debuff", "label": "粘液喷吐", "target": "all", "effect": { "id": "weak", "value": 1, "turns": 1 } }
  ],
  "loot": "formless_spawn"
}
```
- `move`: `attack | block | buff | debuff | summon | charge`（charge=蓄力，下回合大伤害）
- 意图**每回合切换**：默认按数组顺序循环；狂暴/蓄力敌人可随机。

### 9.3 意图结算
- **玩家回合开始（T1）**：广播当前意图（`battleIntent`）。
- **敌人回合（T3）**：每个怪物执行其意图 → 结算 → 广播 `battleEvent type=monster`（含 dmg/block/statusChanges）。
- 意图执行后：`attack` 类切换下一意图；`charge` 类蓄力一回合后执行强攻。

### 9.4 意图 UI（杀戮尖塔 2 样式）
怪物立绘**头顶气泡**显示：
```
  [⚔ 撕咬 8]        ← 攻击意图（红色，含预估伤害）
  [🛡 格挡 6]        ← 防御意图（蓝色）
  [✨ 狂暴 +1力]     ← 施法意图（金色）
```
- 意图气泡跟随立绘，战前即可见（未解锁真名的怪物用「？？？」占位，但仍显示意图图标与数值——克苏鲁锁只锁名字，不锁行为）。

---

## 10. 格挡与状态系统（buff / debuff）

### 10.1 状态标准表
| 状态 id | 类型 | 效果 | 结算点 |
|---------|------|------|--------|
| `strength` 力量 | buff | 伤害 +10%/层 | 伤害计算时 |
| `weak` 脆弱 | debuff | 攻击 -25%/层 | 攻击时 |
| `vulnerable` 易伤 | debuff | 受伤害 +50%/层 | 受击时 |
| `poison` 中毒 | debuff | 每回合扣 2×层数（无视防御） | T1/T3 持伤 |
| `burn` 灼烧 | debuff | 每回合扣 3×层数 | T1/T3 持伤 |
| `blockUp` 格挡增强 | buff | 获得格挡 +50% | 获得格挡时 |
| `dexUp` 敏捷 | buff | 闪避率 +10%/层 | 受击时 |
| `immobilize` 禁锢 | control | 无法行动 1 回合 | 行动时 |
| `stun` 眩晕 | control | 跳过回合 | 行动时 |
| `regen` 再生 | buff | 每回合回复 3×层数 HP | T1/T3 |
| `shield` 护盾 | buff | 吸收伤害（§4.3） | 受击时 |

### 10.2 状态存储与衰减
- 状态挂在战斗单位上（引擎内 `statuses[]`），**不写入角色存档**（战斗结束丢弃，避免污染）。
- 衰减：T4 回合结束，所有 `turns` 减 1，归零移除。
- `turns` 语义：施放当回合不计，下一回合开始计数（与现有技能 CD 一致）。

### 10.3 SAN 资源（克苏鲁保留项）
- 战斗外保留 SAN 判定与异象扣 SAN。
- 战斗内：技能 `sanCost` 可扣 SAN 换强效；SAN 归零进入疯狂（战斗减益：随机 `weak` 或攻击自己人概率）。

---

## 11. 数据模型汇总

### 11.1 技能战斗配置 `config/skill_battle.json`
```json
{
  "fangshi": {
    "passive": { "id": "xuan_yuan_qi_ji", "name": "玄元炁击", "trigger": "onTurnStart", "effect": { "block": 2 } },
    "skills": {
      "符箓镇邪": { "ap": 2, "type": "attack", "element": "holy", "damage": {"base": 12, "scale": "magAtk", "ratio": 0.6}, "effects": [{"id": "vulnerable", "value": 1, "turns": 2}], "cd": 2 },
      "丹雾护佑": { "ap": 2, "type": "heal", "heal": {"base": 12, "scale": "magAtk", "ratio": 0.4}, "block": 4, "cd": 3 }
    }
  }
}
```

### 11.2 怪物战斗配置 `config/battle_monsters.json`
```json
{
  "formless_spawn": { "hp": 15, "dex": 15, "def": 3, "magDef": 2, "intents": [...见 §9.2...], "loot": "formless_spawn" }
}
```
> 从 `data/character_skill.json` 迁移怪物数值，新增 `def/intents`。

### 11.3 角色战斗快照（进入战斗时生成，不动存档）
```json
{ "sid": "...", "name": "测试调查员", "career": "fangshi", "role": "法师",
  "hp": 80, "maxHp": 80, "san": 100,
  "physAtk": 22, "magAtk": 52, "physDef": 20, "magDef": 40, "pierce": 11, "blockBonus": 8, "shieldBase": 22,
  "ap": 0, "block": 0, "statuses": [], "buffs": [],
  "passives": [...装备+职业被动...], "skills": [...出战技能战斗配置...] }
```

---

## 12. 前端 UI 设计（杀戮尖塔 2 风格）

### 12.1 布局（沿用现有战斗场景 `#battleScene`）
```
┌─────────────────────────────────────────────┐
│  战斗背景（车内/隧道）                          │
│  ┌────────┐                    ┌─────────┐  │
│  │ 玩家立绘 │   [⚔撕咬8]        │ 怪物立绘 │  │  ← 怪物头顶意图气泡
│  │ 名字/HP │   [🛡格挡6]        │ 名字/HP  │  │
│  │ 状态图标 │                    │ 状态图标 │  │
│  └────────┘                    └─────────┘  │
│  [能量池 AP 5/5]  [普攻] [技能Q][技能W][技能E]  │  ← 下方行动条（战斗模式）
│  [快捷栏消耗品 ①②③]  [结束回合]               │
└─────────────────────────────────────────────┘
```

### 12.2 新增 UI 元素
| 元素 | 说明 |
|------|------|
| **意图气泡** | 怪物立绘正上方，`⚔红/🛡蓝/✨金` 图标 + 数值；未解锁怪物显示「？？？」图标但保留数值 |
| **AP 能量池** | 复用现有能量球，显示 `AP 当前/上限`，行动后实时扣减 |
| **状态图标** | 立绘下方小图标排（力量💪/易伤💢/中毒☠/格挡🛡），hover 显示剩余回合 |
| **技能费用角标** | 技能格左上角显示 AP 费用，AP 不足时灰锁 |
| **格挡条** | HP 条上方叠加蓝色格挡条（有格挡时显示） |
| **结束回合按钮** | 战斗条右侧（现有） |

### 12.3 交互流程
1. `battleTurn`（轮到自己）→ 解锁行动条，能量池显示 AP。
2. 点击技能/普攻 → 若 AP 足够 → 发送 `battleAction` → 本地乐观扣 AP → 服务端结算广播。
3. 点击消耗品 → `battleAction {action:'item'}` → EffectEngine 结算。
4. 「结束回合」→ `battleAction {action:'end'}` → 进入敌人回合。

---

## 13. 与现有系统对接

### 13.1 引擎层（`native/battle_engine.cc` + `actionSystem.js`）
- 保留 C++ 状态机骨架，扩展：
  - `battleStart` 增加意图初始化、被动注册。
  - `battlePlayerAct` 增加技能/消耗品分支（按 skillId/itemUid 查配置结算）。
  - 新增 `battleIntent(roomId)`、`battleApplyStatus` 内部函数。
  - 新增 `battleSkillDef` / `battleMonsterDef` 数据注入。
- JS fallback 同步实现（双引擎同接口）。

### 13.2 handler 层（`battleHandler.js`）
- `battleAction` 事件扩展：接收 `{action, skillId, itemUid}`，传入引擎。
- `useSkill`（旧 KP 叙事）保留为**非战斗/场外**技能使用；战斗内技能走 `battleAction skill`。
- 新增 `battleIntent` 广播；`battleTurn` 载荷增加 `ap/intents`。
- 战斗结束：胜 → 现有掉落 + 可选战利品（克苏鲁版「三选一」= 品质随机掉落，见 §13.6）。

### 13.3 前端（`client.js` / `battleScene.js`）
- `battleTurn` → 更新 AP 池、技能费用灰锁、意图气泡。
- `battleEvent` → 血条/格挡/状态实时更新（`BattleScene.updateStatus` 扩展 statuses/block/intents）。
- 行动发送统一走 `#sendAction` 或战斗条按钮。

### 13.4 探索回合值（共存）
- 战斗是探索的**插曲**：进入有怪空间 → 暂停探索回合值，切换战斗模式；战斗结束 → 恢复探索。
- 战斗内行动**不消耗探索回合值**（避免双资源冲突）；战斗胜利可奖励少量探索回合值（如 +0.25，即"战斗耗时"）。

### 13.5 克苏鲁未知恐惧锁
- 怪物**名字/描述**仍受 `CLUE_MONSTER_LOCK` 锁定（未解锁显示「柏油状黑色形体」）。
- **意图行为与数值不锁定**（可观察、可预测，保策略性）。
- 解锁线索后：意图气泡 + 描述 + 名字全部揭示。

### 13.6 战利品（杀戮尖塔「战后选择」简化版）
- 战斗胜利 → 掉落池（现有 `dungeonRollLoot`）。
- 进阶：精英/BOSS 战 → 「三选一战利品」（品质随机：1 件保底 + 2 件随机），选中入背包。

---

## 14. 实施计划（分阶段）

### P0 — 引擎数值结算（骨架，可玩）
- [ ] 技能战斗配置 `config/skill_battle.json`（先补 13 职业被动 + 每流派 2~3 个主力技能）
- [ ] 怪物配置 `config/battle_monsters.json`（迁移 + 意图）
- [ ] `battle_engine` 扩展：技能/普攻/消耗品按配置结算（伤害链 §4）
- [ ] `battleHandler`：`battleAction` 接技能/物品；广播 `battleEvent` 带数值
- [ ] 前端：技能费用灰锁 + AP 池 + 伤害飘字

### P1 — 敌人意图 + 格挡 + 状态
- [ ] 意图数据 + `battleIntent` 广播 + 意图气泡 UI
- [ ] 格挡机制（T1/T3 清零）+ 格挡条 UI
- [ ] 状态系统（strength/weak/vulnerable/poison/burn/immobilize）+ 状态图标 + T4 衰减

### P2 — 装备战斗被动 + 消耗品战斗化
- [ ] `onBattleStart/onTurnStart/onAttack/onHurt/onKill/onBattleEnd` 词条引擎
- [ ] 消耗品战斗行动（`battleAction item` + 每回合 1 个限制）
- [ ] 战利品「三选一」

### P3 — 数值平衡 + 克苏鲁融合
- [ ] 13 职业×3 流派全技能补数值并平衡
- [ ] 精英/BOSS 意图循环设计（修格斯 phase 蓄力、米戈召唤）
- [ ] SAN 疯狂机制、战斗内 SAN 消耗技能
- [ ] 端到端测试（单机 + 多人）+ 数值表校准

---

## 15. 附录

### 15.1 13 职业定位表（技能费用基准）
| 职业 | 定位 | 主攻面板 | 能量骰 | 技能费 |
|------|------|---------|--------|--------|
| 方士 | 法师 | magAtk | 1D8+2 | 2~3 |
| 角斗士 | 战士 | physAtk | 1D6+1 | 1~2 |
| 海盗 | 战士 | physAtk | 1D6+2 | 1~2 |
| 枪手 | 刺客 | physAtk | 2D4+2 | 1~2 |
| 骑士 | 坦克 | physAtk | 1D6+1 | 2~3 |
| 观星者 | 法师 | magAtk | 1D8+2 | 2~3 |
| 环法师 | 法师 | magAtk | 1D8+2 | 2~3 |
| 炼金术师 | 法师 | magAtk | 1D8+2 | 1~2 |
| 侦探 | 刺客 | physAtk | 2D4+2 | 1~2 |
| 百夫长 | 坦克 | physAtk | 1D6+1 | 2~3 |
| 武士 | 战士 | physAtk | 2D4+2 | 1~2 |
| 诡术小丑 | 刺客 | magAtk | 2D4+2 | 1~2 |
| 警官 | 战士 | physAtk | 2D4+2 | 1~2 |

### 15.2 效果字段迁移映射（旧 effect → 新 schema）
| 旧字段 | 新字段 |
|--------|--------|
| `physDmg` | `damage.base` + `element:physical` |
| `holyDmg` | `damage.base` + `element:holy` |
| `magDmg` | `damage.base` + `element:magic` |
| `corrosionDmg/explosionDmg/burnDmg` | `damage.base` + 对应 `element` |
| `healAll/heal` | `heal.base` + `target:all/allies` |
| `immobilize: N 秒` | `effects:[{id:immobilize, turns:ceil(N/5)}]` |
| `armorShred/armorPen` | `pierce` 或 `effects:[{id:armorShred,...}]` |

---

*设计完稿 · 待评审确认后按 P0→P3 实施。*
