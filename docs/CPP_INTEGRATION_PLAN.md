# 战斗引擎 C++ 化 — 服务端部署与 JS 融合方案

> **目标**：将战斗核心计算（AttrFormula / ActionRound / DamageCalc）下沉到 C++，通过 Node.js N-API 原生插件与现有 JS 项目无缝对接。  
> **原则**：不改动 `gameLogic.js`、不破坏 KP 双频道播报、零侵入现有业务逻辑。

---

## 一、架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                       Node.js 主进程                              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ server.js    │  │ socketHandler│  │ gameLogic.js (只读)    │  │
│  │ (Express+IO) │  │ (KP双频道)   │  │ (角色/副本/商店配置)    │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬────────────┘  │
│         │                 │                       │               │
│         │    ┌────────────┴───────────────────────┘               │
│         │    │                                                    │
│         ▼    ▼                                                    │
│  ┌──────────────────────────────────────────┐                     │
│  │        src/battle/BattleBridge.js         │  ← JS 桥接层       │
│  │  统一入口：加载 C++ .node 或 fallback JS  │                     │
│  └──────────────┬───────────────────────────┘                     │
│                 │                                                 │
│    ┌────────────┴────────────┐                                   │
│    ▼                         ▼                                   │
│  ┌──────────────────┐  ┌──────────────────────┐                  │
│  │ native/          │  │ src/battle/          │                  │
│  │ battle_engine.cc │  │ AttrFormula.js       │  ← JS fallback  │
│  │ (C++ N-API 插件) │  │ ActionRound.js       │                  │
│  │                  │  │ DamageCalc.js        │                  │
│  │ battle_engine    │  │ BattleUI.js          │                  │
│  │ .node (编译产物) │  │                      │                  │
│  └──────────────────┘  └──────────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

**关键设计**：
- C++ 编译产物 `battle_engine.node` 与 JS fallback 实现**完全相同的函数签名**
- `BattleBridge.js` 自动检测 `.node` 是否存在，优先使用 C++，不存在则降级 JS
- JS 调用方无需关心底层是 C++ 还是 JS

---

## 二、C++ 源码结构

```
native/
├── battle_engine.cc        # N-API 插件入口 + 函数注册
├── attr_formula.h / .cc    # 属性公式 —— 对应 AttrFormula.js
├── action_round.h / .cc    # 行动轮次 —— 对应 ActionRound.js
├── damage_calc.h / .cc     # 伤害结算 —— 对应 DamageCalc.js
├── binding.gyp             # node-gyp 编译配置
├── CMakeLists.txt          # CMake 备选方案
└── test/
    └── test_engine.js      # C++ 单元测试（Mocha）
```

### 2.1 `attr_formula.h` — 属性公式头文件

```cpp
#ifndef ATTR_FORMULA_H
#define ATTR_FORMULA_H

#include <string>
#include <unordered_map>

struct ProfessionCoeff {
    double physAtk;    // 职业物攻系数
    double magicAtk;   // 职业法伤系数
    double hpCoeff;    // 职业生命系数
};

struct SkillCoeff {
    double magicBonus; // 技能专属法伤系数
    bool sanDrain;     // 是否扣散标签
    double sanDrainAmount;
};

// 职业系数表（与 gameLogic.js CAREERS 同步）
extern std::unordered_map<std::string, ProfessionCoeff> PROF_COEFFS;

// 技能系数表（与 config/professions.json skills 同步）
extern std::unordered_map<std::string, SkillCoeff> SKILL_COEFFS;

// 核心公式
double calcMaxHp(double baseHp, double con, const std::string& careerId);
double calcPhysAtk(double baseAtk, double str, const std::string& careerId);
double calcMagicAtk(double skillBase, double per, const std::string& careerId, const std::string& skillName);
bool   isSanDrainSkill(const std::string& skillName);
double calcSanLoss(double baseSanLoss, const std::string& skillName);

#endif
```

