/**
 * component.h — 5 POD Component 结构体 + ComponentPool（按类型连续存储）
 *
 * 层级 1：仅依赖 ecs_types.h（无循环依赖根）。header-only，无 .cc。
 *
 * 设计决策（ADR-013 T-2 + docs 1.5「按类型连续存储」）：
 *  - Component 均为"纯数据聚合体"（aggregate，无方法/虚函数，值语义）。
 *    含 std::vector/std::array 成员 → 非字面 POD，不做 std::is_trivial 断言
 *    （T-2 明确约定）。默认成员初始化便于构造。
 *  - ComponentPool<T>：components_（std::vector<T>）按 Add 序紧凑连续存储
 *    同类型组件（cache 友好）；index_（EntityId→槽位）与 entityIds_
 *    （槽位→EntityId）双向映射；Add/Get/Has/Remove 平均 O(1)。
 *    Remove 用"末尾回填"保持紧凑无空洞，连续存储不变量始终成立。
 *    注意：Get 返回的 T* 指针在下次 Add/Remove（可能触发 vector 重分配/搬移）
 *    后可能失效，调用方不得跨操作持有。
 *  - ComponentPoolArray：非模板聚合，内部 std::tuple 持有 5 个 ComponentPool<T>，
 *    供 T-9 ItemSystemManager 落地 docs 1.5 的 `componentPools[COUNT]`，并暴露
 *    模板化访问器（Add<T>/Get<T>/Has<T>/Remove<T>/ForEach<C>）。
 *  - 命名说明：docs 1.5 的 `ComponentPool componentPools[COUNT]` 在 T-2 落地为
 *    `ComponentPoolArray`（模板名 ComponentPool 已被占用，避免命名冲突）。
 */

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <vector>

#include "ecs_types.h"

