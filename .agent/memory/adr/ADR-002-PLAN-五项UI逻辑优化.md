# ADR-002-PLAN：五项 UI/逻辑优化任务计划

| 属性 | 值 |
|------|-----|
| 状态 | `PLANNING` |
| 依赖 ADR | ADR-001（需求文档） |
| 创建日期 | 2026-08-05 |
| 预估总工时 | 约 4-6 小时（5 任务） |

---

## 依赖拓扑图

<table style="border-collapse:collapse; font-size:13px; font-family:Consolas,monospace; line-height:1.6; width:100%;">
  <tr style="background:#1a1714;">
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">任务</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">依赖</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">可并行组</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">类别</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-1 formatKpMessage 新增【风险】【收益】</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">无</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#5b8cbd;">A 组</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">前端</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-3 地图/场景图位置互换</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">无</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#5b8cbd;">A 组</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">前端</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-4 getCharacterList 完整性同步</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">无</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#5b8cbd;">A 组</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">后端</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-5 CSS 优化 + bgSwitcher 确认</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#b84444;">T-3</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">前端</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-2 单人回应细化全局播报</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#b84444;">T-1</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">全栈</td>
  </tr>
</table>

**执行路径**：A 组（T-1、T-3、T-4）可并行 → T-5（依赖 T-3）→ T-2（依赖 T-1，复杂度最高）

---

## T-1：formatKpMessage 新增【风险】【收益】独立换段

| 属性 | 值 |
|------|-----|
| ID | T-1 |
| 优先级 | P0（高） |
| 类别 | 前端 |
| 预估代码量 | +2 行 |
| 依赖 | 无 |

### 涉及文件

| 文件 | 行号 | 操作 |
|------|------|------|
| `frontend/js/client.js` | L1585-1598 | 修改 `formatKpMessage` 函数 |

### 当前代码（L1585-1598）

```js
function formatKpMessage(msg, sender) {
  if (sender !== 'KP' || typeof msg !== 'string') return msg;
  if (msg.includes('\n\n')) return msg;
  return msg
    .replace(/【判定】/g, '\n\n【判定】')
    .replace(/【结果】/g, '\n\n【结果】')
    .replace(/【建议】/g, '\n\n【建议】')
    .replace(/【行动】/g, '\n\n【行动】')
    .replace(/【状态】/g, '\n\n【状态】')
    .replace(/【风险[/\u6536]收益】/g, '\n\n【风险/收益】')
    .replace(/【可选方向】/g, '\n\n【可选方向】')
    .replace(/^\n\n/, '');
}
```

### 修改方案

在 `【风险/收益】` 行**之前**插入两行独立替换：

```js
    .replace(/【风险】/g, '\n\n【风险】')
    .replace(/【收益】/g, '\n\n【收益】')
```

> **注意顺序**：`【风险】` 和 `【收益】` 必须放在 `【风险/收益】` 之前，否则合写形式中的 `【风险` 会被先匹配，导致替换为 `\n\n【风险】/收益】`。

### 修改后代码

```js
    .replace(/【风险】/g, '\n\n【风险】')
    .replace(/【收益】/g, '\n\n【收益】')
    .replace(/【风险[/\u6536]收益】/g, '\n\n【风险/收益】')
```

### 测试要点

- KP 消息中含独立 `【风险】` → 在其前插入 `\n\n`
- KP 消息中含独立 `【收益】` → 在其前插入 `\n\n`
- KP 消息中含 `【风险/收益】` → 在其前插入 `\n\n`（兜底）
- 非 KP 消息 → 原样返回
- 已有 `\n\n` 的消息 → 原样返回（不重复分段）

---

## T-2：单人回应改为细化全局播报选项

| 属性 | 值 |
|------|-----|
| ID | T-2 |
| 状态 | ✅ **已实现**（2026-08-07） |
| 优先级 | P1（中） |
| 类别 | 全栈 |
| 预估代码量 | 服务端 ~15 行 + 前端 ~20 行 |
| 依赖 | **T-1**（formatKpMessage 已支持新标签处理） |

