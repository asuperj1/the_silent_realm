const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// 加载环境变量
require('dotenv').config();
const config = require('./config/api');

// 初始化 express
const app = express();

// 请求日志中间件（可帮助调试）
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// ========== 路由（必须在 static 之前，防止被 static 中间件拦截）==========

// 默认首页：扉页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cover.html'));
});

// 游戏主界面重定向保护：直接访问 /index.html 时重定向到扉页
// 带 ?from=login 参数则放行（登录成功后正常跳转）
app.get('/index.html', (req, res) => {
  if (req.query.from === 'login') {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
  } else {
    res.redirect('/');
  }
});

// 新版独立登录页（寂静之地棕调标准登录页）
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'auth', 'login.html'));
});

// ★ 路由守卫：旧版 /login 路径 302 重定向至标准登录页
app.get('/login', (req, res) => {
  res.redirect(302, '/login.html?from=cover');
});

// ========== 静态文件 ==========

// 扉页 & 登录页静态资源（coverPage.css, coverAnim.js 等）
app.use(express.static(path.join(__dirname, 'public')));

// 登录页独立静态资源（login.css, login.js）
app.use('/auth', express.static(path.join(__dirname, 'frontend', 'auth')));

// 游戏主界面静态资源（js/, css/, index.html 由上方路由覆盖）
app.use(express.static(path.join(__dirname, 'frontend'), { index: false }));

// ★ P3 素材压缩接入：浏览器支持 webp 时，优先返回 assets/optimized/ 的压缩版（前端零改动，回退原图）
// 仅在 Accept: image/webp 且对应 optimized webp 存在时生效；否则走下方静态服务返回原 png/jpg
const OPTIMIZED_DIR = path.join(__dirname, 'assets', 'optimized');
app.use('/assets', (req, res, next) => {
  const accept = req.headers.accept || '';
  if (!/image\/webp/.test(accept)) return next();
  // req.path 是未解码的（中文文件名以 %XX 编码），需解码后匹配/拼接
  let decoded;
  try { decoded = decodeURIComponent(req.path); } catch (e) { return next(); }
  if (!/\.(png|jpe?g)$/i.test(decoded)) return next();
  const webpFile = path.join(OPTIMIZED_DIR, decoded.replace(/\.(png|jpe?g)$/i, '.webp'));
  // 路径穿越防护：规范化后必须仍位于 optimized 目录内
  if (!webpFile.startsWith(OPTIMIZED_DIR)) return next();
  if (fs.existsSync(webpFile)) {
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('X-Compressed', 'webp'); // 便于调试确认走压缩通道
    return res.sendFile(webpFile);
  }
  next();
});
// 素材目录
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// 素材索引文件
app.get('/resource.json', (req, res) => {
  const filePath = path.join(__dirname, 'resource.json');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('resource.json 未找到:', err.message);
      res.status(404).json({ error: 'resource.json not found' });
    }
  });
});

// 忽略 favicon 请求，避免干扰日志
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ==================== 健康检查端点（首页连接预校验） ====================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    version: '1.0.0'
  });
});

// ==================== 副本场景映射接口 ====================
// 单一数据源：config/scenes.json（经 server/gameLogic.js 的 SCENES 加载，避免二次读文件）
const { SCENES } = require('./server/gamelogic');
// 按 name 建立索引（供 /api/scene/:copyName 精确匹配）
const SCENE_BY_NAME = new Map(SCENES.map(s => [s.name, s]));

