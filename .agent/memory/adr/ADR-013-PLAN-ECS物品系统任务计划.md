# ADR-013-PLAN · ECS 物品系统（C++17 通用框架 + 青峰山特化）任务计划

**状态**：`PLANNING`（已生成，待 Reviewer 审查通过后进入 EXECUTING）
**创建日期**：2026-08-07
**规划人**：planner 子 Agent
**上游文档**：[ADR-012](./ADR-012-PLAN-ECS物品系统.md)（需求）+ `docs/ecssystem.txt`（策划定稿数据）

> 本计划仅可写：任务计划文档、`.agent/memory/`、`.agent/reports/`。**禁止修改任何源码**。文件增删由 Orchestrator 在方案批准后执行。

---

## 一、需求与边界（确认）

- **目标**：新增 `native/ecs/` 目录，实现两层次代码——① C++17 通用 ECS 物品框架（Entity / 5 POD Component + Pool / 5 System / EventBus / ItemSystemManager 单例）；② 青峰山特化（33 件物品模板 + 6 车厢掉落矩阵 + 米·戈陷阱路线 + LoadFromJson 骨架）。
- **硬边界**：仅新增 `native/ecs/`；零侵入现有代码；**不**接入运行时；**不**新增 N-API target；**不**修改 `binding.gyp`；零第三方库（纯标准库）。
- **代码风格**：与 `native/battle_engine.cc` / `attr_formula.h` 一致——snake_case 函数/变量、PascalCase 类型、全 `#pragma once`、无循环依赖。
- **验收总纲**（ADR-012 五）：① 数据逐条比对（33 件 + CS007 分支 + CL008 假→真 + EQ003 无耐久）；② 头文件自检（guard 完整 / 无循环依赖 / 枚举字段引用一致）；③ 框架完备（Manager::Init 依赖序、5 Component + 5 System + EventBus 均在）；④ 掉落矩阵抽样 5 条 LootContext 命中；⑤ 零侵入；⑥ 可选编译（`g++ -fsyntax-only -std=c++17` 或 CMake）。

---

## 二、数据勘误与待确认项（需 Reviewer / Orchestrator 拍板）

> 规划期发现 4 处 ADR-012 / docs 内部不一致，均**不改变范围**，仅需确认实现口径。

| # | 项 | ADR-012 / docs 原文 | 本计划建议口径 | 影响 |
|---|----|--------------------|----------------|------|
| 1 | **文件数** | "14 文件"，但清单枚举实为 **21 个** | 以枚举清单为准（21 个），并追加静态自检源文件 `ecs_selfcheck.cc`（第 22 个，仍在 `native/ecs/` 内）用于落地"数据比对 + 头文件一致性 + 掉落抽样"验收 | 零侵入承诺不受影响（全部新增于 `native/ecs/`） |
| 2 | **Pool 数量** | docs 1.5 注释 "6个Pool" | 仅 5 个 Component → `ComponentType` 为 {Clue, Consumable, Equipment, Tag, Weight, COUNT}（COUNT=5），`componentPools` 按 `COUNT` 分配 | 枚举定义 |
| 3 | **EquipSystem 状态归属** | 5 Component 无"角色/装备槽"组件，但 `Equip()` 需记录已装备项 | `ItemEquipSystem` 内部维护 `characterId → 槽位→itemEntityId` 映射（标注为**唯一有状态例外**，其余保持无状态）；备选：借 TagComponent 保留字 tag 编码装备态（不新增组件） | 设计取舍，推荐前者，简单可测 |
| 4 | **EntityId 高 32 位"类型 Hash"** | "高32位=类型Hash，低32位=自增" | 高 32 = FNV-1a32(模板大类 Clue/Consumable/Equipment)；低 32 = 该类自增序列；`generation` 独立防悬垂 | ID 生成规则 |

---

## 三、任务清单总表