> **实施记录（2026-08-07）**：原方案（单次调用 + `===公共叙述===`/`===单人细化===` 正则拆分）已在实施过程中演进为更优的「**两次 DeepSeek 调用**」架构并落地：
> - 第一次调用 → 公共频道 `aiReply`（团队叙事，含【风险/收益】【可选方向】）；第二次调用（temperature 0.25 / top_p 0.5）→ 纯数值四列表格 → `statResolver.parseTable` → `statOptions`（可交互选择按钮），解析失败降级 `privateMsg`。
> - 前端 `privateMsg` 管道符表格 DOM 渲染（`parseKpTableMessage`/`buildDomTable`，零 innerHTML）、`statOptions` 交互表、样式（`main.css` `.kp-table` 等）均就绪。
> - **本次收尾修复**：F1 修复 `server/socketHandler.js` L1124-1125 通用副本路径使用未声明 `roomHistory` 导致的 ReferenceError（→ `room.history`）；G1 `frontend/js/client.js` statOptions 空 options 降级分支复用 `parseKpTableMessage` DOM 渲染。
> - 测试：`node --check` 2/2 + `test_t2_verify.py`（conda `coc_rpg_env`）11/11 通过。

### 涉及文件

| 文件 | 行号 | 操作 |
|------|------|------|
| `server/socketHandler.js` | L1055-1075 | 修改青峰山全局行动 DeepSeek prompt |
| `server/socketHandler.js` | L1090-1115 | 修改通用副本全局行动 DeepSeek prompt |
| `server/socketHandler.js` | L1060-1070 | 拆分 result.story 并分别推送 |
| `server/socketHandler.js` | L1105-1115 | 同上（通用副本） |
| `frontend/js/client.js` | L1567-1583 | privateMsg 监听器增加管道符表格检测 |

### 修改方案

#### 1. 服务端 prompt 追加分隔指令

**青峰山**（L1058 `playerAction` 字段末尾）和**通用副本**（L1100 `playerAction` 字段末尾）各追加：

```
\n\n请严格按以下格式回复：\n===公共叙述===\n[以团队第三人称视角叙述整体行动结果]\n===单人细化===\n| 玩家名 | 个人视角细化叙述 |\n| 玩家名 | 个人视角细化叙述 |
```

#### 2. 服务端拆分 result.story

**青峰山**（L1062-1070 回调）和**通用副本**（L1103-1115 回调）中：

```js
// 拆分公共叙述和单人细化
const publicMatch = result.story.match(/===公共叙述===\s*([\s\S]*?)(?====单人细化===|$)/);
const privateMatch = result.story.match(/===单人细化===\s*([\s\S]*?)$/);
const publicStory = (publicMatch ? publicMatch[1].trim() : result.story) || result.story;
const privateDetail = privateMatch ? privateMatch[1].trim() : '';

// 公共频道
io.to(gameRoomId).emit('aiReply', {
  from: 'KP', story: publicStory, ...
});
// 单人频道：仅推送单人细化部分
if (privateDetail) {
  socket.emit('privateMsg', { msg: privateDetail, sender: 'KP' });
}
```

注意：移除原来的 `socket.emit('privateMsg', { msg: result.story, sender: 'KP' })`（完整 story 不再重复推单人频道）。

#### 3. 前端 privateMsg 管道符表格渲染

在 `frontend/js/client.js` L1567 `privateMsg` 监听器中，`formatKpMessage` 调用前增加检测：