namespace ecs {

// ==================== 5 个 Component（纯数据聚合体） ====================
// 字段名/类型/默认值逐字段对齐 docs 1.3（T-2 验收：逐字段核对一致）。

// ---- 1.3.1 线索物品 ----
struct ClueComponent {
    uint32_t clueId = 0;                     // 线索唯一编号
    ClueType clueType = ClueType::SideClue;  // 关键/支线/虚假（米·戈伪造）
    uint8_t fragmentIndex = 0;               // 碎片序号（0-based）
    uint8_t totalFragments = 1;              // 完整线索所需碎片总数
    int8_t truthScore = 0;                   // 真实度 -100~100（负=假情报）
    uint32_t revealsLocation = 0;            // 揭示的车厢 ID（0=不揭示）
    uint32_t revealsNPC = 0;                 // 揭示的 NPC ID（0=不揭示）
    uint32_t relatedEventId = 0;             // 关联剧情事件 ID
    bool isAutoIdentified = false;           // 获取后是否自动识别真伪
};

// ---- 1.3.2 消耗物品 ----
struct ConsumableComponent {
    EffectType effectType = EffectType::HP_RESTORE;       // 效果类型
    int32_t effectValue = 0;                 // 效果数值（HP/SAN 恢复量、Buff 增幅%）
    uint16_t durationRounds = 0;             // 持续回合数（0=瞬间生效）
    uint16_t cooldownSeconds = 0;            // 使用冷却（0=无冷却）
    uint8_t maxCarryPerSlot = 1;             // 每格最大堆叠（1=不可堆叠，0=无限）
    bool useInCombat = true;                 // 战斗中是否可用
    bool useOutOfCombat = true;              // 非战斗是否可用
    TargetScope targetScope = TargetScope::SELF_ONLY;    // 目标范围
    string_id consumptionSound;              // 使用音效 ID（空=无）
    string_id consumptionVFX;                // 使用特效 ID（空=无）
};

// ---- 1.3.3 装备物品 ----
struct EquipmentComponent {
    EquipSlot equipSlot = EquipSlot::WEAPON;             // 槽位
    std::array<int32_t, kAttrCount> attrBonuses{};       // 7 属性加成 [HP,SAN,STR,DEX,CON,PER,WIL]
    string_id skillGranted;                              // 授予技能 ID（空=无）
    uint16_t durability = 0;                             // 当前耐久
    uint16_t maxDurability = 0;                          // 最大耐久（0=无耐久，EQ003）
    uint8_t durabilityLossPerUse = 0;                    // 每次使用/受击损耗
    bool repairable = false;                             // 是否可修理
    uint16_t repairCost = 0;                             // 修理消耗诡秘点数
    bool twoHanded = false;                              // 是否双手占用
    string_id specialEffect;                             // 特殊效果 ID（空=无）
};

// ---- 1.3.4 标签 ----
struct TagComponent {
    std::vector<string_id> tags;             // 标签列表（场景匹配/Loot 筛选/AI prompt）
    string_id sceneOrigin;                   // 来源场景 tag（空=无特定来源）
    LoreCategory loreCategory = LoreCategory::VOID;      // 世界观系别
};

// ---- 1.3.5 负重 ----
struct WeightComponent {
    float weight = 0.0f;                     // 单件重量（kg）
    int8_t encumbrancePenalty = 0;           // 负重超限 DEX 惩罚（每超 1kg=-1）
};

// ==================== 编译期类型映射 ====================

// 正向：ComponentType → 具体结构体（供 ComponentPoolArray 按类型分派）。
template <ComponentType C>
struct ComponentTypeTraits;

template <> struct ComponentTypeTraits<ComponentType::Clue>       { using type = ClueComponent; };
template <> struct ComponentTypeTraits<ComponentType::Consumable> { using type = ConsumableComponent; };
template <> struct ComponentTypeTraits<ComponentType::Equipment>  { using type = EquipmentComponent; };
template <> struct ComponentTypeTraits<ComponentType::Tag>        { using type = TagComponent; };
template <> struct ComponentTypeTraits<ComponentType::Weight>     { using type = WeightComponent; };

// 反向：结构体 → ComponentType（供 ComponentPool<T> 感知自身类型）。
template <typename T>
struct ComponentTypeFor;

template <> struct ComponentTypeFor<ClueComponent>       { static constexpr ComponentType value = ComponentType::Clue; };
template <> struct ComponentTypeFor<ConsumableComponent> { static constexpr ComponentType value = ComponentType::Consumable; };
template <> struct ComponentTypeFor<EquipmentComponent>  { static constexpr ComponentType value = ComponentType::Equipment; };
template <> struct ComponentTypeFor<TagComponent>        { static constexpr ComponentType value = ComponentType::Tag; };
template <> struct ComponentTypeFor<WeightComponent>     { static constexpr ComponentType value = ComponentType::Weight; };

// ==================== ComponentPool<T>（按类型连续存储） ====================
template <typename T>
class ComponentPool {
public:
    static constexpr ComponentType kComponentType = ComponentTypeFor<T>::value;

    // 新增返回 true；同 entityId 已存在 → 覆盖旧值并返回 false（幂等）。
    // 注意：先完成 index_/entityIds_ 登记再 push components_，避免异常时状态不一致。
    bool Add(EntityId id, T value) {
        auto it = index_.find(id);
        if (it != index_.end()) {
            components_[it->second] = std::move(value);
            return false;
        }
        entityIds_.push_back(id);
        index_.emplace(id, components_.size());
        components_.push_back(std::move(value));
        return true;
    }

    // 返回的指针在后续 Add/Remove（触发 vector 重分配/搬移）后可能失效，勿跨操作持有。
    T* Get(EntityId id) {
        auto it = index_.find(id);
        return it == index_.end() ? nullptr : &components_[it->second];
    }
    const T* Get(EntityId id) const {
        auto it = index_.find(id);
        return it == index_.end() ? nullptr : &components_[it->second];
    }

    bool Has(EntityId id) const { return index_.find(id) != index_.end(); }

    // 末尾回填空洞，保持紧凑连续（无空洞），平均 O(1)。不存在 → false（幂等）。
    bool Remove(EntityId id) {
        auto it = index_.find(id);
        if (it == index_.end()) return false;
        const std::size_t slot = it->second;
        const std::size_t last = components_.size() - 1;
        if (slot != last) {
            components_[slot] = std::move(components_[last]);
            entityIds_[slot] = entityIds_[last];
            index_[entityIds_[slot]] = slot;  // 重映射被回填者的槽位
        }
        index_.erase(it);
        components_.pop_back();
        entityIds_.pop_back();
        return true;
    }