| ID | 标题 | 类别 | 优先级 | 批次 | 依赖 | 预估工作量 | 涉及文件 |
|----|------|------|--------|------|------|-----------|----------|
| T-1 | 公共类型 + Entity/EntityManager | C++ | P0 | A | — | M | `ecs_types.h`、`entity.h/.cc` |
| T-2 | 5 POD Component + ComponentPool | C++ | P0 | A | T-1 | M | `component.h` |
| T-3 | EventBus + 8 事件 | C++ | P0 | A | T-1 | S | `event_bus.h/.cc` |
| T-4 | ItemFactory + ItemTemplateRegistry | C++ | P0 | A | T-1、T-2、T-3 | M | `system_factory.h/.cc` |
| T-5 | InventorySystem | C++ | P1 | B | T-1..T-4 | M | `system_inventory.h/.cc` |
| T-6 | ItemQuerySystem | C++ | P1 | B | T-1..T-4 | M | `system_query.h/.cc` |
| T-7 | ItemEquipSystem | C++ | P1 | B | T-1..T-4 | M | `system_equip.h/.cc` |
| T-8 | ItemLootSystem + LootContext + LootTableRegistry | C++ | P1 | B | T-1..T-4 | L | `system_loot.h/.cc` |
| T-9 | ItemSystemManager 单例 | C++ | P0 | C | T-5、T-6、T-7、T-8 | M | `item_system_manager.h/.cc` |
| T-10 | 青峰山特化（33 模板 + 矩阵 + 陷阱） | C++ | P0 | C | T-1..T-9 | L | `qingfeng_items.h/.cc` |
| T-11 | CMakeLists + 静态自检 | C++ / 配置 | P0 | C | T-10 | M | `CMakeLists.txt`、`ecs_selfcheck.cc` |

> 批次 A（T-1→T-4）严格串行依赖头文件；批次 B（T-5..T-8）在 T-4 完成后**可并行**开工；批次 C（T-9→T-10→T-11）串行收尾。

---

## 四、依赖拓扑与执行顺序

### 4.1 头文件依赖顺序（编译期）

<div style="font-family:Consolas,monospace; font-size:13px; line-height:1.9; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px; padding:12px 16px;">

<strong>层级 0</strong>　`ecs_types.h`（无 include）<br/>
<strong>层级 1</strong>　`entity.h`、`component.h`、`event_bus.h` → 仅依赖 ecs_types.h<br/>
<strong>层级 2</strong>　`system_factory.h` / `system_inventory.h` / `system_query.h` / `system_equip.h` / `system_loot.h` → 依赖层级 0+1<br/>
<strong>层级 3</strong>　`item_system_manager.h` → 依赖层级 0+1+2<br/>
<strong>层级 4</strong>　`qingfeng_items.h` → 依赖层级 0+1+2+3（注册模板 + 掉落表）<br/>
<strong>层级 5</strong>　`ecs_selfcheck.cc` → 依赖全部（静态自检入口）

</div>

### 4.2 任务执行顺序（依赖边）