```js
socket.on('privateMsg', ({ msg, sender, senderId, avatar }) => {
  // ... 现有头像逻辑不变 ...
  
  // ★ 检测管道符表格格式（单人细化），转为 HTML 表格渲染
  let displayMsg = msg;
  if (sender === 'KP' && typeof msg === 'string') {
    const lines = msg.trim().split('\n');
    const isPipeTable = lines.length >= 2 && lines.every(l => l.trim().startsWith('|') && l.trim().endsWith('|'));
    if (isPipeTable) {
      // 构建 HTML 表格
      const rows = lines.map(line => {
        const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const isHeader = /^[-:\s]+$/.test(cells[0]) || cells.every(c => /^[-:\s]+$/.test(c));
        if (isHeader) return null; // 跳过分隔行
        return `<tr>${cells.map(c => `<td style="padding:4px 8px;border:1px solid #3a352e;">${c}</td>`).join('')}</tr>`;
      }).filter(Boolean).join('');
      displayMsg = `<table style="width:100%;border-collapse:collapse;margin:8px 0;">${rows}</table>`;
    }
  }
  
  const formatted = formatKpMessage(displayMsg, sender);
  appendLog(privateLog, formatted, sender, senderId, avatar);
});
```

### 测试要点

- DeepSeek 返回符合两段格式 → publicStory 发公共频道，privateDetail 发表格到单人频道
- DeepSeek 返回不含分隔符 → publicStory=全文，privateDetail 为空（不崩溃）
- 前端收到管道符表格 → 渲染为 HTML table
- 前端收到普通文本 → 正常走 formatKpMessage

---

## T-3：地图和场景图位置互换（HTML + CSS）

| 属性 | 值 |
|------|-----|
| ID | T-3 |
| 优先级 | P0（高） |
| 类别 | 前端 |
| 预估代码量 | HTML ~10 行 + CSS ~8 行 |
| 依赖 | 无 |

### 涉及文件

| 文件 | 行号 | 操作 |
|------|------|------|
| `frontend/index.html` | L232-241 | 互换 sceneBg `<img>` 与 cityMapContainer |
| `frontend/css/main.css` | L648-680 | 调整 scene-canvas / city-map-container 样式 |
| `frontend/css/main.css` | L696-720 | city-map-container 改为 100% 充满 |

### HTML 修改方案

**当前结构（L232-241）**：
```html
<div class="scene-canvas" id="sceneCanvas">
  <img id="sceneBg" src="" alt="场景图">
  <div id="unitLayer"></div>
</div>
<div class="scene-below" id="sceneBelow">
  <div class="scene-below-left" id="sceneBelowLeft">
    <div class="city-map-container" id="cityMapContainer" style="...">
      <img class="city-map-bg" id="cityMapBg" ...>
      <div class="map-mark-layer" id="mapMarkLayer"></div>
    </div>
  </div>
  ...
</div>
```

**修改后结构**：
```html
<div class="scene-canvas" id="sceneCanvas">
  <!-- ★ 上半 50vh：城市地图容器 -->
  <div class="city-map-container" id="cityMapContainer">
    <img class="city-map-bg" id="cityMapBg" src="" alt="城市地图">
    <div class="map-mark-layer" id="mapMarkLayer"></div>
  </div>
  <div id="unitLayer"></div>
</div>
<div class="scene-below" id="sceneBelow">
  <div class="scene-below-left" id="sceneBelowLeft">
    <!-- ★ 下半左栏：场景图 -->
    <img id="sceneBg" src="" alt="场景图">
  </div>
  ...
</div>
```

> **关键约束**：`#unitLayer` 保留在 `#sceneCanvas` 中，作为绝对定位叠加层。

### CSS 修改方案

#### 1. `.city-map-container` 改为 100% 充满 50vh

当前（L696-703）：
```css
.city-map-container {
  flex: 0 0 50%;
  position: relative;
  ...
}
```

修改为：
```css
.city-map-container {
  width: 100%;
  height: 100%;
  position: relative;
  ...
}
```

同时移除 HTML 中 inline style `style="width:100%;aspect-ratio:4/3;..."`。

