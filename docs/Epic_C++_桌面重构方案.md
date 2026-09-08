# Epic 发布 · 全 C++ 桌面重构方案（饥荒式联机）

> 目标：把「寂静之地」做成**桌面软件，全 C++ 重构，发布到 Epic Games Store**；联机采用**饥荒（Don't Starve）式**：单机即本地世界，多人时**房主主机（Listen Server）**承载世界，其他玩家经 Epic 在线服务加入。
> 本方案取代旧版（`C++_游戏引擎_重构方案.md` 的 Web/Godot+Node 假设），面向**桌面 + 商店发行**。

---

## 〇、需求与约束确认

| 需求 | 含义与影响 |
| --- | --- |
| 全部用 C++ | 引擎绑定 C++/自研 C++；服务端职责并入 C++（**不再需要 Node** 运行时） |
| 形成软件 / 桌面 | Windows 优先（Epic 商店仅桌面），可选后续 mac/Linux |
| 发布到 Epic Games Store | 需 **EOS（Epic Online Services）**：账号登录、好友、大厅、P2P/relay、成就、云端存档 |
| 饥荒式联机 | 单人=进程内本地世界；多人=房主进程同时是**权威服务器（Listen Server）**；客机仅发输入/渲染 |

> 由此，原先的 `server/`（38 个 Node 模块：AI KP、存档、房间、战斗权威、交易……）将**整体移植为 C++ 模块**，作为"可嵌入主进程的本地/主机服务器"复用——这正是饥荒等游戏的做法。

---

## 一、架构蓝图（饥荒式 · 单进程三态）

```mermaid
flowchart TD
  subgraph EXE["游戏进程（同一种 C++ 可执行）"]
    APP[App 壳 / 平台层]
    subgraph MODE["世界模式"]
      SOLO[单人 · 本地世界<br/>world 内嵌 + 本地存档]
      HOST[多人房主 · Listen Server<br/>world = 权威 + 网络层开服]
      CLIENT[多人客机 · 渲染/输入<br/>发指令给房主]
    end
    CORE[battle_core + world + AI_KP<br/>纯 C++ 逻辑（无 IO/UI 依赖）]
    UI[2D UI / 场景渲染]
  end
  subgraph EOS["Epic Online Services（C++ SDK）"]
    AUTH[Auth 登录] FR[Friends] LOB[Lobbies] P2P[P2P/relay NAT] SAVE[Player Data 云存档] STAT[Achievements]
  end
  MODE --> CORE
  CLIENT --> P2P --> HOST
  APP --> AUTH & FR & LOB & SAVE & STAT
  CORE -.DeepSeek API 调用.-> LLM[DeepSeek 远端]
```

- **同一可执行**根据启动参数/流程进入三态之一；单人即 `SOLO`，建房即 `HOST`（内嵌一个 headless 权威 world），加入即 `CLIENT`。
- **数据权威在 world**（房主/单机进程内），客机不发世界逻辑只发输入——天然防作弊基线 + 饥荒式一致体验。

---

## 二、引擎选型（全 C++ + 2D 强 UI + 桌面）

| 方案 | 2D/UI | C++ 满足度 | Epic/EOS | 饥荒式 | 工程/风险 | 契合度 |
| --- | --- | --- | --- | --- | --- | --- |
| **Godot 4（GDExtension 全 C++）** | ★★★★★ | 高：核心全 C++，仅极薄 GDScript 可后置为 0 | EOS 需自绑定 C++ SDK（社区已有整合先例） | 单进程 Listen Server 天然支持 | 中 | ✅ **主推荐** |
| **UE 5（Paper2D）** | 2D 弱（为 3D 设计） | 极高（C++ 一等公民） | ★★★★★ Epic 原生（在线服务+商店后台一体） | Replication 框架现成 | 中（但 2D 表现力要大量自制） | 备选（重度偏 Epic） |
| **自研 C++（SDL2/raylib+自制 UI+ECS）** | UI 全自建（本作 UI 密集是硬伤） | 100% | EOS 官方 C++ 直链 | 最贴饥荒本尊 | 高（引擎轮子全自造） | 备选（追求完全掌控） |