<table style="border-collapse:separate; border-spacing:6px; width:100%; font-size:13px;">
  <tr>
    <td style="border:1px solid #94a3b8; border-radius:8px; padding:6px 10px; background:#f1f5f9; text-align:center; font-weight:600;">批次 A<br/>T-1 公共类型+Entity</td>
    <td style="text-align:center; font-weight:600; color:#64748b;">→</td>
    <td style="border:1px solid #94a3b8; border-radius:8px; padding:6px 10px; background:#f1f5f9; text-align:center; font-weight:600;">T-2 Component+Pool<br/>T-3 EventBus（可并行）</td>
    <td style="text-align:center; font-weight:600; color:#64748b;">→</td>
    <td style="border:1px solid #94a3b8; border-radius:8px; padding:6px 10px; background:#f1f5f9; text-align:center; font-weight:600;">T-4 Factory+Registry</td>
  </tr>
  <tr>
    <td style="border:1px dashed #3b82f6; border-radius:8px; padding:6px 10px; background:#eff6ff; text-align:center; font-weight:600;">批次 B（依赖 T-4 后可并行）<br/>T-5 Inventory ／ T-6 Query<br/>T-7 Equip ／ T-8 Loot</td>
    <td style="text-align:center; font-weight:600; color:#64748b;">→</td>
    <td style="border:1px solid #3b82f6; border-radius:8px; padding:6px 10px; background:#eff6ff; text-align:center; font-weight:600;">批次 C<br/>T-9 Manager 单例</td>
    <td style="text-align:center; font-weight:600; color:#64748b;">→</td>
    <td style="border:1px solid #3b82f6; border-radius:8px; padding:6px 10px; background:#eff6ff; text-align:center; font-weight:600;">T-10 青峰山特化</td>
  </tr>
  <tr>
    <td colspan="3" style="border:1px solid #16a34a; border-radius:8px; padding:6px 10px; background:#f0fdf4; text-align:center; font-weight:600; color:#166534;">T-11 CMakeLists + 静态自检（最终闸门）</td>
    <td style="text-align:center; font-weight:600; color:#64748b;">←</td>
    <td style="text-align:center; font-size:12px; color:#64748b;">依赖 T-10 完成</td>
  </tr>
</table>

**执行顺序建议**：
1. **批次 A 串行**：T-1 →（T-2 与 T-3 并行）→ T-4。
2. **批次 B 并行**：T-4 完成后，T-5 / T-6 / T-7 / T-8 可同时开工（每个独立 REVIEWING→MODIFYING→TESTING→DECIDING 周期）。
3. **批次 C 串行**：T-9（需 4 个 System 全部落位）→ T-10（依赖全框架 + Factory/Loot 注册表）→ T-11（最终自检闸门）。
4. T-11 通过后整体进入 FINISHED，由 Reviewer 做最终零侵入复核。

---

## 五、任务详案

### T-1 公共类型 + Entity / EntityManager

- **ID**：T-1　**类别**：C++　**优先级**：P0　**批次**：A　**依赖**：无
- **涉及文件**：`native/ecs/ecs_types.h`、`native/ecs/entity.h`、`native/ecs/entity.cc`（均新建）
- **实现要点**：
  1. `ecs_types.h`（仅此头可被全项目引用）：
     - `using EntityId = uint64_t;`、`using string_id = std::string;`
     - 枚举：`ComponentType { Clue, Consumable, Equipment, Tag, Weight, COUNT }`；`ClueType { KeyClue, SideClue, FakeClue }`；`EffectType { HP_RESTORE, SAN_RESTORE, BUFF_TEMP, CURE_WOUND, PURGE_VOID, LIGHT_SOURCE, REPAIR }`；`EquipSlot { WEAPON, ACCESSORY, ARMOR, LIGHT_SOURCE }`；`TargetScope { SELF_ONLY, SINGLE_ALLY, ALL_PARTY, SINGLE_ENEMY }`；`LoreCategory { VOID, MORTAL, MYTHOS, RUINS, TRAIN }`；`Rarity { Common, Uncommon, Rare, Epic, Junk }`。
     - 常量：属性维度顺序 `HP, SAN, STR, DEX, CON, PER, WIL`（`kAttrCount = 7`），供 `EquipmentComponent.attrBonuses` 下标约定。
  2. `entity.h/.cc`：`struct Entity { EntityId id; uint32_t generation; bool isAlive; }` + `class EntityManager`：`Create(category)` 生成 id（高 32 = FNV-1a32(category)，低 32 = 该类自增，见待确认项 4）；`Get(id)` 校验 generation 与存活；`Destroy(id)` 置 isAlive=false 且 generation++（防悬垂）。内部 `std::unordered_map<EntityId, Entity>`。
  3. 命名 snake_case / PascalCase；全 `#pragma once`；零第三方。