### 2.2 `action_round.h` — 行动轮次头文件

```cpp
#ifndef ACTION_ROUND_H
#define ACTION_ROUND_H

#include <vector>
#include <string>

struct UnitActionInfo {
    std::string unitId;
    double agi;
    int actionCount;      // Math.floor(agi / baseAgi)
    int remainingActions; // 本轮剩余行动次数
};

// 提取最高AGI
double findMaxAgi(const std::vector<UnitActionInfo>& units);

// 计算行动次数 (Math.floor)
int calcActionCount(double agi, double baseAgi);

// 构建回合时序（排序+随机打乱同次数）
std::vector<UnitActionInfo> buildRoundTimeline(
    const std::vector<UnitActionInfo>& units,
    double baseAgi
);

// 判断是否需要随机打乱
void shuffleEqualCounts(std::vector<UnitActionInfo>& timeline);

#endif
```

### 2.3 `damage_calc.h` — 伤害结算头文件

```cpp
#ifndef DAMAGE_CALC_H
#define DAMAGE_CALC_H

#include <string>

struct DamageResult {
    double rawDamage;
    double finalDamage;
    double armorReduction;
    std::string damageType; // "physical" | "magic" | "san"
};

struct CombatUnit {
    double str, agi, per, con, san;
    double hp, maxHp;
    double armor;
    double magicResist;
    double basePhysAtk;
};

// 物理伤害
DamageResult calcPhysicalDamage(
    const CombatUnit& attacker,
    const CombatUnit& defender,
    const std::string& careerId,
    double weaponBonus = 0.0
);

// 法术伤害
DamageResult calcMagicDamage(
    const CombatUnit& attacker,
    const CombatUnit& defender,
    const std::string& careerId,
    const std::string& skillName,
    double skillBaseDamage
);

// SAN损耗
DamageResult calcSanDamage(
    const CombatUnit& target,
    const std::string& skillName,
    double baseSanLoss
);

// 护甲减免
double applyArmorReduction(double rawDamage, double armor);

// 魔抗减免
double applyMagicResist(double rawDamage, double magicResist);

#endif
```

### 2.4 `battle_engine.cc` — N-API 绑定入口

```cpp
#include <napi.h>
#include "attr_formula.h"
#include "action_round.h"
#include "damage_calc.h"

// ---- 属性公式绑定 ----
Napi::Value JsCalcMaxHp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    double baseHp = info[0].As<Napi::Number>().DoubleValue();
    double con = info[1].As<Napi::Number>().DoubleValue();
    std::string careerId = info[2].As<Napi::String>().Utf8Value();
    return Napi::Number::New(env, calcMaxHp(baseHp, con, careerId));
}

// ... 其他绑定函数 ...

// ---- 模块注册 ----
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("calcMaxHp", Napi::Function::New(env, JsCalcMaxHp));
    exports.Set("calcPhysAtk", Napi::Function::New(env, JsCalcPhysAtk));
    exports.Set("calcMagicAtk", Napi::Function::New(env, JsCalcMagicAtk));
    exports.Set("isSanDrainSkill", Napi::Function::New(env, JsIsSanDrainSkill));
    exports.Set("calcSanLoss", Napi::Function::New(env, JsCalcSanLoss));
    
    exports.Set("findMaxAgi", Napi::Function::New(env, JsFindMaxAgi));
    exports.Set("calcActionCount", Napi::Function::New(env, JsCalcActionCount));
    exports.Set("buildRoundTimeline", Napi::Function::New(env, JsBuildRoundTimeline));
    
    exports.Set("calcPhysicalDamage", Napi::Function::New(env, JsCalcPhysicalDamage));
    exports.Set("calcMagicDamage", Napi::Function::New(env, JsCalcMagicDamage));
    exports.Set("calcSanDamage", Napi::Function::New(env, JsCalcSanDamage));
    exports.Set("applyArmorReduction", Napi::Function::New(env, JsApplyArmorReduction));
    exports.Set("applyMagicResist", Napi::Function::New(env, JsApplyMagicResist));
    
    return exports;
}

NODE_API_MODULE(battle_engine, Init)
```

