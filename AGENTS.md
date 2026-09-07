# AGENTS.md — 多 Agent 工作流系统说明

本仓库实现了一套"编排器 + 专职子 Agent"的开发工作流，用状态机强制约束流程，确保任何代码修改都经过"澄清 → 规划 → 审查 → 批准 → 修改 → 测试 → 决策"。

## 目录结构

<table style="border-collapse:collapse; font-size:13px; font-family:Consolas,monospace; line-height:1.6;">
  <tr>
    <td style="padding:2px 14px 2px 0; font-weight:600;">.agent/</td>
    <td style="color:#64748b;">核心基础设施</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;├─ config.yaml</td>
    <td style="color:#64748b;">配置（重试上限、记忆路径、测试命令、审查管道）</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;├─ instruction.md</td>
    <td style="color:#64748b;">Orchestrator 指令（orchestrator.agent.md 的镜像）</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;├─ statectl.py</td>
    <td style="color:#64748b;">状态机脚本 —— 唯一允许操作状态文件的入口</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;├─ report-template.html</td>
    <td style="color:#64748b;">报告模板（自包含 HTML，参照 improve-codebase-architecture 样式）</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;├─ reports/</td>
    <td style="color:#64748b;">每次审查/评估输出 HTML 报告的归档目录</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;└─ memory/</td>
    <td style="color:#64748b;">状态、ADR、issues、context（均为状态机的数据源）</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0; font-weight:600;">.github/agents/</td>
    <td style="color:#64748b;">6 个子 Agent 定义</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;├─ orchestrator.agent.md</td>
    <td style="color:#64748b;">编排器（主控，强制状态机）</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;├─ clarifier.md</td>
    <td style="color:#64748b;">需求澄清</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;├─ planner.md</td>
    <td style="color:#64748b;">任务规划</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;├─ reviewer.md</td>
    <td style="color:#64748b;">审查（架构/代码/ADR 一致性）</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;├─ coder.md</td>
    <td style="color:#64748b;">代码实现（仅可改文件内容，无文件系统权限）</td>
  </tr>
  <tr>
    <td style="padding:2px 14px 2px 0;">&nbsp;&nbsp;└─ tester.md</td>
    <td style="color:#64748b;">测试执行（只读代码库）</td>
  </tr>
</table>

## 状态机

<table style="border-collapse:separate; border-spacing:6px; width:100%; font-size:13px; text-align:center;">
  <tr>
    <td style="border:1px solid #94a3b8; border-radius:8px; padding:6px 10px; background:#f1f5f9; font-weight:600;">IDLE</td>
    <td style="color:#64748b; font-weight:600;">→</td>
    <td style="border:1px solid #94a3b8; border-radius:8px; padding:6px 10px; background:#f1f5f9; font-weight:600;">UNDERSTANDING</td>
    <td style="color:#64748b; font-weight:600;">→</td>
    <td style="border:1px solid #94a3b8; border-radius:8px; padding:6px 10px; background:#f1f5f9; font-weight:600;">PLANNING</td>
    <td style="color:#64748b; font-weight:600;">→</td>
    <td style="border:1px solid #3b82f6; border-radius:8px; padding:6px 10px; background:#eff6ff; font-weight:600;">EXECUTING</td>
    <td style="color:#64748b; font-weight:600;">→</td>
    <td style="border:1px solid #94a3b8; border-radius:8px; padding:6px 10px; background:#f1f5f9; font-weight:600;">FINISHED</td>
    <td style="color:#64748b; font-weight:600;">→</td>
    <td style="color:#94a3b8; font-size:12px;">回到 IDLE</td>
  </tr>
  <tr>
    <td colspan="11" style="padding-top:10px; font-size:12px; color:#64748b; text-align:left;">
      EXECUTING 周期内子状态（仅 <code>in_cycle=true</code> 时合法）：</td>
  </tr>
  <tr>
    <td style="border:1px dashed #3b82f6; border-radius:8px; padding:6px 10px; background:#eff6ff; font-weight:600;">REVIEWING</td>
    <td style="color:#64748b; font-weight:600;">→</td>
    <td style="border:1px dashed #3b82f6; border-radius:8px; padding:6px 10px; background:#eff6ff; font-weight:600;">MODIFYING</td>
    <td style="color:#64748b; font-weight:600;">→</td>
    <td style="border:1px dashed #3b82f6; border-radius:8px; padding:6px 10px; background:#eff6ff; font-weight:600;">TESTING</td>
    <td style="color:#64748b; font-weight:600;">→</td>
    <td style="border:1px dashed #3b82f6; border-radius:8px; padding:6px 10px; background:#eff6ff; font-weight:600;">DECIDING</td>
    <td colspan="4" style="color:#64748b; font-size:12px; text-align:left;">
      ↻ 回 EXECUTING 继续任务 ／ → FINISHED 收尾（DECIDING 是周期唯一出口）</td>
  </tr>