- **验收标准**：
  - 3 个文件均含 `#pragma once`（.cc 例外）；`ecs_types.h` 无任何 ecs 内部 include（无循环依赖根）。
  - 枚举值全集与 docs 1.3 完全一致（**7 个 EffectType**（reviewer 修正，docs 1.3.2 仅 7 值）+ **`EffectType::SPECIAL` 扩展值**（建模 CS008 万能钥匙"特殊"效果，reviewer B3）/ 4 个 EquipSlot / 4 个 TargetScope / 5 个 LoreCategory / 4 个 Rarity + Junk）。
  - EntityManager：Create 返回唯一 id（同 category 低 32 递增、不同 category 高 32 区分）；Destroy 后 Get 返回无效；同 id 重建 generation 递增（防悬垂用例）。
  - 静态自检：`static_assert(ComponentType::COUNT == 5)` 成立。

### T-2 5 POD Component + ComponentPool

- **ID**：T-2　**类别**：C++　**优先级**：P0　**批次**：A　**依赖**：T-1
- **涉及文件**：`native/ecs/component.h`（新建，header-only）
- **实现要点**：
  1. 5 个纯数据聚合体（aggregate，无方法/虚函数，值语义），字段与 docs 1.3 **逐字段一致**：
     - `ClueComponent`：clueId(uint32)、clueType(ClueType)、fragmentIndex(uint8)、totalFragments(uint8)、truthScore(int8)、revealsLocation(uint32)、revealsNPC(uint32)、relatedEventId(uint32)、isAutoIdentified(bool)。
     - `ConsumableComponent`：effectType、effectValue(int32)、durationRounds(uint16)、cooldownSeconds(uint16)、maxCarryPerSlot(uint8)、useInCombat(bool)、useOutOfCombat(bool)、targetScope、consumptionSound(string_id)、consumptionVFX(string_id)。
     - `EquipmentComponent`：equipSlot、attrBonuses(`std::array<int32_t,7>`)、skillGranted(string_id)、durability(uint16)、maxDurability(uint16)、durabilityLossPerUse(uint8)、repairable(bool)、repairCost(uint16)、twoHanded(bool)、specialEffect(string_id)。
     - `TagComponent`：tags(`std::vector<string_id>`)、sceneOrigin(string_id)、loreCategory。
     - `WeightComponent`：weight(float)、encumbrancePenalty(int8)。
  2. `ComponentPool`：按 ComponentType 分池、同类型连续存储（`std::vector<ComponentType>` 池 + entityId↔下标映射，或用 `std::vector<std::optional<ComponentType>>` 稀疏连续布局）；提供 Add/Get/Remove/按实体遍历。
  3. 说明：Component 含 `std::vector`/`std::array` 成员，**非字面 POD（不做 `std::is_trivial` 断言）**，按"纯数据聚合体"约定实现。
- **验收标准**：
  - 5 结构体字段名/类型/默认值与 docs 1.3 逐字段核对一致（写进自检注释）。
  - ComponentPool：Add/Get/Remove 正确；同类型连续存储（抽样断言地址相邻，布局约束在实现注释说明）。
  - 仅依赖 `ecs_types.h`；`#pragma once`；无循环依赖。

### T-3 EventBus + 8 事件

- **ID**：T-3　**类别**：C++　**优先级**：P0　**批次**：A　**依赖**：T-1
- **涉及文件**：`native/ecs/event_bus.h`、`native/ecs/event_bus.cc`（新建）
- **实现要点**：
  1. 8 事件（docs 1.1 + ADR-012）：`ItemAcquired / ItemConsumed / ItemEquipped / ItemBroken / ClueDiscovered / InventoryFull / ItemCreated / LootGenerated`；每个事件带载荷结构（至少含 `EntityId`，事件专属字段如 `truthScore`、`slot`、`count`）。
  2. `EventBus`：类型化 `Subscribe<EventType>(std::function)` / `Publish<EventType>(payload)`（`std::type_index` + `std::vector<std::function>`），纯标准库。
