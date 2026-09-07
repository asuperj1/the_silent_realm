# 克苏鲁 TRPG 全局战斗系统与行动系统 — 预设方案

> **版本**: v1.0  
> **日期**: 2026-08-06  
> **状态**: 待落地  
> **约束**: 不改动 `server/gameLogic.js`、不覆盖 KP 双频道播报、完美对接现有物品/副本/聊天系统

---

## 一、全局属性定义与数值计算公式

### 1.1 五大核心属性职能边界

| 属性标识 | 核心作用 | 固定计算公式 |
|---------|---------|------------|
| **力量 STR** | 物理攻击唯一加成属性 | `物理伤害 = 角色基础物攻 + 职业物攻系数 × STR` |
| **敏捷 AGI** | 行动次数判定（战斗+非战斗双场景，强制 Math.floor） | `行动次数 = Math.floor(自身AGI × 2 ÷ 基准AGI)` |
| **感知 PER** | 法术攻击唯一加成属性 | `法术伤害 = 技能基础法伤 + (职业法伤系数 + 技能专属系数) × PER` |
| **体质 CON** | 生命值上限计算唯一属性 | `HP上限 = 角色基础生命值 + 职业生命系数 × CON` |
| **散值 SAN** | 精神抗性，无任何伤害加成 | 无伤害计算公式，仅专属扣散技能/副本异象/剧情消耗 |

> **注**：项目现有 `config/attributes.json` 使用 `dex` 表示敏捷、`wil` 表示意志。本系统内部使用 `agi`(敏捷)、`san`(散值)，对外映射 `dex→agi`、`wil` 不参与战斗公式。

### 1.2 属性映射表（对接现有系统）

| 本系统标识 | 现有系统字段 | 说明 |
|-----------|-------------|------|
| `str` | `attr.str` | 力量，直接映射 |
| `agi` | `attr.dex` | 敏捷，来自 `attributes.json` 的 `dex` |
| `per` | `attr.per` | 感知，直接映射 |
| `con` | `attr.con` | 体质，直接映射 |
| `san` | `attr.san` | 散值/理智，直接映射 |
| `hp` | `attr.hp` | 当前生命值 |
| `maxHp` | `attr.maxHp` | 生命上限 = CON公式计算 |

---

## 二、敏捷行动次数计算细则

### 2.1 战斗场景（玩家 VS 敌人单人对战）

```
基准AGI = 对局内所有单位最高敏捷值
单单位行动次数 = Math.floor(自身AGI × 2 ÷ 基准AGI)
```

**强制校验逻辑**：
| 场景 | 敌人AGI | 玩家AGI | 敌人行动次数 | 玩家行动次数 |
|------|---------|---------|------------|------------|
| 例1 | 10 | 5 | Math.floor(10/10)=2 | Math.floor(5/10)=1 |
| 例2 | 10 | 3 | Math.floor(10/10)=2 | Math.floor(3/10)=0 |

> 例2中玩家AGI=3，行动次数=0，本回合无任何操作节点。

### 2.2 非战斗副本探索场景（多人组队模式）

```
全队最高AGI = max(队员1.AGI, 队员2.AGI, ..., 队员N.AGI)
单人行动次数 = Math.floor(个人AGI × 2 ÷ 全队最高AGI)
```

**校验示例**：队伍AGI=[4, 8, 8]，全队最高=8
- 玩家A(AGI=4): Math.floor(4/8)=**1次**
- 玩家B(AGI=8): Math.floor(8/8)=**2次**
- 玩家C(AGI=8): Math.floor(8/8)=**2次**

---

## 三、伤害结算分层强制规则

### 3.1 物理伤害通道
```
物理伤害 = attacker.基础物攻 + 职业物攻系数 × attacker.STR
最终伤害 = 物理伤害 - defender.护甲值
```
- **仅STR参与计算**，完全不关联PER、SAN
- 护甲减免 ≥ 0（最低为0，不反弹）

### 3.2 法术伤害通道
```
法术伤害 = 技能.基础法伤 + (职业法伤系数 + 技能专属系数) × attacker.PER
最终伤害 = 法术伤害 - defender.魔法抗性
```
- **仅PER参与计算**，完全不关联STR
- 魔法抗性减免 ≥ 0

### 3.3 SAN散值损耗通道
```
SAN损耗 = 仅「扣散标签」技能/异象/剧情事件可触发
```
| 操作类型 | 是否可扣SAN |
|---------|------------|
| 普通普攻 | ❌ 永不 |
| 常规伤害法术(无扣散标签) | ❌ 永不 |
| 扣散专属技能 | ✅ |
| 副本异象 | ✅ |
| 剧情事件 | ✅ |

> **SAN归零**：自动触发游戏内置疯狂剧情分支（现有系统已处理）。

---

## 四、回合时序排布固定逻辑

```
每轮流程：
1. 收集所有存活单位
2. 按行动次数从高到低排序
3. 同行动次数 → 随机打乱 (Fisher-Yates)
4. 依次为每个单位的每次行动节点提供操作选择窗口
5. 单次节点可选：普攻 / 释放技能 / 使用背包物品 / 撤退
6. 全部单位次数耗尽 → 回合结束 → 道具冷却统一 -1 → 下一轮
```

---

## 五、HP生命值兜底约束

```
当前HP ∈ [0, HP上限]
HP上限 = 角色基础生命值 + 职业生命系数 × CON
```

