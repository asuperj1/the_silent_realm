/**
 * entity.h — Entity 结构体 + EntityManager（增删查 / generation 防悬垂）
 *
 * 层级 1：仅依赖 ecs_types.h（无循环依赖根）。实现见 entity.cc。
 *
 * 防悬垂语义边界（reviewer T-1 补充）：
 *  - Destroy 时执行 `++generation` 后随即 `erase`，该增量随移除被丢弃、不持久；
 *    会话内 id 由单调递增序列保证不复用，故 generation 防悬垂在当前设计下为
 *    "纵深防御"（主机制 = 移除 + 单调序列），不构成独立可触发路径。
 *  - 唯一边界：`Clear()` 清空 sequences_ 后重建，可能复现相同 id ——
 *    此时 `IsValid(id, oldGeneration)` 可能误判，调用方须在 teardown 后重建引用。
 */

#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>

#include "ecs_types.h"

namespace ecs {

// ==================== Entity ====================
// docs 1.2：id 全局唯一；generation 代数计数器（防悬垂）；isAlive 存活标记。
struct Entity {
    EntityId id = kInvalidEntityId;  // 高32=FNV-1a32(模板大类)，低32=该类自增
    uint32_t generation = 0;         // 代数（Create 置 1，Destroy 时 ++）
    bool isAlive = false;            // false 时 System 跳过处理
};

// ==================== EntityManager ====================
// docs 1.1：实体容器（增删查）。内部 std::unordered_map<EntityId, Entity>。
class EntityManager {
public:
    EntityManager() = default;
    ~EntityManager() = default;

    // 禁止拷贝/移动：实体存储是唯一状态来源。
    EntityManager(const EntityManager&) = delete;
    EntityManager& operator=(const EntityManager&) = delete;

    // 创建实体：高32=typeHash，低32=该类自增序列（从1起，保证 id≠kInvalidEntityId）。
    // 返回 Entity 副本（值语义，安全；勿持有对内部存储的引用）。
    Entity CreateEntity(uint32_t typeHash);

    // 便捷重载：内部以 fnv1a32(category) 计算 typeHash。
    // category 取模板大类：如 "Clue" / "Consumable" / "Equipment"。
    Entity CreateEntity(const std::string& category);

    // 按 id 取实体；不存在或已销毁 → nullptr。
    Entity* GetEntity(EntityId id);
    const Entity* GetEntity(EntityId id) const;

    // 销毁：置 isAlive=false 且 generation++（防悬垂）后从容器移除。
    // 已销毁/不存在 → false（幂等）。
    bool DestroyEntity(EntityId id);

    // 陈旧引用校验（防悬垂）：id 存在 && generation 匹配 && 存活。
    // 调用方保存 (id, generation) 后，以此确认引用是否仍有效。
    bool IsValid(EntityId id, uint32_t generation) const;

    // 便捷：实体当前是否存活。
    bool IsAlive(EntityId id) const;

    // 当前存储实体数（销毁即移除，故 = 存活数）。
    std::size_t Size() const;

    // 清空全部实体与序列计数（幂等）。
    void Clear();

private:
    std::unordered_map<EntityId, Entity> entities_;      // id → Entity（唯一来源）
    std::unordered_map<uint32_t, uint32_t> sequences_;   // typeHash → 下一低32位
};

}  // namespace ecs
