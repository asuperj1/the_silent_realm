# ⚙️ native/ — C++ N-API ECS 引擎

> **C++ 原生引擎（预研）**：基于 N-API（node-addon-api）的 ECS（Entity-Component-System）战斗引擎。

## 📁 结构

```
native/
├─ binding.gyp                  node-gyp 构建配置
├─ battle_engine.cc             N-API 绑定入口（战斗引擎原生接口）
├─ ecs/                         C++ ECS 核心
│  ├─ ecs_types.h               ECS 类型
│  ├─ entity.h / entity.cc      实体（Entity）
│  ├─ component.h               组件（Component）
│  ├─ event_bus.h / event_bus.cc  事件总线
│  └─ system_factory.h / system_factory.cc  系统工厂
├─ test/
│  └─ test_engine.js            原生引擎 Node 测试
└─ build/                       node-gyp 编译产物（已被 .gitignore 排除）
```

## 🔨 构建

```bash
# 需要本机 C++ 工具链（Windows: VS Build Tools + Python + node-gyp）
npm run build:native        # node-gyp rebuild --directory=native
npm run test:native         # node native/test/test_engine.js
```

产物：`native/build/Release/battle_engine.node`

## ⚠️ 当前状态

- ✅ **已编译通过**，`battle_engine.node` 可产出。
- ❌ **尚未接入生产逻辑**：当前服务端战斗由纯 JS `server/battleEngine.js` 执行，仓库代码中暂无 `require` 原生模块的调用。
- 🎯 **定位**：作为 JS 战斗引擎的**性能演进预研**（ECS 架构），在战斗逻辑稳定后评估接入（或冻结以避免 JS/C++ 双实现分叉）。

> 架构上下文见 [`server/README.md`](../server/README.md)。
