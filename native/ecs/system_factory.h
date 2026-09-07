/**
 * system_factory.h — ComponentMask / ItemTemplate / ItemTemplateRegistry / ItemFactory
 *
 * 层级 2：依赖层级 0（ecs_types.h）+ 层级 1（entity.h / component.h / event_bus.h）；
 * 不依赖任何其他 system_*.h（无循环依赖）。实现见 system_factory.cc。
 *
 * 设计决策（ADR-013 T-4 + docs 1.4.1）：
 *  - ComponentMask：ComponentType（0..4）映射到 uint8_t 位 0..4 的位掩码，
 *    Bit(c) = 1u<<(uint)c（enum class 非 2 的幂，故显式位映射）。
 *  - ItemTemplate：策划配置数据（模板注册表条目）。含 templateId（注册键）、
 *    displayName、category（主类，决定 EntityId 高 32 位 = FNV-1a32(主类名)）、
 *    componentMask、5 个 Component 子结构默认值、可选 generatorFunc。
 *  - ItemTemplateRegistry：std::unordered_map<string_id, ItemTemplate>；
 *    由 T-9 Manager 持有（docs 1.5 `templates`），策划数据先于 Factory 就绪。
 *    注意（reviewer T-4）：Register 覆盖旧模板会使此前 Get 返回的指针失效，
 *    调用方不得跨 Register 持有模板指针。
 *  - ItemFactory：依赖注入 EntityManager + ComponentPoolArray + EventBus +
 *    ItemTemplateRegistry（const 只读）。Create(templateId)→EntityId（docs 输出
 *    Entity& 与 ADR 修正一致，取 EntityId 值语义，稳定、防悬垂）。
 *    未知模板 / 未绑定依赖 → kInvalidEntityId（幂等，不崩溃）。
 *  - generatorFunc 签名 void(const ItemTemplate&, EntityId, ComponentPoolArray&)：
 *    模板 const& 只读基值（避免污染共享模板）；pools 可变，允许对已落位
 *    Component 随机化（如 EquipmentComponent.durability ±10%）；回调自捕获 RNG。
 *    约束（reviewer T-4）：generatorFunc 内不得对同实体再次 Add/Remove
 *    Component（会破坏 Factory 的 mask 落位不变量）。
 */

#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <unordered_map>

#include "ecs_types.h"
#include "entity.h"
#include "component.h"
#include "event_bus.h"

namespace ecs {

// ==================== ComponentMask（位掩码） ====================
// Clue=bit0, Consumable=bit1, Equipment=bit2, Tag=bit3, Weight=bit4（uint8_t 可容纳）。
struct ComponentMask {
    uint8_t bits = 0;

    static constexpr uint8_t Bit(ComponentType c) {
        return static_cast<uint8_t>(1u << static_cast<unsigned>(c));
    }
    void Set(ComponentType c) { bits |= Bit(c); }
    void Clear(ComponentType c) { bits &= static_cast<uint8_t>(~Bit(c)); }
    bool Has(ComponentType c) const { return (bits & Bit(c)) != 0; }
    uint8_t Raw() const { return bits; }
    bool Empty() const { return bits == 0; }
};

// 便捷构造：MakeMask<ComponentType::Clue, ComponentType::Tag>()（C++17 折叠）。
template <ComponentType... Cs>
constexpr ComponentMask MakeMask() {
    ComponentMask m;
    ((m.bits |= ComponentMask::Bit(Cs)), ...);
    return m;
}

// 前置声明（供 GeneratorFunc 别名引用，ItemTemplate 定义见下）。
struct ItemTemplate;

// 随机属性生成回调：模板只读基值 + 已落位实体可改 pools。
// 约束：不得对同实体再次 Add/Remove Component。
using GeneratorFunc = std::function<void(const ItemTemplate&, EntityId, ComponentPoolArray&)>;

// ==================== ItemTemplate（策划配置数据） ====================
struct ItemTemplate {
    string_id templateId;            // 模板唯一 ID（注册键，如 "consumable_bandage_001"）
    string_id displayName;           // 显示名（docs 模板注册表 name 字段）
    ComponentType category = ComponentType::Clue;   // 主类：决定 EntityId 高 32 位大类
    ComponentMask componentMask;     // 位掩码：该模板带哪些 Component
    // 各 Component 默认值子结构（仅 mask 命中的会被 AddComponent 落位）：
    ClueComponent clue;              // mask 含 Clue 时生效
    ConsumableComponent consumable;  // mask 含 Consumable 时生效
    EquipmentComponent equipment;    // mask 含 Equipment 时生效
    TagComponent tag;                // mask 含 Tag 时生效
    WeightComponent weight;          // mask 含 Weight 时生效
    GeneratorFunc generatorFunc;     // 可选；空则不调用
};

// ==================== ItemTemplateRegistry（策划数据注册表） ====================
class ItemTemplateRegistry {
public:
    // 注册模板；templateId 已存在 → 覆盖旧值并返回 false（幂等）。
    // 注意：覆盖会使此前 Get 返回的指针失效，调用方不得跨 Register 持有模板指针。
    bool Register(ItemTemplate tpl);
    // 查找；不存在 → nullptr。
    const ItemTemplate* Get(const string_id& templateId) const;
    // 是否存在。
    bool Has(const string_id& templateId) const;
    // 已注册模板数。
    std::size_t Size() const;
    // 清空（幂等，自检 teardown）。
    void Clear();

private:
    std::unordered_map<string_id, ItemTemplate> templates_;
};

// ==================== ItemFactory ====================
class ItemFactory {
public:
    // 默认构造：未绑定依赖（Create 返回 kInvalidEntityId，不崩溃）。
    ItemFactory() = default;

    // 依赖注入（EntityManager / ComponentPoolArray / EventBus / 只读 Registry）。
    void Bind(EntityManager& entities, ComponentPoolArray& pools, EventBus& bus,
              const ItemTemplateRegistry& registry);

    // Create(templateId) → EntityId（docs 1.4.1 五步）：
    //   查注册表 → CreateEntity（高32=fnv1a32(主类名)）→ 按 componentMask 逐项
    //   AddComponent（填模板默认值）→ 有 generatorFunc 则调用 → Publish<ItemCreated>。
    // 未知模板 / 未绑定依赖 → kInvalidEntityId（幂等，不崩溃）。
    EntityId Create(const string_id& templateId);

    // ComponentType 主类 → EntityManager 大类名（高 32 位 = FNV-1a32(名)）。
    static const char* CategoryName(ComponentType c);

private:
    EntityManager* entities_ = nullptr;
    ComponentPoolArray* pools_ = nullptr;
    EventBus* bus_ = nullptr;
    const ItemTemplateRegistry* registry_ = nullptr;
};

}  // namespace ecs
