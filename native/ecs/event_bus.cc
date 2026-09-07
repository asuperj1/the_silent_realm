/**
 * event_bus.cc — EventBus 非模板成员实现。
 *
 * 仅实现与具体事件类型无关的存储操作（Clear / RemoveType / HandlerCountOf /
 * PublishRaw）；Subscribe/Publish 等模板成员在 event_bus.h 内联（依赖具体事件类型，
 * 必须在头文件可见）。单线程约定：不做同步。
 */

#include "event_bus.h"

namespace ecs {

void EventBus::Clear() {
    handlers_.clear();
}

void EventBus::RemoveType(const std::type_index& ti) {
    handlers_.erase(ti);
}

std::size_t EventBus::HandlerCountOf(const std::type_index& ti) const {
    auto it = handlers_.find(ti);
    return it == handlers_.end() ? 0 : it->second.size();
}

std::size_t EventBus::PublishRaw(const std::type_index& ti, const void* payload) {
    auto it = handlers_.find(ti);
    if (it == handlers_.end()) return 0;
    // 按注册序（vector 序）触发；payload 已由调用方保证指向 T 类型对象。
    // 约束：分发期间回调不得对同一事件类型再入修改订阅（迭代器失效 UB）。
    for (const RawHandler& h : it->second) {
        h(payload);
    }
    return it->second.size();
}

}  // namespace ecs