- 扣血不能使HP < 0（归零触发倒地救助）
- 回血不能使HP > HP上限
- HP=0 → 队友可消耗副本专属施救道具复活

---

## 六、代码分层落地规范

### 6.1 文件结构

```
src/battle/
├── AttrFormula.js    # 五大属性全量公式 + 职业系数枚举 + 技能系数枚举
├── ActionRound.js    # 敏捷比值运算 + Math.floor取整 + 回合时序排序 + 行动次数分配
├── DamageCalc.js     # 物理/法术/SAN三套独立结算 + 标签判定 + 抗性减免
└── BattleUI.js       # 战斗界面渲染：沙漏显示器 + 小队面板 + 对号标识
```

### 6.2 各文件职责

#### `src/battle/AttrFormula.js`
- 职业属性系数枚举 `PROFESSION_COEFFICIENTS`
- 技能专属系数枚举 `SKILL_COEFFICIENTS`
- `calcMaxHp(baseHp, conValue, professionCoeff)` → HP上限
- `calcPhysAtk(baseAtk, strValue, professionCoeff)` → 物理攻击力
- `calcMagicAtk(skillBaseDmg, perValue, profCoeff, skillCoeff)` → 法术攻击力
- `getProfessionCoefficients(careerId)` → 查表返回系数
- `getSkillCoefficient(skillName)` → 查表返回系数

#### `src/battle/ActionRound.js`
- `calcActionCount(unitAgi, baseAgi)` → Math.floor 单次行动次数
- `resolveBattleBaseAgi(units)` → 提取对局最高AGI
- `resolveTeamBaseAgi(teamUnits)` → 提取全队最高AGI
- `sortUnitsByActionCount(units, baseAgi)` → 排序+随机打乱
- `buildRoundTimeline(units, baseAgi)` → 生成完整时序表

#### `src/battle/DamageCalc.js`
- `calcPhysicalDamage(attacker, defender, weaponBonus)` → 物理伤害
- `calcMagicDamage(attacker, defender, skillData)` → 法术伤害
- `calcSanLoss(target, source)` → SAN损耗（仅扣散标签生效）
- `applyArmorReduction(rawDamage, armor)` → 护甲减免
- `applyMagicResist(rawDamage, resist)` → 魔法抗性减免
- `isSanDrainSource(source)` → 判断是否扣散标签

#### `src/battle/BattleUI.js`
- `renderActionCountDisplay(container, remaining, max)` → 沙漏显示器
- `renderTeamPanel(container, teamUnits)` → 小队完整信息面板
- `renderCheckmark(container, playerId, completed)` → 行动完成对号
- `clearAllCheckmarks(container)` → 清除所有对号
- `updateHpDisplay(elementId, current, max)` → 实时HP更新
- `updateSanDisplay(elementId, current)` → 实时SAN更新

### 6.3 系统兼容约束

| 约束项 | 规则 |
|--------|------|
| gameLogic.js | **只读引用**，通过 `require('../server/gameLogic')` 读取 CAREERS 等配置 |
| KP 双频道播报 | **不覆盖**，战斗结果通过 `socket.emit('battleResult')` 传递，由 socketHandler 决定频道 |
| 背包系统 | 消耗品仅在单次行动节点内使用，调用现有 `useItem()` 接口 |
| 副本系统 | 对接 `qingfengTrain.js` 的 `state` 对象，战斗状态作为 `state.battle` 子对象 |

---

## 七、强制新增UI功能

### 7.1 沙漏行动次数显示器
```
┌─────────────┐
│  ⏳ 剩余: 2  │
└─────────────┘
```
- 尺寸对标功能按钮
- 内置沙漏图标
- 实时刷新，每次操作 -1
- 归零时灰度置灰 + 不可点击

### 7.2 小队完整信息面板
```
┌──────────────────────────────────┐
│ 👤 玩家A  Lv.5  角斗士           │
│ ❤️ HP: 85/100  🧠 SAN: 60       │
│ 💪 STR:55  🏃 AGI:48  👁️ PER:40  🛡️ CON:52 │
│                                  │
│ 👤 玩家B  Lv.3  方士    ✅      │
│ ❤️ HP: 60/60   🧠 SAN: 75       │
│ 💪 STR:42  🏃 AGI:65  👁️ PER:55  🛡️ CON:40 │
└──────────────────────────────────┘
```
- 常驻展示（组队副本/战斗均显示）
- 实时HP当前值/上限、SAN当前值
- 四大属性完整数值 (STR/AGI/PER/CON)

### 7.3 行动完成对号标识
- 白色 ✓ 对号，出现在队员信息栏右侧
- 本轮全部行动次数耗尽后自动显示
- 回合结束统一清除，下轮重新计算
- 动画：scale(0)→scale(1) 弹出效果

---

## 八、验收自检清单

- [ ] 全部属性计算公式 1:1 匹配本文档
- [ ] 敏捷比值全程 Math.floor()，无四舍五入/向上取整
- [ ] 普攻、无扣散标签法术永不触发SAN扣除
- [ ] 单人战斗取敌方+玩家最高AGI，多人组队仅取全队最高AGI
- [ ] HP上限仅由CON公式计算，无其他渠道修改
- [ ] 对接青峰山虚空列车副本专属装备/施救道具/扣散异象
- [ ] 沙漏显示器完整实现
- [ ] 小队属性面板完整实现
- [ ] 行动完成对号标识完整实现
- [ ] gameLogic.js 未被修改
- [ ] KP双频道播报未被覆盖
