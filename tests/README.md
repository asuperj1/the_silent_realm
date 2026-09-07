# 测试目录

集中存放自动化测试资产（原散落于项目根目录，T-4 迁移整理）。

## 测试文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `test_round1.js` | JS 单元回归 | 验证 `checkLevelUp`、`battleCore`、`storage`、副本评分、ResourceManager 等模块（40 用例） |
| `concurrency_test.js` | JS 并发 | 多用户并发连接/登录/入房/playerAction/断线重连（需先启动服务端） |
| `test_t2_verify.py` | Python 静态 | 验证 T-2 相关修改（职业投影等），用 conda 环境 `coc_rpg_env` 运行 |

## 运行方式

### JS 单元回归
```bash
node tests/test_round1.js
```

### JS 并发测试（需先启动服务端）
```bash
# 终端 1：启动服务端
node server.js

# 终端 2：运行并发测试（5 用户跑全部用例）
node tests/concurrency_test.js 5 all
```

### Python 静态检查（conda 环境 coc_rpg_env）
```bash
# 激活 conda 环境后运行
conda activate coc_rpg_env
python tests/test_t2_verify.py

# 或直接用解释器路径
E:\miniconda3\envs\coc_rpg_env\python.exe tests/test_t2_verify.py
```

## 约定

- Python 仅用于测试/静态检查，不承载业务逻辑；必须使用 conda 环境 `coc_rpg_env`。
- 新增测试请放入本目录，保持路径相对项目根（`../server/...`、`../config/...`）。