- **验收标准**：
  - 8 个事件类型全部存在；Subscribe→Publish 回调按注册序触发、载荷字段完整。
  - 仅依赖 `ecs_types.h` / `entity.h`；`#pragma once`；无循环依赖。

### T-4 ItemFactory + ItemTemplateRegistry

- **ID**：T-4　**类别**：C++　**优先级**：P0　**批次**：A　**依赖**：T-1、T-2、T-3
- **涉及文件**：`native/ecs/system_factory.h`、`native/ecs/system_factory.cc`（新建）
- **实现要点**：
  1. `ItemTemplate`：templateId(string_id)、displayName(string_id)、category(ComponentType 主类)、componentMask（位集）、各 Component 默认值、`generatorFunc`（可选 `std::function`，如耐久 ±10% 浮动）。
  2. `ItemTemplateRegistry`：`std::unordered_map<string_id, ItemTemplate>`，`Register/Get`。
  3. `ItemFactory`（注入 EntityManager + ComponentPool + EventBus）：`Create(templateId) → EntityId`：查注册表 → CreateEntity → 按 mask 逐项 AddComponent（填模板默认值）→ 有 generatorFunc 则调用 → `Publish<ItemCreated>`；未知名返回无效 id。
- **验收标准**：
  - 注册 1 个消耗品模板 + 1 个装备模板后，Create 分别产出正确 Component 组合（mask 命中）与 ItemCreated 事件。
  - 未知 templateId 返回无效 id 且不崩溃。
  - `#pragma once`、无循环依赖。

### T-5 InventorySystem

- **ID**：T-5　**类别**：C++　**优先级**：P1　**批次**：B　**依赖**：T-1..T-4
- **涉及文件**：`native/ecs/system_inventory.h`、`native/ecs/system_inventory.cc`（新建）
- **实现要点**（docs 1.4.2）：
  1. `AddItem(itemId, slotIndex)`：先查同类型可堆叠（`maxCarryPerSlot > 1`）→ 合并堆叠；否则占新格；负重超限 → `Publish<InventoryFull>` 返回 false；成功 → `Publish<ItemAcquired>`。
  2. `RemoveItem` / `MergeStack(from, to)` / `GetItemsByTag` / `GetItemsByType` / `GetTotalWeight`（跨 `WeightComponent.weight` 累计）。
  3. 背包容量常量（默认格数）与堆叠上限取自 `ConsumableComponent.maxCarryPerSlot`（0=无限、1=不可堆叠）。
- **验收标准**：
  - 堆叠：同模板消耗品（maxCarryPerSlot=3）3 次 Add → 合并为 1 格计数 3；maxCarryPerSlot=1 不合并。
  - 负重：构造超限场景 → AddItem 返回 false 且触发 InventoryFull。
  - `GetTotalWeight` 数值正确；`MergeStack` 正确合并并销毁源。

### T-6 ItemQuerySystem

- **ID**：T-6　**类别**：C++　**优先级**：P1　**批次**：B　**依赖**：T-1..T-4
- **涉及文件**：`native/ecs/system_query.h`、`native/ecs/system_query.cc`（新建）
- **实现要点**（docs 1.4.3）：
  1. 查询条件：`byType` / `byTag` / `byRarity` / `byEffectType` / `bySceneOrigin` / `byTruthRange[min,max]`。
  2. 索引：TagComponent.tags 倒排索引（tag → entityId 集合）；ComponentType 位图索引；多条件 `SetIntersection` 合并后返回 `std::vector<Entity*>`。
  3. 增删实体后索引增量更新（挂 ComponentPool 变更钩子或由 Manager 触发 rebuild）。
- **验收标准**：
  - 造 5 条不同 tag/type/rarity 物品：各单条件查询命中正确集合。
  - 多条件组合 = 交集正确；`byTruthRange` 能筛出负真实度假线索（CL003/CL014 场景）。
  - Add/Remove 后索引与实体集一致。