#### 2. `.scene-below-left` 中的 `#sceneBg` 保留 contain

当前 `.scene-canvas img`（L670-680）有 `object-fit: contain`。`#sceneBg` 移到 `#sceneBelowLeft` 后，需要在 CSS 中显式声明：

```css
.scene-below-left #sceneBg,
.scene-below-left img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
```

#### 3. `.scene-canvas` 保持 height: 50vh

当前 `.scene-canvas`（L648-658）`height: 50vh` 不变，city-map-container 继承该高度。

### 测试要点

- 上半 50vh 显示城市地图容器，下半左栏显示场景图
- `#unitLayer` 仍在 sceneCanvas 内正确叠加
- 地图标记点 `map-mark-layer` 位置正常
- 移动端响应式无溢出

---

## T-4：旧存档角色不显示 Bug（getCharacterList 完整性同步）

| 属性 | 值 |
|------|-----|
| ID | T-4 |
| 优先级 | P0（高） |
| 类别 | 后端 |
| 预估代码量 | ~5 行（删减为主） |
| 依赖 | 无 |

### 涉及文件

| 文件 | 行号 | 操作 |
|------|------|------|
| `server/socketHandler.js` | L266-278 | 修改 `getCharacterList` 处理器 |
| `server/storage.js` | — | **无需改动**（`recoverOrphanCharacters` 已有去重逻辑） |

### 当前代码（L266-278）

```js
socket.on('getCharacterList', ({ uid }) => {
  if (!uid) return socket.emit('error', { msg: '用户ID缺失' });
  const characters = storage.loadUserCharacters(uid);
  if (characters.length === 0) {
    const recovered = storage.recoverOrphanCharacters(uid);
    if (recovered.length > 0) {
      logger.user.info('角色列表恢复', { uid, recoveredCount: recovered.length });
    }
    socket.emit('characterList', { characters: recovered });
    return;
  }
  socket.emit('characterList', { characters });
});
```

### 修改方案

移除 `characters.length === 0` 条件，**每次调用都执行 recoverOrphanCharacters**：

```js
socket.on('getCharacterList', ({ uid }) => {
  if (!uid) return socket.emit('error', { msg: '用户ID缺失' });
  // ★ 始终检查孤儿角色，确保角色列表完整性
  const characters = storage.recoverOrphanCharacters(uid);
  if (characters.length === 0) {
    logger.user.info('角色列表为空', { uid });
  }
  socket.emit('characterList', { characters });
});
```

> **为什么安全**：`recoverOrphanCharacters` 内部用 `knownIds` Set 做了去重，已关联的角色不会重复添加。每次调用只是扫描一下 `CHARACTERS_DIR`，开销很小（O(n) 文件数）。

### 测试要点

- 正常用户（有角色）→ recover 扫描但不改变列表，返回原有角色
- 旧存档用户（角色文件存在但 records.json 中缺失）→ 自动恢复
- 无角色用户 → 返回空数组，不崩溃

---

## T-5：互换后 CSS 优化 + bgSwitcher 确认

| 属性 | 值 |
|------|-----|
| ID | T-5 |
| 优先级 | P1（中） |
| 类别 | 前端 |
| 预估代码量 | 0-5 行（主要是确认验证） |
| 依赖 | **T-3**（DOM 结构调整完成后才能验证） |

### 涉及文件

| 文件 | 行号 | 操作 |
|------|------|------|
| `frontend/css/main.css` | L648-680, L696-730, L2118-2125 | 确认/微调样式 |
| `frontend/js/bgSwitcher.js` | L87-130 | 确认 `document.getElementById('sceneBg')` 指向下半新位置 |
| `frontend/js/client.js` | L36, L304, L1558 | 确认 `sceneBg` 变量引用正确 |

### 确认清单

#### 1. CSS 确认

