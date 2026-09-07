# -*- coding: utf-8 -*-
r"""
T-2「单人回应改为细化全局播报选项」修改验证脚本（静态检查）
验证项：
  F1: server/socketHandler.js 中 roomHistory.push 已改为 room.history.push（修复未声明变量）
  G1: frontend/js/client.js 中 statOptions 空 options 降级分支已复用 parseKpTableMessage DOM 渲染
运行方式（conda 环境 coc_rpg_env）：
  E:\miniconda3\envs\coc_rpg_env\python.exe tests/test_t2_verify.py
"""
import os
import re
import sys

# Windows GBK 控制台无法输出 emoji/中文符号，强制 UTF-8 输出
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
passed, failed = 0, 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name}  {detail}")


def read(rel):
    with open(os.path.join(ROOT, rel), "r", encoding="utf-8") as f:
        return f.read()


print("========== T-2 修改验证 ==========\n")

# ---------------- F1: battleHandler.js + gameHandler.js ----------------
# T-5 拆分后，playerAction/privateAction 迁入 battleHandler.js，teamVote 等迁入 gameHandler.js
print("📋 F1: server/battleHandler.js + gameHandler.js roomHistory -> room.history")
sh = read("server/battleHandler.js") + read("server/gameHandler.js")
check("不再存在未声明的 roomHistory.push", "roomHistory.push" not in sh,
      "发现残留 roomHistory.push")
check("存在 room.history.push(role=user)", sh.count("room.history.push({ role: 'user'") >= 1,
      "通用副本路径缺少 room.history.push user 记录")
check("存在 room.history.push(role=assistant)", sh.count("room.history.push({ role: 'assistant'") >= 1,
      "通用副本路径缺少 room.history.push assistant 记录")

# 定位通用副本第一次调用回调，确认已用 room.history
gen_start = sh.find("（全局行动·团队面向）玩家")
gen_ctx = sh[gen_start:gen_start + 2600] if gen_start >= 0 else ""
check("通用副本全局行动回调内已用 room.history.push",
      gen_start >= 0 and "room.history.push" in gen_ctx and "roomHistory.push" not in gen_ctx,
      "通用副本回调上下文异常")

# ---------------- G1: client.js ----------------
print("\n📋 G1: frontend/js/client.js statOptions 降级分支 DOM 表格渲染")
cj = read("frontend/js/client.js")
g1_block_start = cj.find("socket.on('statOptions'")
g1_block = cj[g1_block_start:g1_block_start + 700] if g1_block_start >= 0 else ""
check("statOptions 监听器降级分支存在",
      g1_block_start >= 0 and "options.length === 0" in g1_block,
      "未找到 statOptions 空 options 分支")
check("降级分支调用 parseKpTableMessage",
      "parseKpTableMessage(String(rawTable))" in g1_block,
      "降级分支未复用 parseKpTableMessage")
check("降级分支使用 createChatMessage 追加 DOM 表格",
      "createChatMessage" in g1_block and "privateLog.appendChild" in g1_block,
      "降级分支未使用 DOM 表格渲染")
check("降级分支非表格内容仍纯文本直出",
      "appendLog(privateLog, textPart, 'KP')" in g1_block,
      "缺文本直出路径")

# 依赖函数存在性
for dep in ["parseKpTableMessage", "createChatMessage", "privateLog"]:
    check(f"依赖函数/变量 {dep} 存在", dep in cj)

# ---------------- 汇总 ----------------
print(f"\n========== 结果：通过 {passed} / 失败 {failed} ==========")
sys.exit(1 if failed else 0)
