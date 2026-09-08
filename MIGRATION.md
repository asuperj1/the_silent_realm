# 迁移说明 · MIGRATION

> 本仓库 `the_silent_realm` = **寂静之地 · Web 页游版（已封存存档）**。

## 仓库定位

| 项 | 说明 |
| --- | --- |
| 当前内容 | Web 页游版：原生 HTML/CSS/JS 前端 + Node/Express/Socket.IO 服务器 + DeepSeek AI(KP) |
| 封存点 | 提交 `d87b1d8` · 标签 `v2026.09-web-legacy` · 分支 `main`（唯一分支） |
| 维护状态 | **只读存档**，不再迭代功能 |
| 下一版本 | C++ + 游戏引擎（Epic 发布 · 饥荒式联机）桌面重构 → 将**另建独立仓库**开发 |

## 为什么另建仓库

下一版本采用不同技术栈与工程结构（C++ 核心 / 游戏引擎 / 桌面分发），与当前 JS/Node 工程差异巨大，共仓会造成路径、资源与历史混淆。故本仓库仅作**历史玩法存档与功能对照**，新版本使用全新仓库从零搭建。

## 本仓库速览（运行与结构）

```bash
npm install        # 安装依赖
npm start          # 启动服务器 → 浏览器打开 http://localhost:3000
npm test           # 运行测试（24 项）
```

| 目录 | 内容 |
| --- | --- |
| `server/` | Node 服务端（domain handlers / 战斗引擎 / 物品 / AI KP / 持久化）→ `server/README.md` |
| `frontend/` | 原生前端（大厅 / 地图 / 战斗 / 角色 / 工坊）→ `frontend/README.md` |
| `config/` | 数据配置（13 职业 / 技能 / 怪物 / 物品）→ `config/README.md` |
| `native/` | C++ N-API ECS 预研（已编译未接入）→ `native/README.md` |
| `docs/` | 设计文档 / 战斗方案 / 副本设计 |
| `assets/` `bgm/` `public/` | 2D 美术 / 音乐 / 封面资源 |
| `tests/` `tools/` | 自动化测试 / 验证与演示脚本 → `tools/README.md` |
| `.agent/` `.github/` | 多 Agent 开发工作流（AGENTS.md） |

> 全部模块 README 见根 [`README.md`](README.md) 目录树。

## 从封存版恢复/对照

```bash
git checkout main            # 本仓库唯一分支
git tag v2026.09-web-legacy  # 封存锚点（已存在）
```

下一版本开发请使用新建仓库；如需复用现有资产（`assets/` 美术、`config/` 数值、`docs/` 方案），从本仓库直接拷贝即可。