### 2.5 `binding.gyp` — 编译配置

```json
{
  "targets": [
    {
      "target_name": "battle_engine",
      "sources": [
        "battle_engine.cc",
        "attr_formula.cc",
        "action_round.cc",
        "damage_calc.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags": ["-O3", "-march=native"],
      "conditions": [
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "Optimization": 2,
              "EnableEnhancedInstructionSet": "AdvancedVectorExtensions2"
            }
          }
        }]
      ]
    }
  ]
}
```

---

## 三、编译与部署流程

### 3.1 开发环境准备

```powershell
# 安装 node-gyp 全局工具
npm install -g node-gyp

# 安装 N-API 头文件
npm install node-addon-api

# Windows: 确保安装了 Visual Studio Build Tools (含 C++ 工作负载)
# 或: npm install --global windows-build-tools
```

### 3.2 编译

```powershell
cd native
node-gyp configure
node-gyp build
# 产物: native/build/Release/battle_engine.node
```

### 3.3 部署

```powershell
# 方案A: 复制 .node 到项目根目录
copy native\build\Release\battle_engine.node .\

# 方案B: 在 package.json 中配置安装脚本
# "scripts": {
#   "install": "cd native && node-gyp rebuild"
# }
```

---

## 四、JS 桥接层 — `BattleBridge.js`

```javascript
// src/battle/BattleBridge.js
// 统一入口：优先 C++ 原生插件，降级纯 JS

const path = require('path');

let engine;
let isNative = false;

try {
  engine = require('../../native/build/Release/battle_engine.node');
  isNative = true;
  console.log('[BattleBridge] ✅ 已加载 C++ 原生战斗引擎');
} catch (e) {
  console.log('[BattleBridge] ⚠️ C++ 插件未编译，降级为纯 JS 引擎');
  engine = {
    calcMaxHp:        require('./AttrFormula').calcMaxHp,
    calcPhysAtk:      require('./AttrFormula').calcPhysAtk,
    calcMagicAtk:     require('./AttrFormula').calcMagicAtk,
    isSanDrainSkill:  require('./AttrFormula').isSanDrainSkill,
    calcSanLoss:      require('./AttrFormula').calcSanLoss,
    findMaxAgi:       require('./ActionRound').findMaxAgi,
    calcActionCount:  require('./ActionRound').calcActionCount,
    buildRoundTimeline: require('./ActionRound').buildRoundTimeline,
    calcPhysicalDamage: require('./DamageCalc').calcPhysicalDamage,
    calcMagicDamage:    require('./DamageCalc').calcMagicDamage,
    calcSanDamage:      require('./DamageCalc').calcSanDamage,
    applyArmorReduction: require('./DamageCalc').applyArmorReduction,
    applyMagicResist:    require('./DamageCalc').applyMagicResist,
  };
}

module.exports = { engine, isNative };
```

### 调用示例

```javascript
// 在 socketHandler.js 中使用（零侵入）
const { engine } = require('../src/battle/BattleBridge');

// 计算玩家 maxHp
const maxHp = engine.calcMaxHp(player.attr.hp, player.attr.con, player.career);

// 构建回合时序
const timeline = engine.buildRoundTimeline(units, baseAgi);

// 结算物理伤害
const dmgResult = engine.calcPhysicalDamage(attacker, defender, attacker.career);
```

---

## 五、JS ↔ C++ 数据流契约

### 5.1 数据类型映射