| 选择器 | 行号 | 确认项 |
|--------|------|--------|
| `.scene-canvas` (L648) | 648-658 | `height: 50vh` 不变；cityMapContainer 继承此高度正确 |
| `.scene-canvas img` (L670) | 670-680 | `object-fit: contain` — 确认不影响 cityMapContainer 内的 img（是否需要加 `>` 限定？） |
| `.city-map-container` (L696) | 696-720 | 确认 T-3 已将 `flex: 0 0 50%` 改为 `width/height: 100%` |
| `.scene-canvas` (L2118) | 2118-2125 | 缩放/拖拽样式：`overflow: hidden; cursor: grab` — cityMapContainer 是否也需要 grab？ |

#### 2. bgSwitcher.js 确认

**L87-130 `applyBackground` 函数**：内部调用 `document.getElementById('sceneBg')` 来更新场景图。

- T-3 后 `#sceneBg` 从 `#sceneCanvas` 移到 `#sceneBelowLeft`
- `getElementById('sceneBg')` **全局查找不受 DOM 位置影响** → ✅ 无需代码改动
- 但需确认：淡入淡出过渡效果在 contain 模式下正常

#### 3. client.js 确认

| 行号 | 变量/代码 | 确认 |
|------|-----------|------|
| L36 | `let sceneBg` | 声明不变，运行时通过 `getElementById('sceneBg')` 获取 |
| L304 | `sceneBg = document.getElementById('sceneBg')` | DOM 查询不受位置影响 |
| L1558 | `if (img && sceneBg && !sceneBg.src) sceneBg.src = img` | aiReply handler 设置场景图 — 确认 `#sceneBg` 移到下半后 src 赋值正确生效 |

### 可能需要微调

- `.scene-canvas img` 选择器加了 `>` 限定后，city-map-container 内的 `.city-map-bg` 不再受影响
- 城市地图可能需要 `cursor: default` 而非 `grab`（scene-canvas 的 grab 是为图片缩放设计的，地图可能不需要）

### 测试要点

- bgSwitcher 切换背景 → 场景图在下半左栏正确更新
- aiReply 设置 img → sceneBg 在下半左栏正确显示
- 场景图缩放/拖拽 → 在下半正确响应（如果原来有的话）
- 地图标记点不受影响

---

## Issue 创建清单

| Issue # | 标题 | 关联任务 | 标签 |
|---------|------|----------|------|
| GH-? | formatKpMessage 新增【风险】【收益】独立换段 | T-1 | `frontend` `enhancement` |
| GH-? | 单人回应细化全局播报（前后端联动） | T-2 | `fullstack` `enhancement` |
| GH-? | 地图与场景图 DOM/CSS 位置互换 | T-3 | `frontend` `layout` |
| GH-? | 修复旧存档角色不显示 Bug | T-4 | `backend` `bug` |
| GH-? | 互换后 CSS 校验 + bgSwitcher 引用确认 | T-5 | `frontend` `qa` |

> Issue 编号由 Orchestrator 创建后回填。

---

## 风险评估

| 风险 | 影响任务 | 概率 | 缓解措施 |
|------|----------|------|----------|
| `【风险】` 正则先匹配破坏 `【风险/收益】` 合写 | T-1 | 中 | 独立标签放在合写标签**之前**即可（正则按顺序执行） |
| DeepSeek 不遵循分隔格式 | T-2 | 中 | 用正则兜底：无匹配时 publicStory = result.story 全文 |
| cityMapContainer 移到 sceneCanvas 后地图标记定位偏移 | T-3 | 低 | map-mark-layer 绝对定位相对于 city-map-container，不受影响 |
| recoverOrphanCharacters 每次调用扫描目录性能 | T-4 | 低 | 角色目录文件数通常 < 20，fs.readdirSync 开销可忽略 |
| bgSwitcher 淡入淡出过渡与新位置冲突 | T-5 | 低 | bgSwitcher 用 `getElementById` 全局查找，DOM 位置不影响 |