app.get('/api/scenes', (req, res) => {
  try {
    const scenes = {};
    for (const scene of SCENES) {
      scenes[scene.name] = {
        id: scene.id,
        bgPath: scene.bg,
        overlayClass: scene.overlay || ('copy-' + scene.id.replace(/_/g, '-')),
        label: scene.label || scene.name,
        tags: scene.sceneTags
      };
    }
    res.json({ success: true, scenes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 单个副本场景查询
app.get('/api/scene/:copyName', (req, res) => {
  try {
    const copyName = decodeURIComponent(req.params.copyName);
    const scene = SCENE_BY_NAME.get(copyName);
    if (scene) {
      res.json({ success: true, imgUrl: scene.bg, sceneDesc: scene.description });
    } else {
      res.json({ success: false, message: '未知副本' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 职业数据接口 ====================
app.get('/api/professions', (req, res) => {
  try {
    const professions = require('./config/professions.json');
    res.json({ success: true, professions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ★ 杀戮尖塔2式战斗：技能战斗配置（费用/数值）供前端渲染费用角标
app.get('/api/skill-battle', (req, res) => {
  try {
    res.json(require('./config/skill_battle.json'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ★ 杀戮尖塔2式战斗：职业战斗配置（能量骰/普攻AP/技能AP/特殊资源/特殊技能）供战斗信息栏展示
app.get('/api/battle-roles', (req, res) => {
  try {
    res.json(require('./config/battle_roles.json'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 角色技能图标资源（独立于世界/副本配置）
app.get('/api/character-skill-icons', (req, res) => {
  try {
    const skillIcons = require('./config/character_skill.json');
    res.json({ success: true, skillIcons });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 技能树图标映射：技能名 -> /assets/icons/skills/{职业id}/{序号}.png
app.get('/api/skill-icons-map', (req, res) => {
  try {
    const manifest = require('./config/skill_manifest.json');
    const map = {};
    for (const [pid, prof] of Object.entries(manifest)) {
      const m = {};
      prof.skills.forEach((name, i) => {
        m[name] = `/assets/icons/skills/${pid}/${String(i + 1).padStart(3, '0')}.png`;
      });
      map[pid] = m;
    }
    res.json({ success: true, map });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 物品框架（ItemEngine·全局单例） ====================
const { getItemEngine } = require('./server/itemEngine/ItemEngine');
const itemEngine = getItemEngine();
try {
  itemEngine.init();
  // 启动即加载全局物品池 G-*（常驻）；副本清单在副本开启时由 gameHandler 动态 loadDungeon
} catch (e) {
  console.error('[ItemEngine] 初始化失败:', e.message);
}

// ★ 副本 ID → 中文名（图鉴展示用；manifest 未提供 name 时兜底）
const DUNGEON_NAME_CN = { qingfengshan: '青峰山' };

// 物品框架目录：全局池 / 品质体系 / 槽位 / 副本清单
app.get('/api/items/catalog', (req, res) => {
  try {
    res.json({
      success: true,
      global: itemEngine.globalCatalog(),
      quality: itemEngine.qualityMap(),
      slots: itemEngine.slotsInfo(),
      dungeons: itemEngine.dungeons.allManifests().map(m => ({
        dungeonId: m.dungeonId, prefix: m.prefix, maxQuality: m.maxQuality || 'purple', name: m.name || DUNGEON_NAME_CN[m.dungeonId] || m.dungeonId
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 某副本导入清单（含激活状态）
app.get('/api/items/dungeon/:id', (req, res) => {
  try {
    res.json({
      success: true,
      items: itemEngine.dungeonCatalog(req.params.id),
      active: itemEngine.isDungeonActive(req.params.id)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== 地图编辑器（开发工具，管理员 debug_admin 专用） ==========
const MAP_EDITOR_DIR = path.join(__dirname, 'data', 'map_editor');
const MAP_IMG_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
app.use(express.json({ limit: '2mb' }));

function scanMapImages(dir, base) {
  let list = [];
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) {
        list = list.concat(scanMapImages(full, base));
      } else if (MAP_IMG_EXTS.includes(path.extname(f.name).toLowerCase())) {
        const rel = path.relative(base, full).replace(/\\/g, '/');
        list.push({ url: '/assets/' + rel, name: f.name, path: rel, category: imgCategory(rel) });
      }
    }
  } catch (e) { /* ignore */ }
  return list;
}
// 图片分类：skill 技能 / item 物品 / character 角色 / scene 场景 / map 地图 / other 其他
function imgCategory(rel) {
  if (/^icons\//.test(rel)) return 'skill';
  if (/^items?\//.test(rel)) return 'item';
  if (/^characters?\//.test(rel)) return 'character';
  if (/^bg\//.test(rel)) return 'scene';
  if (/地图|city-map|^废都1\./i.test(rel)) return 'map';
  if (/场景|渔村|印斯茅斯|海底|码头|触手|藏书室|庄园|隧道|车厢|青峰山\d|立绘|废都|小镇|城市|夜景|古堡|村落/.test(rel)) return 'scene';
  return 'other';
}
function mapSlug(mapPath) {
  const s = String(mapPath || '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 80);
  return s || 'map';
}
// 浏览所有图片（管理员地图编辑器图片库，带分类）
app.get('/api/mapeditor/images', (req, res) => {
  try {
    const images = scanMapImages(path.join(__dirname, 'assets'), path.join(__dirname, 'assets'));
    const categories = {};
    images.forEach(i => { categories[i.category] = (categories[i.category] || 0) + 1; });
    res.json({ success: true, images, categories });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// 读取某地图的标注数据
app.get('/api/mapeditor/data', (req, res) => {
  try {
    const map = req.query.map || '';
    const file = path.join(MAP_EDITOR_DIR, mapSlug(map) + '.json');
    if (!fs.existsSync(file)) return res.json({ success: true, map, exists: false, data: null });
    res.json({ success: true, map, exists: true, data: JSON.parse(fs.readFileSync(file, 'utf8')) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// 保存地图标注数据（仅管理员账号：校验真实会话 token）
app.post('/api/mapeditor/data', (req, res) => {
  try {
    const { getSessionUsername } = require('./server/auth');
    const uname = getSessionUsername(req.headers['x-token'] || '');
    if (uname !== 'debug_admin') {
      return res.status(403).json({ error: '仅管理员账号可保存地图标注' });
    }
    const { map, annotations, grid, density } = req.body;
    if (!map) return res.status(400).json({ error: '缺少 map 参数' });
    fs.mkdirSync(MAP_EDITOR_DIR, { recursive: true });
    const file = path.join(MAP_EDITOR_DIR, mapSlug(map) + '.json');
    fs.writeFileSync(file, JSON.stringify({
      map,
      updatedAt: new Date().toISOString(),
      annotations: Array.isArray(annotations) ? annotations : [],
      grid: grid || null,
      density: density || 'fine'
    }, null, 2), 'utf8');
    res.json({ success: true, file });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 创建 HTTP 服务器
const server = http.createServer(app);

// 绑定 Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // === P2: 连接数 & 速率限制 ===
  maxHttpBufferSize: 1e6,        // 1MB 消息上限
  perMessageDeflate: { threshold: 2048 },  // 小消息不压缩
  connectTimeout: 10000,         // 10s 连接超时
  pingTimeout: 30000,            // 30s ping 超时
  pingInterval: 15000,           // 15s ping 间隔
  maxDisconnectionDuration: 60000 // 60s 重连窗口
});

// P2: 全局连接数限制
let activeConnections = 0;
const MAX_CONNECTIONS = 50;
io.on('connection', (socket) => {
  activeConnections++;
  if (activeConnections > MAX_CONNECTIONS) {
    socket.emit('error', { msg: '服务器繁忙，请稍后重试' });
    socket.disconnect(true);
    return;
  }
  socket.on('disconnect', () => { activeConnections--; });
});

// 注册所有 Socket 事件
try {
  const { registerSocketEvents } = require('./server/socketHandler');
  registerSocketEvents(io);
  console.log('Socket 事件注册成功');
} catch (err) {
  console.error('Socket 事件注册失败:', err.message);
  process.exit(1); // 无法注册事件则终止进程
}

// 全局异常捕获，防止崩溃
process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('未处理的 Promise 拒绝:', reason);
});

// 启动服务器
const PORT = config.PORT || 3000;
server.listen(PORT, () => {
  console.log('========================================');
  console.log(`  寂静之地·克苏鲁跑团服务端已启动`);
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`  请确保浏览器访问此地址，而非直接打开文件`);
  console.log('========================================');
});

// 测试自动修改代码 2026-08-03