### T-7 ItemEquipSystem

- **ID**：T-7　**类别**：C++　**优先级**：P1　**批次**：B　**依赖**：T-1..T-4
- **涉及文件**：`native/ecs/system_equip.h`、`native/ecs/system_equip.cc`（新建）
- **实现要点**（docs 1.4.4 + 待确认项 3）：
  1. 内部维护 `characterId → 槽位→itemEntityId` 映射（唯一有状态例外，注释标注）；`Equip(itemId, characterId)`：槽位占用则先自动卸下旧件 → 属性要求（`requireAttr`，如 STR≥60，随 qingfeng 模板数据补充）不满足返回 false → 聚合 attrBonuses → 记录 skillGranted → `Publish<ItemEquipped>`。
  2. `Unequip(characterId, slot)`；`ApplyDurabilityLoss(itemId)`：扣 durability → 0 时 `Publish<ItemBroken>` → 不可修复则移除，可修复保留（durability=0）。
  3. `GetEffectiveAttrBonuses(characterId)` → 7 属性累计（`AttrBonusSum`）+ 特殊效果汇总。
- **验收标准**：
  - Equip 成功且属性聚合正确；同槽冲突自动卸下旧件；不满足属性要求返回 false。
  - 耐久损耗至 0：触发 ItemBroken；不可修复项被移除、可修复项保留。
  - `GetEffectiveAttrBonuses` 与已装备项一一对应。

### T-8 ItemLootSystem + LootContext + LootTableRegistry

- **ID**：T-8　**类别**：C++　**优先级**：P1　**批次**：B　**依赖**：T-1..T-4
- **涉及文件**：`native/ecs/system_loot.h`、`native/ecs/system_loot.cc`（新建）
- **实现要点**（docs 1.4.5）：
  1. `LootContext`：sceneId(string_id，英文内部标识)、stageIndex(uint8)、roundIndex(uint8)、playerPER/STR/WIL(int32)、collectedClueIds(`std::vector<uint32>`)、chenHuiAlive(bool)、miGoDeceived(bool)、shoggothTriggered(bool)、shoggothRepelled(bool)、**migoFlawDetected(bool)（已察觉米·戈拟态破绽，reviewer B1 修正，用于 1号驾驶室 S2R1 判定）**。
  2. `LootTableRegistry`：`sceneId + stageIndex → 条目列表`；条目含 `condition`（属性阈值 / 前置线索 / 事件标志）、`guaranteed(bool)`、`dropWeight(uint32)`、产出（templateId + 数量）。
  3. `GenerateLoot(ctx) → std::vector<EntityId>`：查表 → 逐条评估 condition → guaranteed 必掉 / 否则按 dropWeight 加权随机 → **每轮 ≤3 件** → 调 Factory 创建 → `Publish<LootGenerated>`。
- **验收标准**（含 ADR-012 验收 4 的 5 条抽样）：
  1. 3号行李厢 S1R1（自动）→ 产出 CL001 + EQ001；
  2. 5号卧铺 S2R2（神龛，PER≥60）→ EQ003；
  3. 2号夹层 R2（shoggothRepelled=true）→ CL013 + CS009；
  4. 1号驾驶室 S2R1（**migoFlawDetected=true** + PER≥65）→ CL008 + CS008 + EQ005；
  5. 4号餐车 S2R2（collectedClueIds≥3 + 陈慧存活）→ CL010 + CS007 + EQ002。
  6. 任意 ctx 产出 ≤3 件；condition 不满足时不产出该条；非 guaranteed 条目多次调用命中集非空。

### T-9 ItemSystemManager 单例