    std::size_t Size() const { return components_.size(); }
    bool Empty() const { return components_.empty(); }

    void Clear() {
        components_.clear();
        entityIds_.clear();
        index_.clear();
    }

    // 按实体遍历：fn(EntityId, T&)。迭代序 = 紧凑连续存储序。
    template <typename Fn>
    void ForEach(Fn&& fn) {
        for (std::size_t i = 0; i < components_.size(); ++i) {
            fn(entityIds_[i], components_[i]);
        }
    }
    template <typename Fn>
    void ForEach(Fn&& fn) const {
        for (std::size_t i = 0; i < components_.size(); ++i) {
            fn(entityIds_[i], components_[i]);
        }
    }

private:
    std::vector<T> components_;                        // 值存储（同类型连续，紧凑无空洞）
    std::vector<EntityId> entityIds_;                  // 槽位 → entityId（与 components_ 对齐）
    std::unordered_map<EntityId, std::size_t> index_;  // entityId → 槽位
};

// 编译期自检：5 个池的类型映射一致。
static_assert(ComponentPool<ClueComponent>::kComponentType == ComponentType::Clue, "映射错误");
static_assert(ComponentPool<ConsumableComponent>::kComponentType == ComponentType::Consumable, "映射错误");
static_assert(ComponentPool<EquipmentComponent>::kComponentType == ComponentType::Equipment, "映射错误");
static_assert(ComponentPool<TagComponent>::kComponentType == ComponentType::Tag, "映射错误");
static_assert(ComponentPool<WeightComponent>::kComponentType == ComponentType::Weight, "映射错误");

// ==================== ComponentPoolArray（ComponentPool 数组 · 供 T-9 Manager 使用） ====================
// docs 1.5：`componentPools[ComponentType::COUNT]`。ComponentPool<T> 是类模板无法直接
// 作数组元素，故以本类聚合 5 个类型化池，并暴露模板化访问器（System 统一入口）。
class ComponentPoolArray {
public:
    template <typename T> ComponentPool<T>& Pool()       { return std::get<ComponentPool<T>>(pools_); }
    template <typename T> const ComponentPool<T>& Pool() const { return std::get<ComponentPool<T>>(pools_); }

    template <typename T> bool       Add(EntityId id, T value) { return Pool<T>().Add(id, std::move(value)); }
    template <typename T> T*         Get(EntityId id)          { return Pool<T>().Get(id); }
    template <typename T> const T*   Get(EntityId id) const    { return Pool<T>().Get(id); }
    template <typename T> bool       Has(EntityId id) const    { return Pool<T>().Has(id); }
    template <typename T> bool       Remove(EntityId id)       { return Pool<T>().Remove(id); }
    template <typename T> std::size_t Size() const             { return Pool<T>().Size(); }
    template <typename T> void       Clear()                   { Pool<T>().Clear(); }

    // 按 ComponentType 遍历（编译期常量）：ForEach<ComponentType::Weight>(fn)。
    // const 版本：fn(EntityId, const T&)。
    template <ComponentType C, typename Fn>
    void ForEach(Fn&& fn) {
        Pool<typename ComponentTypeTraits<C>::type>().ForEach(std::forward<Fn>(fn));
    }
    template <ComponentType C, typename Fn>
    void ForEach(Fn&& fn) const {
        Pool<typename ComponentTypeTraits<C>::type>().ForEach(std::forward<Fn>(fn));
    }

    // 清空全部 5 个池（幂等，供自检 teardown）。
    void ClearAll() {
        std::apply([](auto&... pool) { (pool.Clear(), ...); }, pools_);
    }

private:
    std::tuple<
        ComponentPool<ClueComponent>,
        ComponentPool<ConsumableComponent>,
        ComponentPool<EquipmentComponent>,
        ComponentPool<TagComponent>,
        ComponentPool<WeightComponent>> pools_;
};

}  // namespace ecs