### 主推荐：Godot 4.x（桌面包）+ 全 C++ 核心（GDExtension）

理由：
1. **本作是"2D + 海量 UI"的 TRPG**——角色档案/技能树/背包/工坊/商店这类 Control 界面，Godot 生产力远超 UE，又不用像自研那样从零写 UI/字体/动画管线。
2. **C++ 真正承载一切可复用逻辑**：世界状态、`battle_core`（把现有 `server/battleEngine.js` 移植）、AI(KP) 客户端、存档/反序列化、网络权威——全部 C++（GDExtension 扩展类）；GDScript 只做"界面事件→调用 C++ 扩展"的最薄胶水（可逐步清零）。
3. **饥荒式在单进程内实现**：Godot 进程既能渲染又能 `--headless`/后台跑权威 world + `WebSocket/UDP` 监听；房主即 host，客机同工程连入。
4. 免费无引擎分成，Epic 商店 88/12；EOS 用官方 **C++ SDK** 自建一薄层绑定（账号/大厅/P2P/云存档）。

> 若你更看重"Epic 官方全家桶 + 网络复制现成"而非 2D 表现力，选 **UE5 + Paper2D/Spine**；若你想彻底像饥荒那样拥有引擎，选**自研 C++**——但 UI 量是本作最大成本，需慎重。

---

## 三、C++ 模块规划（原 Node server 职责归位）

| 原 Node 模块 | C++ 落点（`shared/cpp` / `core/`） |
| --- | --- |
| `server/battleEngine.js` · `battleCore.js` | `core/battle/battle_core.cpp`（回合/伤害链/状态/13 职业机制/意图）；迁移并保留 `native/ecs` 结构 |
| `server/battleStats.js` 属性公式 | `core/combat/stats.cpp` |
| `server/storage.js` · `roomPersistence.js` | `core/save/save_mgr.cpp`（本地）+ EOS Player Data Storage（云存档） |
| `server/qingfengTrain.js` · `qingfengEnding.js` | `core/world/qingfeng_dungeon.cpp`（剧本/任务/结局状态机） |
| `server/deepseekClient.js` + AI 叙事 | `core/ai/kp_client.cpp`（C++ HTTP/WS 调 DeepSeek，含节流/敏感词） |
| `server/questSystem/market/trade/workshop` | `core/systems/*.cpp`（实体化进 ECS） |
| `server/eventBus/timerScheduler` | `core/ecs/event_bus.cpp`（沿用 `native/ecs`） |
| 原 `frontend/` 全部 UI/场景 | `client/` Godot 场景 + GDScript 薄胶水 |
| 联机（原 Socket.IO 房间） | `net/`：单人=SOLO；多人=EOS Lobby → P2P/relay，权威在 host world |

> C++ 分层：`core/`（纯逻辑、无 UI/无引擎依赖，可单元测试）→ `net/`（Listen Server 网络层）→ `engine_bridge/`（Godot GDExtension 薄封装）→ `client/`（Godot 场景/表现）。

---

## 四、网络与平台（饥荒式 + EOS）

```
多人流程：
房主：创建 EOS Lobby（公开/仅好友）→ 起 Listen Server(world) → 等待加入
好友：EOS 大厅列表/邀请 → 加入 → P2P 直连（失败自动 relay）
世界权威：房主进程内（world 每 tick 广播状态；客机发"输入/指令"）
```

- **NAT**：EOS **P2P**（direct → relay 兜底），或用 UDP 自建 + STUN/TURN（可选不依赖 EOS 网络，仅用 EOS 账号/好友/大厅）。
- **反作弊**：权威在房主已有天然防护；需竞技化再上 EOS Anti-Cheat。
- **存档**：单机本地（`.sav` 反序列化，参考饥荒世界存档）；多人由房主存档；可选 EOS 云存档同步。
- **Epic 商店**：提交需 Dev Portal 配置 App ID/EOS Product、商店素材、合规；分发即标准 Epic 提交流程。

