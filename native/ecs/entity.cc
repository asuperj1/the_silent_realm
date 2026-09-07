/**
 * entity.cc — EntityManager 实现。
 *
 * 防悬垂语义边界（reviewer T-1）：`++generation` 先于 `erase` 执行，
 * 增量随移除被丢弃、不持久；会话内 id 单调递增不复用，故 generation
 * 防悬垂为纵深防御。`Clear()` 后重建可能复现同 id —— teardown 边界。
 */

#include "entity.h"

namespace ecs {

Entity EntityManager::CreateEntity(uint32_t typeHash) {
    // 低 32 位：该类自增序列（从 1 起，确保 id ≠ kInvalidEntityId=0）。
    const uint32_t low = ++sequences_[typeHash];
    const EntityId id =
        (static_cast<EntityId>(typeHash) << 32) | static_cast<EntityId>(low);

    Entity e;
    e.id = id;
    e.generation = 1;  // 新实体代数从 1 开始
    e.isAlive = true;
    entities_[id] = e;
    return e;  // 值语义副本
}

Entity EntityManager::CreateEntity(const std::string& category) {
    return CreateEntity(fnv1a32(category));
}

Entity* EntityManager::GetEntity(EntityId id) {
    auto it = entities_.find(id);
    if (it == entities_.end() || !it->second.isAlive) {
        return nullptr;  // 不存在 / 已销毁
    }
    return &it->second;
}

const Entity* EntityManager::GetEntity(EntityId id) const {
    auto it = entities_.find(id);
    if (it == entities_.end() || !it->second.isAlive) {
        return nullptr;
    }
    return &it->second;
}

bool EntityManager::DestroyEntity(EntityId id) {
    auto it = entities_.find(id);
    if (it == entities_.end() || !it->second.isAlive) {
        return false;  // 不存在 / 已销毁 → 幂等失败
    }
    it->second.isAlive = false;
    ++it->second.generation;  // 防悬垂（纵深防御；随 erase 不持久）
    entities_.erase(it);      // 移除，存储集 = 存活集
    return true;
}

bool EntityManager::IsValid(EntityId id, uint32_t generation) const {
    auto it = entities_.find(id);
    return it != entities_.end() &&
           it->second.generation == generation &&
           it->second.isAlive;
}

bool EntityManager::IsAlive(EntityId id) const {
    return GetEntity(id) != nullptr;
}

std::size_t EntityManager::Size() const {
    return entities_.size();
}

void EntityManager::Clear() {
    entities_.clear();
    sequences_.clear();
}

}  // namespace ecs
