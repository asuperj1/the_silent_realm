#!/usr/bin/env python3
"""Agent 状态管理脚本：强制执行合法状态转换。

两级状态模型：
- 顶层状态：IDLE/UNDERSTANDING/PLANNING/EXECUTING/FINISHED/HUMAN_DECISION
- 子状态：REVIEWING/MODIFYING/TESTING/DECIDING（仅 EXECUTING 周期内合法，由 in_cycle 标记）

动作前提（机器强制）：
- REVIEWING->MODIFYING 需 --approved
- TESTING->DECIDING   需 --test-done
- DECIDING->REVIEWING 需 --retry
- DECIDING->EXECUTING 需 --complete-task --test-passed
"""

import json
import os
import re
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

# 项目根目录 = 本脚本所在目录（.agent/）的父目录，避免依赖调用时的 CWD
PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = PROJECT_ROOT / ".agent" / "memory" / "state.json"
CONFIG_FILE = PROJECT_ROOT / ".agent" / "config.yaml"
ADR_DIR = PROJECT_ROOT / ".agent" / "memory" / "adr"

# 顶层状态（周期外）：转换不受子状态约束
TOP_LEVEL_TRANSITIONS = {
    "IDLE": ["UNDERSTANDING"],
    "UNDERSTANDING": ["PLANNING", "IDLE"],
    "PLANNING": ["EXECUTING", "UNDERSTANDING"],
    "EXECUTING": ["REVIEWING", "FINISHED", "HUMAN_DECISION", "UNDERSTANDING"],
    "FINISHED": ["IDLE"],
    # HUMAN_DECISION 不能直达子状态，必须先回到 EXECUTING（恢复周期）或顶层
    "HUMAN_DECISION": ["PLANNING", "IDLE", "EXECUTING", "UNDERSTANDING"],
}

# 子状态（EXECUTING 周期内）：仅在 in_cycle=true 时合法
SUB_STATE_TRANSITIONS = {
    "REVIEWING": ["MODIFYING", "HUMAN_DECISION", "UNDERSTANDING"],
    "MODIFYING": ["TESTING", "HUMAN_DECISION", "UNDERSTANDING"],
    "TESTING": ["DECIDING", "HUMAN_DECISION"],
    # DECIDING 是周期的唯一出口：回 EXECUTING（继续任务）或 FINISHED（收尾）
    "DECIDING": ["EXECUTING", "REVIEWING", "FINISHED", "HUMAN_DECISION"],
}

SUB_STATES = set(SUB_STATE_TRANSITIONS.keys())

# 动作前提：特定转换必须携带相应标志，否则脚本拒绝（机器强制，而非依赖 LLM 自觉）
#   transition MODIFYING    --approved        # REVIEWING→MODIFYING：方案已批准
#   transition EXECUTING    --complete-task --test-passed   # DECIDING→EXECUTING：测试通过
#   transition REVIEWING    --retry           # DECIDING→REVIEWING：失败重试
#   transition DECIDING     --test-done       # TESTING→DECIDING：测试已执行
PREREQUISITES = {
    ("REVIEWING", "MODIFYING"): ["approved"],
    ("TESTING", "DECIDING"): ["test_done"],
    ("DECIDING", "REVIEWING"): ["retry"],
    ("DECIDING", "EXECUTING"): ["complete_task", "test_passed"],
}

def resolve_transitions(state_name):
    """合并查询：先看子状态表，再看顶层表。"""
    if state_name in SUB_STATES:
        return SUB_STATE_TRANSITIONS.get(state_name, [])
    return TOP_LEVEL_TRANSITIONS.get(state_name, [])

