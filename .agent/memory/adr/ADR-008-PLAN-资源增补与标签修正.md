# ADR-008-PLAN · 资源增补与标签修正（resource.json）

**状态**：`accepted`（2026-08-07 已批准，决策确认：方尖碑不纳入、wil_icon 纳入、扣散异象按原文；任务计划见 ADR-009，已全部完成）
**创建日期**：2026-08-07
**澄清人**：clarifier 子 Agent
**改动边界**：仅 `resource.json`（注册表）；**禁止修改任何源码**；物理图片由用户另行提供，不在本次代码交付内。

---

## 一、现状核实（基于源码）

| 项目 | 核实结果 |
|---|---|
| resource.json | 恰 **24 条**：11 个 bg 场景 + 2 个 ui 底板 + 7 个图标 + placeholder 占位 |
| ResourceManager | `server/gameLogic.js` L84-103 `matchResource(tags)` 启动时整读 resource.json，按标签交集打分返回 `url`；**新增/改标签无需改代码** |
| twisted_space / rift_edge | 已存在，tags 无 SAN 专属标签 |
| 物理文件 | `assets/bg|ui|icons` 下**无任何 PNG**（现有条目同），全部为外部素材 |

## 二、需求范围

1. 新增 **5 个资源**（resId 均符合 `功能_类型_标识`，小写下划线，无中文）。
2. 对现有资源**追加标签（不删除、不改 url）**，涉及 14 个场景背景 + 6（或 7）个图标 + 1 个 UI 底板。
3. 分类规整：`bg/`=场景、`effect/`=特效、`icons/`=图标、`ui/`=底板；**不改任何已有 url 路径**。
4. 联动规则（作为后续实现依据，本期仅注册）。
5. 验收标准见第五节。

## 三、新增资源清单（5 条）

| resId | url | 建议 tags（用户未给，本次补全） | 用途 |
|---|---|---|---|
| `hourglass_action_icon` | `./assets/icons/hourglass.png` | `["行动次数","图标","战斗面板"]` | 行动次数图标，0 时灰度 |
| `check_done_icon` | `./assets/icons/check_done.png` | `["完成标记","对勾","图标","战斗面板"]` | 行动完成对勾 |
| `panel_team_bg` | `./assets/ui/panel_team_bg.png` | `["UI","面板","底板","小队信息","战斗面板"]` | 小队信息面板底板 |
| `down_icon` | `./assets/icons/down.png` | `["倒地","HP归零","图标","战斗面板"]` | HP=0 倒地救助 |
| `mad_icon` | `./assets/icons/mad.png` | `["疯狂","SAN归零","图标","战斗面板"]` | SAN=0 疯狂状态 |

> 无 resId 冲突；目录约束：4 个进 `icons/`、1 个进 `ui/`，符合规范。

## 四、标签追加明细（逐条，追加不删除）

**A. 14 个场景背景**（url 均 `./assets/bg/`，**排除** `placeholder_dark`）→ 追加 `["副本场景","可触发SAN损耗","战斗切换背景"]`：

`village_night`、`hospital_corridor`、`ocean_ship`、`roman_arena`、`abandoned_house`、`cave_dark`、`submarine_station`、`lab_ruins`、`city_ruins`、`twisted_space`、`tunnel_crypt`、`village_house`、`altar_ruin`、`rift_edge`

**B. 高 SAN 专属**（在上述 A 基础之上追加）→ `twisted_space`、`rift_edge` 追加 `["扣散异象","高SAN消耗场景"]`（即这两条合计 +5 个新标签）

**C. 属性/生命图标**（6 条）→ `hp_icon`、`san_icon`、`str_icon`、`dex_icon`、`con_icon`、`per_icon` 追加 `["战斗面板","小队信息"]`

> ⚠ **待拍板**：`wil_icon` 未在清单内，但五大属性含 wil 且小队面板显示意志，推荐一并追加（若严格按清单则排除）。

**D. UI 底板** → `panel_attr_bg` 追加 `["单人属性面板","战斗属性弹窗"]`（与 `panel_team_bg` 区分单/小队）

## 五、联动规则（本期仅注册，不实现）

| 场景 | 资源 |
|---|---|
| 小队信息面板 | 底板 `panel_team_bg` + `hp_icon`/`san_icon`/五大属性图标 |
| 行动次数 | `hourglass_action_icon`（次数=0 时灰度） |
| 行动完成标记 | `check_done_icon` |
| HP=0 | `down_icon` |
| SAN=0 | `mad_icon` |

## 六、验收标准

1. `resource.json` 合法 JSON，条目 **24 → 29**；`node -e "JSON.parse(require('fs').readFileSync('resource.json'))"` 通过。
2. 5 个新 resId 均能被 `matchResource` 按建议 tags 检索命中。
3. 场景区分：`twisted_space`/`rift_edge` 独有 `高SAN消耗场景` 标签，其余场景无（可区分普通/高SAN）。
4. UI 底板区分：`panel_attr_bg`（单人）与 `panel_team_bg`（小队）标签可区分。
5. 原有 24 条 resId/url 及全部既有 tags **无一丢失**、url 均未改动。
6. 分类约束：无新资源落入错误目录。

## 七、文件改动清单

| 文件 | 动作 |
|---|---|
| `resource.json` | 修改（唯一代码改动）：+5 条，标签追加于 21~22 条 |
| `server/gameLogic.js` | **不改**（matchResource 自动读取新注册表） |
| 物理图片（非代码，用户提供） | `assets/icons/hourglass.png`、`check_done.png`、`down.png`、`mad.png`、`assets/ui/panel_team_bg.png` |
| 测试（可选） | `tests/test_round1.js` T6 ResourceManager 用例扩展新标签检索断言 |

## 八、与现有 ADR 关联

- **无冲突**：已批准 ADR 均不涉及 resource.json 增改。
- **关联**：ADR-005（副本选择大厅背景 / 方尖碑，为 obelisk GIF 出处，本期不纳入）；ADR-006/007（资源加载器相关代码审查）。
- **一致性**：`config/attributes.json` 引用 `./assets/icons/*.png` 与本次新增目录规则一致，无需改动。

## 九、待用户补充/拍板

1. 5 个新资源的**物理图片文件**（现有条目图片同样缺失，如本次一并补齐更好）。
2. `wil_icon` 是否纳入 C 组追加（默认：是）。
3. "扣散异象"是否按 AI 实际输出改为"扣SAN异象"（默认：按原文）。
4. 方尖碑 GIF 是否需注册（默认：本轮不纳入）。
