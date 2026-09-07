# 🎨 frontend/ — 原生前端

> **零依赖原生 HTML / CSS / JS**（无框架，~12.6k 行 + 组件），Canvas 视觉，通过 Socket.IO 与服务端实时通信。

## 📄 页面

| 入口 | 说明 |
| --- | --- |
| `index.html` | 主游戏（大厅 → 副本 → 角色档案多标签） |
| `mapEditor.html` | 地图编辑器 |
| `auth/` | 登录 / 创建身份（login.html） |
| `public/cover.html` | 封面页（仓库根 `public/`） |

## 🗂 目录结构

```
frontend/
├─ index.html          主入口（按需引入脚本）
├─ auth/               登录页
├─ css/                全局样式（main.css / qingfengMap.css / goldBeams.css …）
├─ js/                 业务脚本（按功能拆分的独立文件）
│  ├─ client.js        主流程 + socket 事件中枢
│  ├─ client-hud.js    战斗 HUD / 资源条 / 机制进度条
│  ├─ battleScene.js   战斗场景（立绘 / 意图气泡 / 血条 / 动画接口）
│  ├─ qingfengMap.js   青峰山地图 / 场景切换
│  ├─ charDetail.js    角色档案（8 标签：概况/背包仓库/任务/技能树/属性/工坊/商店/记录）
│  ├─ skillTree.js     技能树（流派 / 节点 / innate 必备 / 详情浮窗）
│  ├─ attrAllocate.js / attrSlider.js   属性分配 / 拉条
│  ├─ workshop 商店 / 仓库 / 寄售拍卖相关
│  ├─ components/      UI 组件内核
│  │  ├─ ItemGrid.js       物品网格（内核）
│  │  ├─ WarehouseGrid.js / InventoryGrid.js / EquipMaterialGrid.js
│  └─ 地图/音效/设置/结算/投票/道具/线索等其余模块
```

## 🧩 模块分组

| 领域 | 脚本 |
| --- | --- |
| 大厅 / 房间 | `roomHall.js` `roomHallSocket.js` `loginLogout.js` |
| 地图 / 场景 | `qingfengMap.js` `isometricBg.js` `mapMarkers.js` `mapCoordinateSystem.js` `sceneLoader.js` `bgSwitcher.js` `cluePanel.js` |
| 战斗 | `battleScene.js` `client-hud.js`（能量池 / LOL HUD / 意图 / 资源条） |
| 角色 / 成长 | `charDetail.js` `attrAllocate.js` `attrSlider.js` `skillTree.js` `skillSetup.js` `questBoard.js` |
| 经济 | 工坊 / 商店 / 寄售拍卖 / 仓库（`warehouse.js` `itemCatalog.js` `client-shop.js`） |
| 系统 | `sound.js` `settingsPanel.js` `settlement.js` `client-vote.js` `copySelectTransition.js` `goldParticles.js` |

## 🔄 通信模型

- 浏览器侧 Socket 客户端监听服务端事件：`battleStart` / `battleTurn` / `battleEvent` / `battleIntent` / `exploreRound` / `publicMsg` …
- 战斗场景通过 `window.BattleScene`（`enter / updateStatus / floatText / impact / lunge`）驱动立绘与演出。
- 角色详情 8 标签通过 `charDetail.js` 与各模块脚本联动。

> 服务端详见 [`server/README.md`](../server/README.md)；总体见仓库根 [`README.md`](../README.md)。
