coc-rpg-game/
├── server.js                # 入口：启动HTTP和Socket.io服务
├── package.json             # 依赖管理
├── .env                     # 环境变量（API密钥等）
├── config/
│   └── api.js               # 读取.env并提供配置常量
├── server/
│   ├── gameLogic.js         # 所有游戏规则、配置数据、ECS、事件总线
│   ├── room.js              # 房间管理、Socket事件处理
│   └── deepseekApi.js       # DeepSeek调用、上下文、Token管理
├── frontend/
│   ├── index.html           # 前端页面
│   ├── css/
│   │   └── main.css         # 暗黑风格样式
│   └── js/
│       └── client.js        # 前端Socket交互与渲染
├── assets/                  # 美术素材（图片）
│   ├── bg/                  # 场景背景
│   ├── character/           # 角色
│   └── item/                # 道具
├── docs/
│   └── gameRule.md          # 游戏规则文档（可留空或复制之前设定）
└── saves/                   # 玩家存档（运行后自动生成）