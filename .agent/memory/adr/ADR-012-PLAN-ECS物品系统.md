# ADR-012-PLAN · ECS 物品系统（C++17 通用框架 + 青峰山特化）

**状态**：`UNDERSTANDING`（澄清完成，待进入 PLANNING）
**创建日期**：2026-08-07
**需求来源**：`docs/ecssystem.txt`（策划定稿）
**改动边界**：仅新增 `native/ecs/` 目录；**禁止修改**任何现有源码（`native/battle_engine.cc`、`binding.gyp`、`server/`、`frontend/`）

## 一、功能描述

用 **C++17 及其面向对象特性**实现两层次代码：

1. **通用 ECS 物品系统框架**（与业务无关，可复用）：
   - Entity（uint64 ID = 类型Hash高32位 + 自增低32位，含 generation 防悬垂、isAlive）
   - 5 个 POD Component：Clue / Consumable / Equipment / Tag / Weight；ComponentPool 按类型连续存储
   - 5 个 System（纯逻辑无状态）：ItemFactory / InventorySystem / ItemQuerySystem / ItemEquipSystem / ItemLootSystem
   - EventBus（松耦合）：ItemAcquired / ItemConsumed / ItemEquipped / ItemBroken / ClueDiscovered / InventoryFull（+ ItemCreated / LootGenerated）
   - `ItemSystemManager` 单例，按依赖序初始化：Factory → Inventory → Query → Equip → Loot
2. **青峰山特化**（利用掉落表数据）：
   - 33 件物品模板：15 线索（CL001-015）+ 12 消耗（CS001-012）+ 6 装备（EQ001-006），含 CS007 陈慧存活分支
   - 按"车厢×阶段×轮次"掉落矩阵 + `LootContext` 条件判定 + 每轮上限 3 件
   - 米·戈陷阱路线（CL003+CL014 Junk，PER≥65 可识破转化为证据）

## 二、非功能需求

| 项 | 要求 |
|----|------|
| 语言标准 | C++17，RAII + 值语义为主，Component 为 POD |
| 命名 | snake_case 函数/变量、PascalCase 类型，与 `battle_engine.cc` 风格一致 |
| 头文件 | 全部 include guard（`#pragma once`），无循环依赖 |
| 依赖 | 零第三方库（纯标准库），不依赖 N-API |
| 侵入性 | 零侵入现有代码；不新增 N-API target；不改 `binding.gyp` |
| 编译 | 环境无 VS Build Tools → 静态自检为主；附 CMakeLists 供将来验证 |

## 三、文件清单

```
native/ecs/
├── ecs_types.h                # 公共类型：EntityId、ComponentType、ClueType/EffectType/EquipSlot/TargetScope/LoreCategory/Rarity、string_id
├── entity.h / entity.cc       # Entity + EntityManager（Create/Get/Destroy、generation 防悬垂）
├── component.h                # 5 POD Component + ComponentPool（按类型连续存储）
├── event_bus.h / event_bus.cc # EventBus + 8 事件
├── system_factory.h/.cc       # ItemFactory + ItemTemplateRegistry
├── system_inventory.h/.cc     # InventorySystem（Add/Remove/堆叠/负重/GetItemsByTag/GetTotalWeight）
├── system_query.h/.cc         # ItemQuerySystem（tag 倒排索引 + 位图索引 + SetIntersection）
├── system_equip.h/.cc         # ItemEquipSystem（Equip/Unequip/耐久损耗/属性加成汇总）
├── system_loot.h/.cc          # ItemLootSystem + LootContext + LootTableRegistry（条件判定/加权/≤3 件）
├── item_system_manager.h/.cc  # 单例聚合，依赖序 Init/Shutdown
├── qingfeng_items.h/.cc       # 青峰山特化：33 物品模板 + 掉落矩阵 + 陷阱路线 + LoadFromJson 骨架
└── CMakeLists.txt             # 备选编译通道
```

## 四、青峰山特化范围（数据必须与文档逐条一致）

- 15 线索：CL001-015（含 CL008 假→真、CL003/CL014 Junk）
- 12 消耗：CS001-012（含 CS007 陈慧存活分支 → 死亡替换"陈慧的工牌"）
- 6 装备：EQ001-006（槽位/属性加成/耐久/特殊效果）
- 掉落矩阵：6 车厢 × 阶段 × 轮次，条件含 PER/STR/WIL 阈值、前置线索、陈慧存活、修格斯状态；每轮 ≤3 件
- 陷阱路线：CL003+CL014 引导 2 号夹层，触发修格斯战；未识破结局上限 C
- 场景 ID：`LootContext.sceneId` 用英文内部标识（`car_3_luggage` 等），维护中文车厢名映射表

## 五、验收标准

1. 数据完整性：33 件物品模板逐条与文档二比对，ID/字段/数值无遗漏、无错误（含 CS007 分支、CL008 假→真、EQ003 无耐久 `—` 处理）
2. 头文件自检：include guard 完整、无循环依赖、枚举与字段引用一致
3. 框架完备：`ItemSystemManager::Init()` 按依赖序执行；5 Component + 5 System + EventBus 均在代码中存在
4. 逻辑正确性：掉落矩阵抽样 5 条（3号行李厢 R1 自动 → CL001+EQ001；5号卧铺 S2 神龛 PER≥60 → EQ003；2号夹层驱退后 → CL013+CS009 等）的 LootContext 条件能命中
5. 零侵入：仅新增 `native/ecs/`，无既有文件被修改
6. 可选（环境就绪时）：`g++ -fsyntax-only -std=c++17` 或 CMake 构建通过

## 六、与现有 ADR 关联

关联 `docs/CPP_INTEGRATION_PLAN.md`：遵循同一"零侵入、纯 C++ 下沉、暂不接入运行时"原则。后续接入需新增 N-API target + JS fallback（本次不实施）。
