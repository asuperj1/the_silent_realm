# Issue Index

| Issue ID | 标题 | 状态 | 关联 ADR | 指派 |
| -------- | ---- | ---- | -------- | ---- |
| ISSUE-001 | T-2 收尾遗留：通用副本全局行动首调 onError 无客户端提示（玩家静默无响应） | open | ADR-002 (T-2) | 待指派 |
| ISSUE-002 | T-2 收尾遗留：.stat-options-wrapper / .stat-options-table 无 CSS 样式规则 | open | ADR-002 (T-2) | 待指派 |
| ISSUE-003 | T-2 收尾遗留：test_t2_verify.py docstring 无效转义 \m（Python 3.12+ SyntaxWarning） | **closed**（2026-08-07 已改 `r"""` 修复） | ADR-002 (T-2) | 已完成 |
| ISSUE-004 | T-1 遗留：4 个新场景（tunnel-crypt/village-house/altar-ruin/rift-edge）无专属 CSS overlay 类，走 default-overlay 兜底 | open | ADR-006 (T-1) | 待指派 |
| ISSUE-005 | T-1 遗留：require 大小写系统性隐患（server.js/room.js/socketHandler.js 用小写 gamelogic，Linux 部署失败） | open | ADR-006 (T-1) | 待指派 |
| ISSUE-006 | T-1 遗留：副本名 vs 场景名两集合不相交（休眠路径），未来一致时需确认真实切换生效 | open | ADR-006 (T-1) | 待指派 |
| ISSUE-007 | T-1 遗留：scenes.json 含 UTF-8 BOM（Node 可解析，Python 需 utf-8-sig） | open | ADR-006 (T-1) | 待指派 |
| ISSUE-008 | T-2 遗留：src/battle/AttrFormula.js 与 frontend/js/client.js L461 仍各自硬编码职业数据（与 professions.json 二次分叉） | open | ADR-006 (T-2) | 待指派 |
| ISSUE-009 | T-3 遗留：C++ 引擎编译环境依赖（缺 VS Build Tools + node-addon-api 未装 + binding.gyp 缺 C++17/NAPI_VERSION 配置），装工具链后执行 build:native 复测 | open | ADR-007 (T-3) | 待指派 |
| ISSUE-010 | 长期：client.js ES Module 全量拆分（当前 2006 行，可按 window.* 全局模式增量抽脚本） | open | ADR-007 (T-7) | 待指派 |
| ISSUE-011 | 长期：副本框架抽象（通用引擎，当前仅 qingfengTrain 1 个副本，第 2 个副本需求驱动时实施） | open | ADR-007 (T-7) | 待指派 |
| ISSUE-012 | 长期：Redis 会话/房间状态（当前内存 Map + 24h 过期，生产化部署时实施） | open | ADR-007 (T-7) | 待指派 |
| ISSUE-013 | 长期：bgSwitcher DUNGEON_BG_POOL 第 4 份场景映射（副本名键/多图池，语义不同，与 scenes.json 统一或独立维护） | open | ADR-007 (T-7) | 待指派 |
| ISSUE-014 | T-5 遗留：concurrency_test.js L343 事件名错误 getPublicRooms → getRoomList，且 main() 未 gate 返回值 | open | ADR-007 (T-5) | 待指派 |
| ISSUE-015 | T-5 遗留：concurrency_test.js privateAction 用例依赖 DeepSeek 实时 + 串行队列，12s 超时过短，需约定降级口径 | open | ADR-007 (T-5) | 待指派 |