</table>

- 人工兜底状态 **HUMAN_DECISION**：重试达上限时由脚本强制进入；只能 `transition EXECUTING` 恢复周期，**不能直达子状态**。
- 子状态流转受动作前提约束，缺标志即被脚本拒绝（见下方核心规则 6）。

### 核心规则

1. **状态唯一来源**：`state.json`（由 `statectl.py` 维护，已加入 `.gitignore`）。`context.md` 仅为人工可读参考，**禁止重复记录状态字段**。
2. 任何转换必须执行 `python .agent/statectl.py transition <state> [参数]`；退出码非零立即停止。
3. 需要人工决策的状态（`UNDERSTANDING` 等待确认、`REVIEWING` 等待批准、`HUMAN_DECISION`）必须停止等待用户。
4. Coder 只能改文件内容；文件增删由 Orchestrator 在方案批准后执行。
5. **子状态受周期约束**：`in_cycle=false` 时进入子状态会被脚本拒绝。
6. **动作前提由脚本强制**：`MODIFYING` 需 `--approved`；`DECIDING` 需 `--test-done`；`DECIDING→EXECUTING` 需 `--complete-task --test-passed`；`DECIDING→REVIEWING` 需 `--retry`。

## 常用命令

```bash
python .agent/statectl.py current          # 查看当前状态
python .agent/statectl.py history          # 查看转换历史
python .agent/statectl.py transition <STATE> [--approved] [--test-done] [--test-passed] [--retry] [--complete-task] [--interrupt] [--task-id T-1] [--push-task "描述"]
python .agent/statectl.py reset            # 重置为 IDLE（危险，交互确认）
```

> `--load-tasks` 会从最新 Plan ADR（`.agent/memory/adr/` 中标题含 PLAN 的文件）自动提取 `T-*` 任务填充队列。

## 报告输出

参照 `improve-codebase-architecture` 的报告样式（见 `.agent/report-template.html`），**每次审查 / 评估 / 状态报告都输出一份自包含 HTML 报告**：

- 保存到 `.agent/reports/<类型>-<YYYYMMDD-HHMMSS>.html`（类型如 `review`、`plan`、`test`、`decision`、`state`）。
- 样式：Tailwind CDN + Mermaid CDN；卡片式布局（Files / Problem / Solution / Wins / Before-After 图 / 推荐强度徽章）；结尾给出 Top recommendation（如需）。
- 报告写入后，在对话中告知绝对路径。
- 不适用图形时，可用 Markdown 表格 / 列表，但一律存档于 `.agent/reports/`。

## 维护约定

- **修改指令时**：以 `.github/agents/orchestrator.agent.md` 为准，同时同步 `.agent/instruction.md`，防止分叉。
- **新增重试策略**：改 `config.yaml` 的 `retry.max_retries_per_task`，脚本会自动读取；无需改代码。
- **新增 Agent**：在 `.github/agents/` 下新建 `<name>.md`，`tools` 白名单务必使用 VS Code 官方工具名（`<工具集>/<工具名>` 格式，如 `read/readFile`、`execute/runInTerminal`、`agent/runSubagent`、`web/fetch`、`todos`；完整清单见 VS Code 文档 Chat tools reference），避免声明无效工具名被静默忽略。
- **子 Agent 可见性**：仅作为子 Agent 被调度的角色（clarifier/planner/reviewer/coder/tester）必须加 `user-invocable: false`，从 Agent 选择器隐藏；主控（orchestrator）保持可见。
- **关系图不使用字符画**：Markdown 文档内的关系图一律用内联 HTML 表格 / 流式布局绘制，不用 ``` 代码块画 ASCII 图。