- **ID**：T-9　**类别**：C++　**优先级**：P0　**批次**：C　**依赖**：T-5、T-6、T-7、T-8
- **涉及文件**：`native/ecs/item_system_manager.h`、`native/ecs/item_system_manager.cc`（新建）
- **实现要点**（docs 1.5）：
  1. `static ItemSystemManager& Instance()`；持有 `EntityManager`、`ComponentPool[ComponentType::COUNT]`、5 个 System、`EventBus`、`ItemTemplateRegistry`、`LootTableRegistry`。
  2. `Init()` 严格按依赖序：先 EntityManager / EventBus / Pools 就绪 → **Factory → Inventory → Query → Equip → Loot**（逐系统注入依赖）；`Shutdown()` 逆序清理，幂等。
  3. 可选便捷门面（`CreateItem` / `AddToInventory` / `QueryItems` / `GenerateLoot`），薄封装便于自检与将来接入。
- **验收标准**：
  - Init 后 5 个 System 引用全部就绪（非空）且注册表已装；Shutdown 可重复调用不崩溃。
  - 端到端：Create 消耗品 → AddToInventory → Query → GetTotalWeight 全链路正确。
  - `#pragma once`、无循环依赖。

### T-10 青峰山特化（33 模板 + 掉落矩阵 + 陷阱路线）

- **ID**：T-10　**类别**：C++　**优先级**：P0　**批次**：C　**依赖**：T-1..T-9
- **涉及文件**：`native/ecs/qingfeng_items.h`、`native/ecs/qingfeng_items.cc`（新建）
- **实现要点**：
  1. **33 模板**逐条与 docs 2.1/2.2/2.3 比对后注册：
     - 15 线索 CL001-015（含 CL008 假→真识破分支、CL003/CL014 Junk、真实度/揭示内容/品质一致）。
     - 12 消耗 CS001-012（含 CS007 陈慧存活分支：存活→"陈慧的私藏咖啡"（Rare，+15 SAN + WIL+10/5 回合）；死亡→替换"陈慧的工牌"（Common，仅 SAN+5，无 Buff））。
     - 6 装备 EQ001-006（槽位 / 7 属性加成 / 耐久 / 特殊效果；EQ003 耐久 `—` → `maxDurability=0` 表示无耐久，不参与损耗；**EQ003「SAN上限+10」编码进 `specialEffect` 而非 7 属性数组**（reviewer 非阻塞提示）。
  2. **掉落矩阵**：6 车厢 × 阶段 × 轮次，condition 含 PER/STR/WIL 阈值、前置线索（如 CL008 需先获 CL003、CL006 需先获 CL005）、陈慧存活、修格斯状态（shoggothTriggered / shoggothRepelled）；每轮 ≤3 件。**覆盖矩阵外特例（reviewer B4）：CL015 需补 sceneId=`car_6_tail` 逃生通道 + 条件（陈慧遇害 chenHuiAlive=false），EQ006 需同时登记 2号二等座 S3R3（驱退修格斯 + PER≥65，仅 S 级结局额外掉落）与 6号尾车厢 S3R2（通道入口，自动）两处掉落**。
  3. **陷阱路线**：CL003 + CL014 为 Junk 且引导 2 号夹层 → 触发修格斯战；PER≥65 识破 → 转化为真实证据（CL008 分支）；未识破结局上限 C（注释说明，本期不实现结局判定）。
  4. 场景 ID 英文内部标识（`car_3_luggage` 等）+ 中文车厢名映射表（6 车厢）。
  5. `LoadFromJson` 骨架：预留 `LoadFromJson(const std::string& jsonPath)` 接口（本期数据内置，不实际读文件）。
- **验收标准**（数据逐条比对）：
  - 模板总数 = **33**（15+12+6）；ID 全集 CL001-015 / CS001-012 / EQ001-006 无缺漏、无重号（自检断言）。
  - 抽查字段：CL001{支线, truth+80, Common}；CL003{FakeClue, -70, Junk}；CL008{识破后 +95, Rare}；CL014{FakeClue, -85, Junk}；CS007 存活{+15 SAN, WIL+10/5回合, Rare} / 死亡分支{工牌, Common, SAN+5 无 Buff}；CS004{LIGHT_SOURCE+BUFF_TEMP, STR≥60 或撬棍}；EQ001{WEAPON, STR+8 DEX-2, 耐久100}；EQ003{ACCESSORY, WIL+8 SAN上限+10, 无耐久}；EQ005{ARMOR, CON+5 HP上限+15, 耐久200}；EQ006{ARMOR, DEX+5, 耐久120}。
  - 掉落矩阵 6 车厢全覆盖；docs 2.4 五条抽样 condition 字段一致。
  - 中文车厢名映射 6 项与 docs 一致。