---

## 五、VS Code 工作流

| 用途 | 工具/扩展 |
| --- | --- |
| Godot 工程 | **Godot Tools**（`client/project.godot` 调试/导出桌面） |
| C++（core + GDExtension + EOS） | **C/C++** + **clangd** + **CMake Tools**；`vcpkg` 管 EOS SDK 依赖 |
| 构建/任务 | `.vscode/tasks.json`：`cmake --build`（core 单测 / GDExtension / 桌面包）· `godot --export-release Windows` |
| 测试 | C++ 单元测试（battle_core 对拍原 `tools/verify-mechanics.js` 用例） |
| 多根 | `code-workspace`：`core/` `net/` `client/` `server/`(保留期) |

目录建议：
```
coc-rpg-game/
├─ core/            # C++ 纯逻辑（battle/world/ai/save/systems）— 单测
├─ net/             # C++ Listen Server / 协议 /（可选 EOS 网络）
├─ client/          # Godot 4 工程（scenes + GDScript 薄胶水 + GDExtension bridge）
├─ engine_bridge/   # GDExtension 绑定（godot-cpp）
├─ external/        # godot-cpp / EOS SDK（vcpkg 或 submodule）
├─ server/  config/ assets/ docs/   # 迁移期保留（数据/资源/参考）
└─ tools/verify-mechanics.js        # 移植成 C++ 单测基线
```

---

## 六、迁移路线

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| **M0 桌面壳 + 单机** | Godot 桌面空壳启动；`core/battle_core.cpp` 移植最小路径，单测对拍 JS 结果一致；单人进入副本（调用 core world） | Windows 桌面可单机跑一局 |
| **M1 世界与存档** | 把 qingfeng 剧本/存档移植为 `core/world`；`save_mgr` 本地读存；DeepSeek KP 走 `core/ai` | 单机完整副本+AI 叙事 |
| **M2 饥荒式多人** | Listen Server：房主建房 + 客机加入（先用本机回环 TCP/UDP，再换 EOS）；权威在 host | 双开房间联机一致 |
| **M3 EOS + 商店** | EOS Auth/Friends/Lobbies/P2P/云存档接入；Epic Dev Portal 配置；商店打包 | 好友经 EOS 加入；商店提交包体 |
| **M4 系统 UI + 打磨** | 角色/技能树/背包/工坊/商店 UI 全 C++ 化收尾；性能/反作弊可选 | 正式发布候选 |

> Node 服务端与现有 Web 前端在 M0–M1 期继续可用（回归对照），M2 后逐渐退役。

---

## 七、风险与对策

| 风险 | 对策 |
| --- | --- |
| 2D UI 量巨大（12640 行前端） | Godot Control 做 UI，C++ 只承载逻辑；按系统分批（M4） |
| "全 C++"若含 UI 脚本 → Godot GDScript 摩擦 | 用 GDExtension 扩展类把交互也 C++ 化，GDScript 缩到最小/移除 |
| 原 JS 战斗逻辑移植偏差 | 以 `tools/verify-mechanics.js` 全用例作 C++ 单测，逐条通过再前进 |
| EOS + Godot 无官方集成 | 官方 **EOS C++ SDK** 自建一薄层（约数百行）；或仅用 EOS 账号/大厅 + 自建 UDP（NAT 自处理）降低耦合 |
| Listen Server 房主网络/掉线 | 房主转移（Host migration）或采用"本地世界=房主存档"的饥荒策略（掉线由房主档续） |
| Epic 审核/商店流程 | 提前 Dev Portal 注册 EOS Product；合规（隐私/政策）准备 |

---

*关联：旧版 `docs/C++_游戏引擎_重构方案.md`（Web 假设，已不适用于本目标）、`docs/职业特殊机制实装方案.md`、`native/ecs/`、`server/battleEngine.js`。*
