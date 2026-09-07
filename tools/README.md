# 🛠 tools/ — 验证与演示脚本

> 开发辅助脚本：**引擎机制验证** 与 **战斗系统现场演示**（驱动真实 `server/battleEngine`）。

| 脚本 | 作用 | 用法 |
| --- | --- | --- |
| `verify-mechanics.js` | 战斗职业机制引擎验证：暴击回资源 / 技能多段 hits / 武士架势条+招架抵消 / 闪避 onDodge / 枪手装填 / 侦探标记易伤 / 警官正义处决 | `node tools/verify-mechanics.js` |
| `demo-battle.js` | 战斗系统现场演示：幕 1（武士+诡术小丑+警官 vs 修格斯团队战）、幕 2（警官 solo 正义处决），逐回合打印行动/伤害/资源/机制 | `node tools/demo-battle.js` |
| `verify_skill_icons.js` | 技能图标完整性校验 | `node tools/verify_skill_icons.js` |
| `test_*.js` | 历史专项测试脚本 | 按需执行 |

> 机制验证已随 `npm test` 之外独立运行（建议后续并入测试套件）。