### T-11 CMakeLists + 静态自检（最终闸门）

- **ID**：T-11　**类别**：C++ / 配置　**优先级**：P0　**批次**：C　**依赖**：T-10
- **涉及文件**：`native/ecs/CMakeLists.txt`、`native/ecs/ecs_selfcheck.cc`（均新建）
- **实现要点**：
  1. `CMakeLists.txt`：C++17 static library target（列全部 .cc）+ 可选自检 executable target（`ecs_selfcheck`）；与既有 `binding.gyp` **无关**（不注册 target）。
  2. `ecs_selfcheck.cc`：单文件自检 main，输出 PASS/FAIL 与退出码：
     - **数据完整性**：33 模板注册后逐条断言（ID 全集 + 关键字段抽查含 CS007 双分支 / CL008 / EQ003）。
     - **头文件一致性**：`static_assert(ComponentType::COUNT==5)`、关键枚举值存在性、字段引用编译期校验。
     - **掉落抽样推演**：docs 2.4 五条用例构造 LootContext，断言 `GenerateLoot` 产出集命中（T-8 验收 1-5）。
     - **框架完备**：Manager::Init 后 5 System + 5 Component + 8 Event 均可达（编译期 + 运行期双验证）。
  3. 无编译器环境时：该文件作为**可审查静态规格**，改由人工逐条核对并产出报告。
- **验收标准**：
  - 环境有 g++/clang/VS Build Tools：`g++ -std=c++17 -fsyntax-only <各 .h>` 全过；`ecs_selfcheck` 编译运行输出 PASS、退出码 0。
  - 环境无编译器：自检项以数据比对表 + 抽样推演报告形式逐条人工核对，归档 `.agent/reports/`。
  - 零侵入复核：`git status` 仅 `native/ecs/` 新增；`binding.gyp` / `battle_engine.cc` / `server/` / `frontend/` 均未改动。

---

## 六、验收总闸（最终合并检查）

1. **文件清单**：`native/ecs/` 下 21 + 1（自检）文件全部存在，无遗漏、无多余。
2. **数据完整性**：33 模板逐条比对通过（T-10 验收表），含 CS007 分支、CL008 假→真、EQ003 无耐久。
3. **头文件自检**：全部 `#pragma once`、无循环依赖、枚举/字段引用一致。
4. **框架完备**：5 Component + 5 System + EventBus + Manager 均在代码中存在；`Init()` 依赖序 Factory→Inventory→Query→Equip→Loot 正确。
5. **逻辑正确性**：掉落矩阵 5 条抽样 LootContext 命中（T-8 / T-11）。
6. **零侵入**：仅新增 `native/ecs/`；无既有文件被改。
7. **报告**：`.agent/reports/` 输出本计划（plan）+ 最终验证报告（test）。

---

## 七、关联与后续

- 上游：ADR-012（需求）、`docs/ecssystem.txt`（数据定稿）、`docs/CPP_INTEGRATION_PLAN.md`（零侵入 / 纯 C++ 下沉原则）。
- 后续接入（**本期不实施**，登记 issue）：N-API target + JS fallback 桥接（对齐 `CPP_INTEGRATION_PLAN.md` 的 BattleBridge 模式）。
- 状态机：本计划进入 EXECUTING 前须经 Reviewer 审查通过；`--load-tasks` 时从本 ADR 提取 `T-1..T-11` 任务队列。
