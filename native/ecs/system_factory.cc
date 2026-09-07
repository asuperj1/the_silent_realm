/**
 * system_factory.cc — ItemTemplateRegistry / ItemFactory 实现。
 *
 * Create 流程（docs 1.4.1）：查注册表 → EntityManager::CreateEntity（高 32 =
 * FNV-1a32(主类名)）→ 按 componentMask 逐项 ComponentPoolArray::Add<T>（填模板默认值）
 * → 有 generatorFunc 则调用（模板只读 const&，可对已落位 Component 随机化）
 * → EventBus::Publish<ItemCreated>。
 * 未知模板 / 未绑定依赖 → kInvalidEntityId（幂等，不崩溃）。
 */

#include "system_factory.h"

#include <utility>

namespace ecs {

// ==================== ItemTemplateRegistry ====================
bool ItemTemplateRegistry::Register(ItemTemplate tpl) {
    const bool existed = templates_.find(tpl.templateId) != templates_.end();
    templates_[tpl.templateId] = std::move(tpl);  // 覆盖旧值
    return !existed;  // 新注册 → true；覆盖已存在 → false（幂等）
}

const ItemTemplate* ItemTemplateRegistry::Get(const string_id& templateId) const {
    auto it = templates_.find(templateId);
    return it == templates_.end() ? nullptr : &it->second;
}

bool ItemTemplateRegistry::Has(const string_id& templateId) const {
    return templates_.find(templateId) != templates_.end();
}

std::size_t ItemTemplateRegistry::Size() const {
    return templates_.size();
}

void ItemTemplateRegistry::Clear() {
    templates_.clear();
}

// ==================== ItemFactory ====================
void ItemFactory::Bind(EntityManager& entities, ComponentPoolArray& pools, EventBus& bus,
                       const ItemTemplateRegistry& registry) {
    entities_ = &entities;
    pools_ = &pools;
    bus_ = &bus;
    registry_ = &registry;
}

EntityId ItemFactory::Create(const string_id& templateId) {
    // 前置：任一依赖未绑定 → 无效 id，不崩溃。
    if (entities_ == nullptr || pools_ == nullptr || bus_ == nullptr || registry_ == nullptr) {
        return kInvalidEntityId;
    }

    const ItemTemplate* tpl = registry_->Get(templateId);
    if (tpl == nullptr) return kInvalidEntityId;  // 未知模板

    // 1. 创建实体：高 32 = FNV-1a32(主类名)，低 32 = 该类自增。
    const Entity e = entities_->CreateEntity(CategoryName(tpl->category));

    // 2. 按 componentMask 逐项 AddComponent（填模板默认值）。
    const ComponentMask mask = tpl->componentMask;
    if (mask.Has(ComponentType::Clue))       pools_->Add(e.id, tpl->clue);
    if (mask.Has(ComponentType::Consumable)) pools_->Add(e.id, tpl->consumable);
    if (mask.Has(ComponentType::Equipment))  pools_->Add(e.id, tpl->equipment);
    if (mask.Has(ComponentType::Tag))        pools_->Add(e.id, tpl->tag);
    if (mask.Has(ComponentType::Weight))     pools_->Add(e.id, tpl->weight);

    // 3. 有 generatorFunc → 调用（模板只读，可对已落位 Component 随机化）。
    if (tpl->generatorFunc) {
        tpl->generatorFunc(*tpl, e.id, *pools_);
    }

    // 4. 发送 ItemCreated。
    ItemCreated ev;
    ev.entityId = e.id;
    ev.templateId = templateId;
    bus_->Publish(ev);

    return e.id;
}

const char* ItemFactory::CategoryName(ComponentType c) {
    switch (c) {
        case ComponentType::Clue:       return "Clue";
        case ComponentType::Consumable: return "Consumable";
        case ComponentType::Equipment:  return "Equipment";
        case ComponentType::Tag:        return "Tag";
        case ComponentType::Weight:     return "Weight";
        default:                        return "Item";
    }
}

}  // namespace ecs
