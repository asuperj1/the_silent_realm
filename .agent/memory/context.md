# Agent Context

本文件为项目上下文参考（人工可读），**状态一律以 `.agent/memory/state.json` 为准**，由 `statectl.py` 唯一维护，请勿在此重复记录状态字段，以免漂移。

## 最近修改的文件

last_modified_files: []

## 开发约定（2026-08-07 用户设定，所有 Agent 必须遵守）

- **技术栈**：主业务为 JS / C++；Python 仅用于编写测试脚本，不承载业务逻辑。
- **Python 环境**：所有 Python 相关代码、`pip` 安装依赖，**必须**使用 conda 环境 `coc_rpg_env`（解释器路径：`E:\miniconda3\envs\coc_rpg_env\python.exe`）。
- **输出 Python 脚本时**：必须附带终端"激活 + 运行"的完整命令。
- **JS / C++ 代码**：无需调用 conda 环境，正常输出即可。
- **代码组织**：所有代码按功能拆分独立文件、标注路径。
- **交付格式**：每轮交付末尾必须添加【本轮交付汇总】。

## 备注

- 查看当前状态：`python .agent/statectl.py current`
- 状态转换：`python .agent/statectl.py transition <state> [--retry] [--complete-task] [--interrupt]`
- 完整定义见 `.github/agents/orchestrator.agent.md` 与根目录 `AGENTS.md`
