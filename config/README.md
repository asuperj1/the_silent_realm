# 📦 config/ — 数据配置中心

> 游戏战斗 / 职业 / 物品 / 场景等**数据驱动配置**（JSON）。修改配置即可调整数值与规则，无需改引擎代码。

## 📋 配置清单

| 文件 | 内容 |
| --- | --- |
| `battle_roles.json` | **13 职业战斗配置**：定位 / 主属性 / 能量骰 / 资源（active·passive·mix）/ 获取消耗规则 / 特殊机制（passive）/ 特殊技能 |
| `skill_battle.json` | **技能战斗配置**（264 个）：ap / cd / target / type / element / damage(hits) / heal / block / effects |
| `skill_tree.json` | **职业技能树**：流派（schools）+ 技能 + innate 必备技能（开局常驻） |
| `battle_monsters.json` | 怪物：无形之子 / 聚合无形之子 / 原始修格斯 / 米·戈（hp·def·intents 意图） |
| `professions.json` | 职业总表：属性 / 能量骰 / 技能 / 图标 |
| `attributes.json` | 基础属性定义 |
| `character_skill.json` | 角色技能（默认配置） |
| `scenes.json` | 场景配置 |
| `api.js` | 配置 API 入口（供前端 `/api/*` 读取） |
| `kp_filter.json` | KP 敏感词过滤配置 |
| `items/` · `dungeons/` | 物品模板 / 副本清单 |

## ⚔️ 战斗数据速览

- **13 职业**：方士 · 观星者 · 环法师 · 炼金术师 · 角斗士 · 骑士 · 百夫长 · 海盗 · 枪手 · 侦探 · 武士 · 诡术小丑 · 警官
- **资源类型**：`active`（技能消耗）/ `passive`（自动触发）/ `mix`（被动累积+主动消耗）
- **元素**：physical / arcane / shadow / fire / holy / earth / poison / ice / lightning
- **技能 target**：single / all / allies；伤害支持多段 `hits`

## 🔧 维护约定

- 职业机制（如武士架势条 / 百夫长五段战姿）在 `battle_roles.json` 的 `passive.trigger` 定义，由 `server/battleEngine.js` 消费。
- 必备技能（innate）在 `skill_tree.json` 对应职业下定义，由 `server/skillTree.js` 下发、`server/battleCore.js` 强制常驻出战。
- 战斗数值公式见 [`docs/BATTLE_SYSTEM_PRESET.md`](../docs/BATTLE_SYSTEM_PRESET.md) 与 [`docs/职业战斗系统手册.md`](../docs/职业战斗系统手册.md)。

> 引擎侧消费见 [`server/README.md`](../server/README.md)。
