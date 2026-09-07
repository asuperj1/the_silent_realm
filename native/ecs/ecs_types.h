/**
 * ecs_types.h — ECS 物品系统 · 公共类型
 *
 * 层级 0：全项目唯一无任何 ecs 内部 include 的头文件（无循环依赖根）。
 * 仅依赖标准库；供 entity.h / component.h / event_bus.h / system_*.h 引用。
 * 依赖约定（ADR-013）：层级 1 的头文件均只依赖本文件。
 */

#pragma once

#include <cstdint>
#include <cstddef>
#include <string>

namespace ecs {

// ==================== 基础别名 ====================

// 全局唯一实体 ID：高 32 位 = FNV-1a32(模板大类 hash)，低 32 位 = 该类自增序列。
using EntityId = uint64_t;

// 字符串 ID 别名（模板ID / 技能ID / 音效VFX / tag 等）。
using string_id = std::string;

// 保留无效 ID（ItemFactory 未知名模板等场景返回）。
constexpr EntityId kInvalidEntityId = 0;

// ==================== ComponentType ====================
// docs 1.5 注释"6个Pool"为笔误：实际仅 5 个 Component（reviewer 已确认按 5 实现）。
enum class ComponentType : uint8_t {
    Clue = 0,        // 线索
    Consumable = 1,  // 消耗品
    Equipment = 2,   // 装备
    Tag = 3,         // 标签
    Weight = 4,      // 负重
    COUNT = 5,       // 组件数量（预留扩展位：新增组件从 COUNT 之后追加）
};

static_assert(static_cast<int>(ComponentType::COUNT) == 5,
              "ComponentType::COUNT 必须为 5（仅 5 个 Component）");

// ==================== ClueType ====================
enum class ClueType : uint8_t {
    KeyClue = 0,   // 关键线索
    SideClue = 1,  // 支线线索
    FakeClue = 2,  // 虚假线索（米·戈伪造）
};

// ==================== EffectType ====================
// docs 1.3.2 定义 7 值；SPECIAL 为扩展值，建模 CS008 万能钥匙"特殊"效果（reviewer B3）。
enum class EffectType : uint8_t {
    HP_RESTORE = 0,   // 生命恢复
    SAN_RESTORE = 1,  // 理智恢复
    BUFF_TEMP = 2,    // 临时增益
    CURE_WOUND = 3,   // 治疗状态（解除恐惧/混乱）
    PURGE_VOID = 4,   // 虚空净化（免疫毒雾）
    LIGHT_SOURCE = 5, // 光源
    REPAIR = 6,       // 修理
    SPECIAL = 7,      // 特殊（CS008 万能钥匙）
};

// ==================== EquipSlot ====================
enum class EquipSlot : uint8_t {
    WEAPON = 0,
    ACCESSORY = 1,
    ARMOR = 2,
    LIGHT_SOURCE = 3,
};

// ==================== TargetScope ====================
enum class TargetScope : uint8_t {
    SELF_ONLY = 0,
    SINGLE_ALLY = 1,
    ALL_PARTY = 2,
    SINGLE_ENEMY = 3,
};

// ==================== LoreCategory ====================
enum class LoreCategory : uint8_t {
    VOID = 0,    // 虚空系
    MORTAL = 1,  // 凡人系
    MYTHOS = 2,  // 神话系
    RUINS = 3,   // 遗迹系
    TRAIN = 4,   // 列车系
};

// ==================== Rarity ====================
enum class Rarity : uint8_t {
    Common = 0,
    Uncommon = 1,
    Rare = 2,
    Epic = 3,
    Junk = 4,  // 垃圾（CL003/CL014）
};

// ==================== 属性维度常量 ====================
// EquipmentComponent.attrBonuses 的 7 属性下标约定（docs 1.3.3）：[HP, SAN, STR, DEX, CON, PER, WIL]
enum AttrIndex : uint8_t {
    kAttrHP = 0,
    kAttrSAN = 1,
    kAttrSTR = 2,
    kAttrDEX = 3,
    kAttrCON = 4,
    kAttrPER = 5,
    kAttrWIL = 6,
};
constexpr uint32_t kAttrCount = 7;  // 属性维度数

// ==================== FNV-1a32（EntityId 高 32 位） ====================
constexpr uint32_t kFnv1a32OffsetBasis = 2166136261u;
constexpr uint32_t kFnv1a32Prime = 16777619u;

// 计算字符串的 FNV-1a32 哈希（header-only，供 EntityManager / ItemFactory 使用）。
inline uint32_t fnv1a32(const char* data, std::size_t len) noexcept {
    uint32_t h = kFnv1a32OffsetBasis;
    for (std::size_t i = 0; i < len; ++i) {
        h ^= static_cast<uint8_t>(data[i]);
        h *= kFnv1a32Prime;
    }
    return h;
}

inline uint32_t fnv1a32(const std::string& s) noexcept {
    return fnv1a32(s.data(), s.size());
}

}  // namespace ecs
