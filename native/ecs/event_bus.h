/**
 * event_bus.h — EventBus（松耦合通信）+ 8 个事件载荷结构
 *
 * 层级 1：仅依赖 ecs_types.h（无循环依赖根）；实现见 event_bus.cc。
 *
 * 设计决策（ADR-013 T-3 + docs 1.1/1.4）：
 *  - 8 个事件与 docs 的 `Event::ItemAcquired / ItemConsumed / ItemEquipped /
 *    ItemBroken / ClueDiscovered / InventoryFull / ItemCreated / LootGenerated`
 *    一一对应；事件类型即"载荷结构体"（值语义、纯数据聚合体，字段带默认值）。
 *    命名采用与 docs 完全一致的裸名（如 `ItemAcquired`），保证 ADR/docs 逐字
 *    溯源；不加 Event 命名空间前缀（与 5 Component 直接置于 ecs 一致）。
 *  - 事件字段口径（ADR T-3）：至少含 EntityId，事件专属字段如 truthScore /
 *    slot / count。ClueDiscovered 含 entityId + clueId(uint32，见 ClueComponent)
 *    + isFake + truthScore；LootGenerated 为批量事件，sceneId + itemIds
 *    （EntityId 列表，每轮 ≤3），不设单一 entityId。
 *  - EventBus 采用"模板按类型分派 + 类型擦除回调"（ADR 已批准）：
 *    Subscribe<T>/Publish<T> 在 API 边界强类型（回调 std::function<void(const T&)>，
 *    载荷 const T& 引用、零拷贝）；内部以 std::type_index 键控
 *    std::vector<std::function<void(const void*)>>（回调经 Wrap<T> 类型擦除，
 *    static_cast<const T*> 还原）。Publish 按注册序（vector 序）触发，返回
 *    被触发的回调数（供自检计数）。
 *  - 单线程约定：本库为游戏模拟单线程使用，不引入互斥/锁。
 *  - 约束（reviewer T-3 附加）：PublishRaw 以引用持有 vector 并 range-for 迭代，
 *    分发期间回调不得对同一事件类型再入修改订阅（Subscribe/UnsubscribeAll/
 *    Clear），否则迭代器失效 UB。
 */

#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <typeindex>
#include <typeinfo>
#include <unordered_map>
#include <utility>
#include <vector>

#include "ecs_types.h"

namespace ecs {

// ==================== 8 个事件载荷结构（纯数据聚合体） ====================
// 命名与 docs 1.1 / 1.4 的 `Event::<事件名>` 逐字一致；字段默认值便于构造与自检。

// 物品获得（InventorySystem::AddItem 成功后发送，docs 1.4.2）
struct ItemAcquired {
    EntityId entityId = kInvalidEntityId;  // 获得的物品实体
    string_id templateId;                  // 物品模板 ID（如 "consumable_bandage_001"）
    uint8_t slotIndex = 0;                 // 占用的背包格
    uint16_t stackCount = 1;               // 合并后堆叠数（不堆叠=1）
};

// 物品消耗（使用消耗品成功后发送）
struct ItemConsumed {
    EntityId entityId = kInvalidEntityId;  // 被消耗的物品实体
    string_id templateId;                  // 物品模板 ID
    int32_t amount = 1;                    // 消耗数量
};

// 装备（ItemEquipSystem::Equip 成功后发送，docs 1.4.4）
struct ItemEquipped {
    EntityId itemId = kInvalidEntityId;        // 装备的物品实体
    EntityId characterId = kInvalidEntityId;   // 装备者角色实体
    EquipSlot slot = EquipSlot::WEAPON;        // 占用槽位
};

// 物品损坏（耐久归零时发送，docs 1.4.4）
struct ItemBroken {
    EntityId itemId = kInvalidEntityId;  // 损坏的物品实体
};

// 线索发现（发现线索时发送）
struct ClueDiscovered {
    EntityId entityId = kInvalidEntityId;  // 发现的线索物品实体
    uint32_t clueId = 0;                   // 线索唯一编号（见 ClueComponent.clueId）
    bool isFake = false;                   // 是否为虚假线索（米·戈伪造）
    int8_t truthScore = 0;                 // 真实度 -100~100（负=假情报）
};

// 背包已满（负重/容量超限时发送，docs 1.4.2）
struct InventoryFull {
    EntityId entityId = kInvalidEntityId;  // 尝试入包失败的物品实体（0=无具体物品）
};

// 物品创建（ItemFactory::Create 成功后发送，docs 1.4.1）
struct ItemCreated {
    EntityId entityId = kInvalidEntityId;  // 新建的物品实体
    string_id templateId;                  // 物品模板 ID
};

// 掉落生成（ItemLootSystem::GenerateLoot 成功后发送，docs 1.4.5）
struct LootGenerated {
    string_id sceneId;             // 当前场景 ID（如 "car_3_luggage"）
    std::vector<EntityId> itemIds; // 本次掉落的物品实体列表（每轮 ≤3）
};

// ==================== EventBus ====================
// 模板按类型分派 + 类型擦除回调（ADR 已批准设计）。
class EventBus {
public:
    EventBus() = default;
    ~EventBus() = default;

    // 禁止拷贝/移动：订阅关系是唯一状态来源。
    EventBus(const EventBus&) = delete;
    EventBus& operator=(const EventBus&) = delete;

    // 订阅事件 T：回调在 Publish<T> 时按注册序触发。
    // 空回调（默认构造的 std::function）直接忽略，不登记。
    template <typename T>
    void Subscribe(std::function<void(const T&)> handler) {
        if (!handler) return;
        handlers_[std::type_index(typeid(T))].push_back(Wrap<T>(std::move(handler)));
    }

    // 发布事件 T：按注册序触发全部回调，返回触发的回调数（0=无订阅者）。
    // 载荷以 const T& 传入（零拷贝）；回调不得跨调用持有指向 payload 的指针。
    // 约束：分发期间回调不得对同一事件类型再入修改订阅（Subscribe/UnsubscribeAll/Clear）。
    template <typename T>
    std::size_t Publish(const T& payload) {
        return PublishRaw(std::type_index(typeid(T)), static_cast<const void*>(&payload));
    }

    // 查询类型 T 的当前订阅数（供自检断言）。
    template <typename T>
    std::size_t HandlerCount() const {
        return HandlerCountOf(std::type_index(typeid(T)));
    }

    // 清空类型 T 的全部订阅。
    template <typename T>
    void UnsubscribeAll() {
        RemoveType(std::type_index(typeid(T)));
    }

    // 清空全部类型的订阅（幂等）。
    void Clear();

private:
    // 类型擦除回调：void(const void*) ← 强类型 void(const T&)。
    using RawHandler = std::function<void(const void*)>;

    // 强类型回调包装为类型擦除（捕获后经 static_cast<const T*> 还原）。
    template <typename T>
    static RawHandler Wrap(std::function<void(const T&)> cb) {
        return [cb = std::move(cb)](const void* raw) {
            cb(*static_cast<const T*>(raw));
        };
    }

    void RemoveType(const std::type_index& ti);                     // 删除某类型全部订阅
    std::size_t HandlerCountOf(const std::type_index& ti) const;    // 订阅数
    std::size_t PublishRaw(const std::type_index& ti, const void* payload);  // 按序触发

    std::unordered_map<std::type_index, std::vector<RawHandler>> handlers_;  // type → 回调表
};

}  // namespace ecs