| JavaScript | C++ N-API | 说明 |
|-----------|-----------|------|
| `Number` | `double` | 所有数值均用 double，JS 端负责取整 |
| `String` | `std::string` | 职业ID、技能名等 |
| `Object` | `Napi::Object` | 战斗单位结构体 |
| `Array` | `Napi::Array` | 单位列表、时序表 |
| `Boolean` | `bool` | 扣散标签判断 |

### 5.2 战斗单位对象契约

```javascript
// JS → C++ 传入格式
const unit = {
  unitId: 'player_001',
  str: 55, agi: 48, per: 40, con: 52, san: 60,
  hp: 85, maxHp: 100,
  armor: 10,
  magicResist: 5,
  basePhysAtk: 20,
  careerId: 'jiaodoushi'
};
```

---

## 六、性能对比预估

| 场景 | 纯 JS | C++ N-API | 加速比 |
|------|-------|-----------|--------|
| 100轮战斗模拟 | ~15ms | ~0.8ms | **~18×** |
| 1000单位时序排序 | ~8ms | ~0.3ms | **~26×** |
| 伤害计算(万次) | ~45ms | ~2ms | **~22×** |

> C++ 版本在大量并发房间场景下优势显著，单次调用差异可忽略。

---

## 七、备选方案：WebAssembly

如果不想引入 node-gyp 编译链，可将 C++ 通过 Emscripten 编译为 WASM：

```powershell
emcc battle_engine.cc attr_formula.cc action_round.cc damage_calc.cc \
  -O3 -s WASM=1 -s EXPORTED_FUNCTIONS='["_calcMaxHp","_calcActionCount",...]' \
  -o battle_engine.wasm
```

```javascript
// JS 端加载 WASM
const wasmModule = await WebAssembly.instantiate(fs.readFileSync('battle_engine.wasm'));
const { calcMaxHp, calcActionCount } = wasmModule.instance.exports;
```

**WASM 方案优势**：无需编译工具链，跨平台一致  
**WASM 方案劣势**：无法直接操作 Node.js 对象，需要内存共享传递数据，约比 N-API 慢 30%

---

## 八、部署清单

| 步骤 | 操作 | 验证方法 |
|------|------|---------|
| 1 | `npm install node-addon-api` | `ls node_modules/node-addon-api` |
| 2 | `cd native && node-gyp configure` | 生成 `build/` 目录 |
| 3 | `node-gyp build` | 生成 `build/Release/battle_engine.node` |
| 4 | 启动服务器 `node server.js` | 日志输出 `[BattleBridge] ✅ 已加载 C++` |
| 5 | 运行战斗测试 | `node native/test/test_engine.js` 全部通过 |
| 6 | 验收：JS fallback 仍可工作 | 临时删除 `.node` → 日志输出 `降级为纯 JS 引擎` |

---

## 九、文件清单汇总

```
项目新增文件：
├── docs/
│   ├── BATTLE_SYSTEM_PRESET.md     ← 战斗系统预设方案
│   └── CPP_INTEGRATION_PLAN.md     ← 本文件
├── src/battle/
│   ├── AttrFormula.js              ← 属性公式（JS实现）
│   ├── ActionRound.js              ← 行动轮次（JS实现）
│   ├── DamageCalc.js               ← 伤害结算（JS实现）
│   ├── BattleUI.js                 ← 战斗UI渲染
│   └── BattleBridge.js             ← C++/JS 桥接层
├── native/
│   ├── battle_engine.cc            ← N-API 绑定入口
│   ├── attr_formula.h / .cc        ← C++ 属性公式
│   ├── action_round.h / .cc        ← C++ 行动轮次
│   ├── damage_calc.h / .cc         ← C++ 伤害结算
│   ├── binding.gyp                 ← node-gyp 编译配置
│   └── test/
│       └── test_engine.js          ← C++ 单元测试

不改动文件（铁律）：
├── server/gameLogic.js
├── server/socketHandler.js (仅增加 require 调用)
├── server/room.js
├── server/actionClassifier.js
├── server/statResolver.js
```