def load_state():
    with open(STATE_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_state(state):
    # 原子写入
    tmp_file = STATE_FILE.with_suffix('.tmp')
    with open(tmp_file, 'w', encoding='utf-8') as f:
        json.dump(state, f, indent=2, default=str, ensure_ascii=False)
    os.replace(tmp_file, STATE_FILE)

def load_max_retries():
    """从 config.yaml 读取 retry.max_retries_per_task，失败时回退默认值 3。"""
    default = 3
    try:
        text = CONFIG_FILE.read_text(encoding='utf-8')
        m = re.search(r'max_retries_per_task\s*[:=]\s*(\d+)', text)
        return int(m.group(1)) if m else default
    except Exception:
        return default

def load_tasks_from_plan(state):
    """从最新的 Plan ADR 提取任务 ID，填充 task_queue（按修改时间取最新）。"""
    if not ADR_DIR.is_dir():
        return
    plan_files = sorted(ADR_DIR.glob('*.md'), key=lambda p: p.stat().st_mtime, reverse=True)
    for f in plan_files:
        try:
            text = f.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        if 'PLAN' not in text.upper():
            continue
        seen = []
        for line in text.splitlines():
            m = re.search(r'\bT-\d+\b', line)
            if m and m.group(0) not in seen:
                seen.append(m.group(0))
        if seen:
            state.setdefault('task_queue', []).extend(seen)
            print(f"已从 {f.name} 加载 {len(seen)} 个任务: {', '.join(seen)}")
        return

def command_current():
    state = load_state()
    print(json.dumps(state, indent=2))

def command_transition(new_state, args):
    state = load_state()
    current = state["current_state"]
    in_cycle = state.get("in_cycle", False)

    allowed = resolve_transitions(current)
    if new_state not in allowed:
        print(f"错误: 不允许从 {current} 转换到 {new_state}", file=sys.stderr)
        print(f"允许的目标: {allowed}", file=sys.stderr)
        sys.exit(1)

    # ★ 先处理 push_task / load_tasks / task_id，再检查 in_cycle
    #   因为 push_task 可能通过添加任务来激活周期
    if args.load_tasks:
        if not state.get("task_queue"):
            load_tasks_from_plan(state)

    if args.task_id:
        state["current_task_id"] = args.task_id

    if args.push_task:
        state.setdefault("task_queue", []).append(args.push_task)

    # 如果 push_task 添加了任务到队列，自动激活 in_cycle
    if state.get("task_queue") and new_state in SUB_STATES:
        state["in_cycle"] = True
        in_cycle = True

    # 周期约束：子状态只能在 EXECUTING 周期内进入/流转
    if new_state in SUB_STATES and not in_cycle:
        print(f"错误: {new_state} 是 EXECUTING 周期内的子状态，当前 in_cycle=false", file=sys.stderr)
        print("请先回到 EXECUTING（恢复周期）再进入子状态", file=sys.stderr)
        sys.exit(1)

    # 动作前提校验：机器强制
    flags = {
        "approved": args.approved,
        "test_done": args.test_done,
        "test_passed": args.test_passed,
        "retry": args.retry,
        "complete_task": args.complete_task,
    }
    for prereq in PREREQUISITES.get((current, new_state), []):
        if not flags.get(prereq):
            print(f"错误: 转换 {current} -> {new_state} 缺少前提 --{prereq.replace('_', '-')}", file=sys.stderr)
            sys.exit(1)

    # 记录历史
    state.setdefault("history", []).append({
        "from": current,
        "to": new_state,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })

    state["current_state"] = new_state

    # 处理附加操作
    if args.interrupt:
        state["interrupted_from"] = current
    else:
        state["interrupted_from"] = None

    if args.complete_task:
        if state.get("task_queue"):
            state["task_queue"].pop(0)
        state["current_task_id"] = None
        state["retry_count"] = 0
        state.pop("retry_reason", None)

    if args.retry:
        state["retry_count"] = state.get("retry_count", 0) + 1
        max_retries = load_max_retries()
        if state["retry_count"] >= max_retries:
            # 达到上限：强制进入 HUMAN_DECISION（由脚本保证，而非依赖 LLM 自觉）
            state["retry_reason"] = "max_retries_exceeded"
            state["current_state"] = "HUMAN_DECISION"
            state.setdefault("history", []).append({
                "from": new_state,
                "to": "HUMAN_DECISION",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            save_state(state)
            print(f"错误: 已达最大重试次数 {max_retries}，强制进入 HUMAN_DECISION", file=sys.stderr)
            sys.exit(2)

    # 周期追踪：进入 EXECUTING 且有任务 → 周期开始；FINISHED 或 EXECUTING 队列空 → 周期结束
    # 注：in_cycle 可能已在上方 push_task 时激活
    if new_state == "EXECUTING" and state.get("task_queue") and not state.get("in_cycle"):
        state["in_cycle"] = True
    elif new_state == "FINISHED" or (new_state == "EXECUTING" and not state.get("task_queue")):
        state["in_cycle"] = False
        state["retry_count"] = 0
        state.pop("retry_reason", None)

    save_state(state)
    print(f"状态已转换: {current} -> {new_state}")

def command_history():
    state = load_state()
    for entry in state.get("history", []):
        print(f"{entry['timestamp']}: {entry['from']} -> {entry['to']}")

def command_reset():
    # 重置到 IDLE，清除所有任务和计数
    confirm = input("确认重置状态到 IDLE？(y/N) ")
    if confirm.lower() == 'y':
        initial_state = {
            "current_state": "IDLE",
            "task_queue": [],
            "current_task_id": None,
            "retry_count": 0,
            "interrupted_from": None,
            "in_cycle": False,
            "last_modified_files": [],
            "history": [{"from": None, "to": "IDLE", "timestamp": datetime.now(timezone.utc).isoformat()}]
        }
        save_state(initial_state)
        print("状态已重置为 IDLE")
    else:
        print("取消重置")

def main():
    parser = argparse.ArgumentParser(description="Agent 状态管理器")
    subparsers = parser.add_subparsers(dest='command', required=True)

    subparsers.add_parser('current', help='显示当前状态')

    trans_parser = subparsers.add_parser('transition', help='执行状态转换')
    trans_parser.add_argument('new_state', help='目标状态')
    trans_parser.add_argument('--task-id', help='设置当前任务 ID')
    trans_parser.add_argument('--push-task', help='向任务队列添加新任务')
    trans_parser.add_argument('--load-tasks', action='store_true', help='从最新 Plan ADR 加载任务队列')
    trans_parser.add_argument('--complete-task', action='store_true', help='标记当前任务完成并弹出队列（DECIDING->EXECUTING 需携带）')
    trans_parser.add_argument('--approved', action='store_true', help='[前提] 方案已批准（REVIEWING->MODIFYING）')
    trans_parser.add_argument('--test-done', action='store_true', help='[前提] 测试已执行（TESTING->DECIDING）')
    trans_parser.add_argument('--test-passed', action='store_true', help='[前提] 测试通过（DECIDING->EXECUTING）')
    trans_parser.add_argument('--retry', action='store_true', help='当前任务重试（DECIDING->REVIEWING 需携带）')
    trans_parser.add_argument('--interrupt', action='store_true', help='标记中断')

    subparsers.add_parser('history', help='显示转换历史')
    subparsers.add_parser('reset', help='重置状态到 IDLE (危险)')

    args = parser.parse_args()

    # 确保状态文件存在
    if not STATE_FILE.exists():
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        initial = {
            "current_state": "IDLE",
            "task_queue": [],
            "current_task_id": None,
            "retry_count": 0,
            "interrupted_from": None,
            "in_cycle": False,
            "last_modified_files": [],
            "history": []
        }
        save_state(initial)

    if args.command == 'current':
        command_current()
    elif args.command == 'transition':
        command_transition(args.new_state, args)
    elif args.command == 'history':
        command_history()
    elif args.command == 'reset':
        command_reset()

if __name__ == '__main__':
    main()