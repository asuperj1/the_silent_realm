# ADR-005-PLAN：副本选择大厅背景与方尖碑重构

| 属性 | 值 |
|------|-----|
| ADR ID | ADR-005-PLAN |
| 状态 | `UNDERSTANDING` → `PLANNING` |
| 依赖 ADR | **取代** ADR-003/004 中背景层相关任务 |
| 创建日期 | 2026-08-06 |
| 设计基调 | 洛夫克拉夫特古籍扉页 — 纯黑底 + 暗金边框 + 黑曜石方尖碑 |

---

## 一、需求溯源与冲突声明

本需求**覆盖并取代**以下已有方案中的相关部分：

| 被取代内容 | 来源 ADR | 冲突原因 |
|-----------|---------|---------|
| T-1 isometricBg 引擎升级（加速循环/红色流光/去地面） | ADR-003-PLAN | 不再需要 Canvas 背景引擎 |
| T-3 金色流光效果层（四角金束+对角斜线） | ADR-003-PLAN | 完全移除，替换为视口金框 |
| T-4 锯齿红色光带背景 | ADR-004-PLAN | 删除，不再需要 |
| T-1 方尖碑渲染流畅度（Canvas 离屏缓存） | ADR-004-PLAN | 方尖碑改为 DOM 渲染 |
| T-3 红色流光辐射增强（Canvas 径向渐变） | ADR-004-PLAN | 红色流光改为 CSS 叠加层 |

**保留不变**：T-2 环形卡片布局、T-4/T-5 飞页过渡、卡片点击跳转、房间联动、登录链路。

---

## 二、架构总览

```
┌─────────────────────────────────────────────────┐
│  #pageCopySelect                                │
│  ┌───────────────────────────────────────────┐  │
│  │  Canvas #isometricBgCanvas  (z-index:0)   │  │
│  │  纯黑 #000 + 四角暗角 vignette             │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │  .copy-select-overlay  (z-index:1)        │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  #obelisk (DOM, z-index:1)          │  │  │
│  │  │  11 帧序列 + SVG 符文 + 红光叠加层   │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  Canvas #goldParticleCanvas (z:1.5)  │  │  │
│  │  │  20-50 悬浮金尘粒子                   │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  .copy-cards-ring (z-index:2)       │  │  │
│  │  │  3 副本卡片 + 独立金边 sweep         │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │  视口金框层 (z-index:3)                    │  │
│  │  四角角饰花纹 + 四边暗金细线 + 慢速辉光    │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## 三、逐项功能规格

### 3.1 背景层 — 纯黑 + 暗角

| 项目 | 规格 |
|------|------|
| 底色 | `#000000`，body 级 `background-color: #000` |
| 暗角 | 四角径向渐变暗角，`rgba(0,0,0,0)` → `rgba(0,0,0,0.35)`，由 Canvas 绘制 |
| Canvas 保留 | `#isometricBgCanvas` 保留，仅绘制纯黑底 + vignette |
| 瓦片使用 | **零使用** — 不加载、不渲染任何 `isometric_tile/` 图片到背景 |
| isometricBg.js | 所有渲染逻辑**注释保留**（不删除），仅保留 Canvas 初始化/resize + 纯黑底绘制 |
| 红色锯齿光带 | 删除 |
| 山体远景 | 删除 |
| 地面菱形网格 | 删除 |
| 雾气漂移 | 删除 |
| 金色竖线/横向扫光 | 删除 `#copyGoldBeams` 整个 DOM 块 |

### 3.2 视口金框 — 古籍扉页风格

| 项目 | 规格 |
|------|------|
| 风格 | 四角固定暗金角饰花纹 + 四边暗金细线连接 |
| 参考 | 洛夫克拉夫特古籍扉页版式，非灯带式扫光 |
| 色调 | 暗金/古铜金：`#a08040` ~ `#c8a860` |
| 边框位置 | 视口内缩 12-20px |
| 边框宽度 | 1-2px 细线 |
| 角饰 | 四角各有一个装饰性角花（CSS 伪元素实现，非图片素材） |
| 流光动画 | 沿边框线有缓慢辉光流动，单圈周期 **3-6 秒** |
| 辉光层次 | 柔和 `box-shadow` 辉光，无刺眼亮点 |
| 实现方式 | 独立 DOM 层（替换 `#copyGoldBeams`），纯 CSS `@keyframes` + 伪元素 |

### 3.3 方尖碑 — DOM 序列帧动画

#### 3.3.1 结构与定位

| 项目 | 规格 |
|------|------|
| DOM 元素 | `<div id="obelisk">` 插入 `.copy-select-stage` 内部 |
| z-index | 1（Canvas 之上，金尘粒子之下） |
| 尺寸 | 响应式：宽度 **25-30vw**，高度 **45-55vh** |
| 定位 | `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)`，垂直微偏上以适配 UI header |
| 轮廓裁剪 | `clip-path: polygon(...)` — 尖顶 + 梯形碑身形状 |

#### 3.3.2 序列帧动画

| 项目 | 规格 |
|------|------|
| 素材 | `OFDN Isometric Tile 01.png ~ 11.png`，**仅限方尖碑使用** |
| 帧率 | **8-12 fps**（推荐 8fps 为主） |
| 播放顺序 | 01 → 02 → … → 11 → 回到 01，无限循环 |
| 循环衔接 | 11→01 过渡与其他帧间过渡一致，无断层 |
| 预加载 | 页面初始化时 `new Image()` 预加载全部 11 张，Promise.all 确认就绪后再显示 |

#### 3.3.3 帧过渡效果

| 项目 | 规格 |
|------|------|
| 透明度过渡 | 帧A `opacity: 1→0`（200-250ms），帧B `opacity: 0→1`（200-250ms），两帧重叠交叉淡化 |
| 高斯模糊插值 | 帧A 淡出时 `filter: blur(0→6px)`，帧B 淡入时 `filter: blur(6px→0)` |
| 实现方式 | JS 驱动帧切换 + CSS transition 实现 crossfade |
| 时序 | 每帧显示约 125ms（8fps），过渡 250ms（crossfade 重叠），实际每帧占位 ~375ms |

#### 3.3.4 碑体质感叠加

| 图层 | 技术 | 规格 |
|------|------|------|
| 底层 | 11 张序列帧 `<img>` | `clip-path` 裁切到碑体轮廓 |
| 符文裂纹层 | **内联 SVG** | 固定在序列帧上方，暗金色描边（`#b8922e`），不透明裂纹纹路 |
| 边缘金描边 | CSS `filter: drop-shadow()` | 沿 clip-path 边缘的细金描边，1-2px |
| 黑曜石哑光基底 | CSS `background: #1a1a1a` 在方尖碑容器上 | 序列帧透明区域露出深色基底 |
| 红色流光层 | CSS 叠加 `<div>` | 见 3.3.5 |

#### 3.3.5 红色流光特效

| 项目 | 规格 |
|------|------|
| 实现方式 | 方尖碑容器内的独立 `<div class="obelisk-red-glow">`，CSS 动画 |
| 帧关联 | 10/11 号瓦片（红色区域大的帧）→ 红光亮度增强；01-09 暗色瓦片 → 低亮度内敛红光 |
| 实现手段 | JavaScript 监听当前帧索引，动态修改红光层 CSS 变量（`--glow-opacity`、`--glow-radius`） |
| 光效类型 | 内敛放射效果：`radial-gradient` 从碑体中心向外扩散，**不饱和刺眼** |
| 色值 | `rgba(180, 30, 20, var(--glow-opacity))`，饱和度控制在 60-70% |
| 辐射范围 | 随帧切换在 `box-shadow` 的 spread-radius 上微调（±15%） |

#### 3.3.6 仪式光环

| 项目 | 规格 |
|------|------|
| 类型 | 地面水平暗金色仪式光环（方尖碑底部） |
| 实现 | CSS `<div>`：`border-radius: 50%` + `transform: rotateX(75deg)` 模拟地面透视椭圆 |
| 尺寸 | 宽度约等于方尖碑宽度的 1.5-2 倍 |
| 动画 | 低速旋转：`@keyframes ringRotate`，周期 8-12 秒 |
| 颜色 | 暗金 `border: 1-2px solid rgba(180,140,60,0.5)` + `box-shadow: 0 0 20px rgba(180,140,60,0.3)` |
| 层级 | 2 层同心环（内环稍快、外环稍慢） |

### 3.4 金色粒子系统

| 项目 | 规格 |
|------|------|
| 实现 | 独立 Canvas `<canvas id="goldParticleCanvas">` |
| 位置 | `.copy-select-stage` 内，z-index 介于方尖碑(1) 和卡片环(2) 之间 |
| 粒子数 | **20-50 个** |
| 视觉效果 | 微小金尘，缓慢漂浮，柔和辉光 |
| 颜色 | `rgba(200, 160, 80, 0.4~0.8)` |
| 运动 | 随机布朗运动 + 微弱上升趋势 + 边界回弹 |
| 大小 | 1-3px 半径，带 `shadowBlur` 辉光 |
| 性能 | `requestAnimationFrame` 驱动，`pointer-events: none` |

### 3.5 副本卡片

| 项目 | 规格 |
|------|------|
| 位置/文字/跳转 | **完全不变** |
| 金边 sweep | 每个 `.copy-ring-card` 已有金边 sweep 动画，保留并微调色调匹配新暗金体系 |
| 瓦片素材 | **不使用**任何 `isometric_tile/` 图片 |
| 数量 | 3 个副本按钮不变 |

---

## 四、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/js/isometricBg.js` | **注释保留** | 注释所有渲染层代码，保留 init/resize/Canvas 管理框架，仅绘制纯黑底+vignette |
| `frontend/index.html` | **修改** | ① 删除 `#copyGoldBeams` 块 ② 新增 `<div id="obelisk">` 在 `.copy-select-stage` ③ 新增 `<canvas id="goldParticleCanvas">` ④ 新增视口金框层 |
| `frontend/css/main.css` | **修改** | ① `body { background-color: #000 }` ② 新增 `#obelisk` 全部样式 ③ 新增视口金框样式 ④ 新增金尘 Canvas 样式 ⑤ 删除 `#copyGoldBeams` 相关样式 |
| `frontend/css/goldBeams.css` | **不加载/移除引用** | 副本选择页不再引用此文件 |
| `frontend/js/roomHall.js` | **可能微调** | 如方尖碑 DOM 坐标影响卡片环形布局计算 |
| `assets/isometric_tile/` | **不变** | 11 张图片仅由方尖碑 DOM 预加载使用 |
| `server/gamelogic.js` | **不变** | 无后端变更 |

---

## 五、非功能需求

| 类别 | 要求 |
|------|------|
| 性能 | 方尖碑 11 张图片预加载完成前显示 loading 状态；金尘粒子 ≤50 个保证 60fps |
| 响应式 | 方尖碑 vw/vh 单位自适应；视口金框百分比定位；暗角跟随 Canvas resize |
| 兼容性 | `clip-path` 需 WebKit 前缀；`filter: blur()` 性能注意移动端 |
| 可维护性 | isometricBg.js 注释保留便于回滚；新增样式用独立 CSS 块并标注 `ADR-005` |
| 氛围 | 全程克苏鲁压抑神秘——低饱和、暗色调、慢节奏、无闪烁 |

---

## 六、与已有 ADR 的关系

| ADR | 关系 | 处理 |
|-----|------|------|
| ADR-003-PLAN T-1 | **取代** | isometricBg 引擎不需要升级，改为注释 |
| ADR-003-PLAN T-2 | **保留** | 环形卡片布局继续有效，微调坐标引用 |
| ADR-003-PLAN T-3 | **取代** | 金色流光从四角金束改为视口金框 |
| ADR-003-PLAN T-4 | **保留** | 飞页过渡不受影响 |
| ADR-003-PLAN T-5 | **保留** | 整体风格统一仍需要，但参照新规范 |
| ADR-004-PLAN T-1 | **取代** | 方尖碑从 Canvas 离屏缓存改为 DOM 序列帧 |
| ADR-004-PLAN T-2 | **保留** | 下半圈卡片环绕继续有效 |
| ADR-004-PLAN T-3 | **取代** | 红色流光从 Canvas 径向渐变改为 CSS 叠加层 |
| ADR-004-PLAN T-4 | **删除** | 锯齿红色光带不再需要 |
| ADR-004-PLAN T-5 | **保留** | 合页金色流光继续有效 |

---

## 七、任务拆分计划

> 下述任务按依赖拓扑排序。标记 🅰🅱 表示可并行。

### 任务依赖拓扑图

<table style="border-collapse:separate; border-spacing:6px; font-size:13px; text-align:center;">
  <tr>
    <td style="border:2px solid #3b82f6; border-radius:8px; padding:8px 12px; background:#eff6ff; font-weight:700;">T-1<br>背景清理</td>
    <td style="color:#64748b; font-size:20px; padding:0 8px;">→</td>
    <td style="border:1px solid #94a3b8; border-radius:8px; padding:8px 12px; background:#fff7ed; font-weight:700;">T-2 🅰<br>方尖碑DOM</td>
    <td style="color:#64748b; font-size:16px; padding:0 4px;">→</td>
    <td style="border:1px solid #94a3b8; border-radius:8px; padding:8px 12px; background:#fff7ed; font-weight:700;">T-4<br>碑体质感</td>
    <td style="color:#64748b; font-size:16px; padding:0 4px;">↘</td>
    <td rowspan="2" style="border:1px solid #94a3b8; border-radius:8px; padding:10px 14px; background:#f0fdf4; font-weight:700;">T-7<br>收尾清理</td>
  </tr>
  <tr>
    <td colspan="2" style="text-align:right;"></td>
    <td style="border:1px solid #94a3b8; border-radius:8px; padding:8px 12px; background:#fefce8; font-weight:700;">T-3 🅱<br>视口金框</td>
    <td style="border:1px solid #94a3b8; border-radius:8px; padding:8px 12px; background:#fff7ed; font-weight:700;">T-5<br>红色流光</td>
    <td style="color:#64748b; font-size:16px; padding:0 4px;">↗</td>
  </tr>
  <tr>
    <td colspan="4" style="text-align:right; padding-top:6px;"></td>
    <td style="border:1px dashed #94a3b8; border-radius:8px; padding:8px 12px; background:#faf5ff; font-weight:600;">T-6 🅲<br>光环+金尘</td>
    <td style="color:#64748b; font-size:16px; padding:0 4px;">→</td>
  </tr>
</table>

> 🅰🅱 T-2 / T-3 可并行；🅲 T-6 可与 T-4 / T-5 并行；所有 T-2 子任务（T-4/T-5）可与 T-3/T-6 交叉进行。

---

### T-1 · 背景层清理（isometricBg.js 注释保留 + Canvas 纯黑底）

| 属性 | 值 |
|------|-----|
| **依赖** | 无（首个任务） |
| **涉及文件** | `frontend/js/isometricBg.js` |
| **预估难度** | ⭐⭐ 中低 |
| **分类** | 前端 |

#### 操作清单

1. **保留框架代码**：`init()` / `resize()` / `start()` / `stop()` / `getAnomalyBounds()` / `window.IsometricBg` 导出对象保留不动
2. **注释渲染层代码**（用 `/* … */` 包裹，不删除）：
   - `draw()` 函数内：`drawMountains()`、`drawGroundLayer()`、`drawRedZigzagBands()`、`drawRedBandGlints()`、`drawAnomalyLayer()`、`drawMist()` 调用全部注释
   - 全局黑雾 `ctx.fillRect` 注释
   - 顶部灰度条 `topGrad` 注释
3. **保留并保留**：`ctx.clearRect()`、四角暗角 vignette 绘制代码保留
4. **新增纯黑底绘制**：在 `clearRect` 之后、vignette 之前添加 `ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvasW, canvasH);`
5. **注释瓦片加载调用**：IIFE 末尾的 `loadTiles().then(...)` 注释（不再预加载瓦片到背景）
6. **调整 `start()`**：移除 `if (!loaded)` 的瓦片等待逻辑，`start()` 直接调用 `_doStart()`
7. **`getAnomalyBounds()` 返回值调整**：不再依赖 `canvasW/canvasH` 计算异常区域，改用固定视口中心坐标（`cx: window.innerWidth/2, cy: window.innerHeight*0.45`），宽度返回 `Math.min(canvasW, canvasH) * 0.3`

#### 验收标准

- [ ] `isometricBg.js` 所有旧渲染逻辑以注释形式完整保留，可随时回滚
- [ ] Canvas 仅显示纯黑 `#000` + 四角 radial-gradient 暗角
- [ ] `window.IsometricBg.init/start/stop/resize/getAnomalyBounds` 仍可正常调用
- [ ] 页面切换到 `#pageCopySelect` 不报错，Canvas 显示纯黑背景
- [ ] 环形卡片布局仍能获取 `getAnomalyBounds()` 返回值

---

### T-2 · 方尖碑 DOM 结构 + 序列帧动画引擎

| 属性 | 值 |
|------|-----|
| **依赖** | T-1（背景清理完成后 Canvas 不再抢占瓦片） |
| **涉及文件** | `frontend/index.html`、`frontend/css/main.css`、`frontend/js/isometricBg.js`（或新建 `frontend/js/obelisk.js`） |
| **预估难度** | ⭐⭐⭐⭐ 高 |
| **分类** | 前端 |
| 🅰 | 与 T-3 并行 |

#### 操作清单

##### 2.1 HTML 结构（`index.html`）

在 `.copy-select-stage` 内部，`#copyCardsRing` 之前插入：

```html
<div id="obelisk" style="display:none;">
  <img id="obeliskFrameA" class="obelisk-frame" src="" alt="">
  <img id="obeliskFrameB" class="obelisk-frame obelisk-frame-next" src="" alt="">
</div>
```

##### 2.2 CSS 样式（`main.css`，标注 `/* === ADR-005: 方尖碑 === */`）

| 选择器 | 关键属性 |
|--------|---------|
| `#obelisk` | `position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:28vw; height:50vh; z-index:1; pointer-events:none;` |
| `#obelisk` | `clip-path: polygon(50% 0%, 85% 25%, 80% 100%, 20% 100%, 15% 25%)` （尖顶+梯形碑身） |
| `.obelisk-frame` | `position:absolute; inset:0; width:100%; height:100%; object-fit:contain; transition: opacity 250ms ease, filter 250ms ease;` |
| `.obelisk-frame-next` | `opacity:0; filter:blur(6px);` |

##### 2.3 JS 序列帧引擎（新建 `obelisk.js` 或追加到 `isometricBg.js` 末尾）

- 预加载 11 张 `OFDN Isometric Tile 01.png ~ 11.png` → `Promise.all`
- 帧率 **8fps**（每帧~125ms），crossfade 重叠 250ms
- 双 `<img>` 乒乓切换：帧A opacity 1→0 + blur 0→6px；帧B opacity 0→1 + blur 6px→0
- 循环：01→02→…→11→01
- 11→01 过渡与其他帧一致，无跳变
- 预加载完成后 `#obelisk` display 从 `none` → `block`，派发 `obeliskReady` 事件
- 暴露 `window.Obelisk = { start(), stop(), getCurrentFrameIndex() }`

#### 验收标准

- [ ] 11 张图片全部预加载完成后方尖碑显示
- [ ] 8fps 帧切换流畅，crossfade 无明显闪烁
- [ ] `clip-path` 正确裁剪碑体轮廓（尖顶+梯形）
- [ ] 11→01 循环无缝衔接
- [ ] `window.Obelisk.getCurrentFrameIndex()` 返回 0-10
- [ ] 页面切换时动画可正确启停

---

### T-3 · 视口金框（古籍扉页风格四角角饰 + 暗金细线）

| 属性 | 值 |
|------|-----|
| **依赖** | T-1（背景纯黑后才能验证金框对比度） |
| **涉及文件** | `frontend/index.html`、`frontend/css/main.css` |
| **预估难度** | ⭐⭐⭐ 中 |
| **分类** | 前端 |
| 🅱 | 与 T-2 并行 |

#### 操作清单

##### 3.1 HTML（`index.html`）

在 `#pageCopySelect` 末尾、`#copyGoldBeams` 之后新增（**T-7 前不删除旧金束以保证回滚安全**）：

```html
<div id="viewportGoldFrame" class="viewport-gold-frame">
  <div class="vgf-corner vgf-tl"></div>
  <div class="vgf-corner vgf-tr"></div>
  <div class="vgf-corner vgf-bl"></div>
  <div class="vgf-corner vgf-br"></div>
  <div class="vgf-edge vgf-top"></div>
  <div class="vgf-edge vgf-bottom"></div>
  <div class="vgf-edge vgf-left"></div>
  <div class="vgf-edge vgf-right"></div>
</div>
```

##### 3.2 CSS（`main.css`，标注 `/* === ADR-005: 视口金框 === */`）

| 元素 | 实现方式 | 规格 |
|------|---------|------|
| `.viewport-gold-frame` | 容器 | `position:fixed; inset:16px; z-index:10; pointer-events:none;` |
| `.vgf-corner` | `::before` + `::after` 伪元素 | 四角 L 形角饰：横臂 40px×2px + 竖臂 2px×40px，`background: linear-gradient(...)` 暗金 `#a08040→#c8a860` |
| `.vgf-edge` | 细线 | 四边 1px 暗金线，`background: rgba(180,140,60,0.45)` |
| 辉光流动 | `@keyframes frameGlow` | 沿边框 `box-shadow` 慢速脉动：0→30%→100% 周期 3-6s，`ease-in-out`，四边各错相 0.75s |

#### 验收标准

- [ ] 视口内缩 16px 处可见四角 L 形暗金角饰
- [ ] 四边 1px 暗金细线连接四角
- [ ] 辉光沿边框缓慢流动，无刺眼亮点
- [ ] 纯黑背景上暗金边框对比度足够（符合古籍扉页氛围）
- [ ] `pointer-events: none` 不阻挡交互

---

### T-4 · 碑体质感叠加（SVG 符文裂纹 + 金描边 + 黑曜石基底）

| 属性 | 值 |
|------|-----|
| **依赖** | T-2（方尖碑 DOM 结构就绪） |
| **涉及文件** | `frontend/index.html`、`frontend/css/main.css` |
| **预估难度** | ⭐⭐⭐ 中 |
| **分类** | 前端 |

#### 操作清单

##### 4.1 HTML（`index.html`，在 `#obelisk` 内序列帧 `<img>` 之后插入）

```html
<svg id="obeliskRunes" class="obelisk-runes" viewBox="0 0 200 400" preserveAspectRatio="none">
  <!-- 暗金符文裂纹路径：若干条不规则路径模拟石材裂纹 -->
  <path d="M100,30 L95,80 L110,130 L90,180 L105,250 L85,320 L100,380" 
        fill="none" stroke="#b8922e" stroke-width="1.2" opacity="0.55"/>
  <path d="M60,60 L70,100 L55,160 L75,220 L50,300 L65,370" 
        fill="none" stroke="#9a7b2a" stroke-width="0.8" opacity="0.4"/>
  <path d="M140,50 L130,110 L145,170 L125,240 L140,310 L130,380" 
        fill="none" stroke="#a08030" stroke-width="0.9" opacity="0.45"/>
  <!-- 符文点：若干小圆代表符文节点 -->
  <circle cx="100" cy="80" r="2.5" fill="#c8a040" opacity="0.5"/>
  <circle cx="90" cy="180" r="2" fill="#b8922e" opacity="0.45"/>
  <circle cx="105" cy="260" r="2.5" fill="#c8a040" opacity="0.5"/>
  <circle cx="85" cy="340" r="2" fill="#b8922e" opacity="0.4"/>
</svg>
```

##### 4.2 CSS（`main.css`，标注 `/* === ADR-005: 碑体质感 === */`）

| 样式 | 规格 |
|------|------|
| `#obelisk` | `background: #1a1a1a` （黑曜石哑光基底） |
| `#obelisk` | `filter: drop-shadow(0 0 3px rgba(180,140,60,0.5)) drop-shadow(0 0 1px rgba(200,160,40,0.6))` |
| `.obelisk-runes` | `position:absolute; inset:0; width:100%; height:100%; z-index:2; pointer-events:none;` |

#### 验收标准

- [ ] SVG 暗金裂纹与符文点叠加在序列帧上方
- [ ] `drop-shadow()` 沿 `clip-path` 边缘产生 1-2px 金描边
- [ ] `#1a1a1a` 黑曜石底色在序列帧透明区域可见
- [ ] 符文裂纹不遮挡序列帧主体内容
- [ ] 整体质感符合"黑曜石方尖碑+暗金刻痕"氛围

---

### T-5 · 红色流光 CSS 叠加层适配

| 属性 | 值 |
|------|-----|
| **依赖** | T-2（序列帧引擎就绪，可读取当前帧索引） |
| **涉及文件** | `frontend/index.html`、`frontend/css/main.css`、方尖碑 JS 模块 |
| **预估难度** | ⭐⭐ 中低 |
| **分类** | 前端 |

#### 操作清单

##### 5.1 HTML（`index.html`，在 `#obelisk` 内 SVG 之后插入）

```html
<div id="obeliskRedGlow" class="obelisk-red-glow"></div>
```

##### 5.2 CSS（`main.css`，标注 `/* === ADR-005: 红色流光 === */`）

```css
.obelisk-red-glow {
  position: absolute; inset: 0;
  z-index: 3; pointer-events: none;
  background: radial-gradient(ellipse at center, 
    rgba(180,30,20, var(--glow-opacity, 0.15)) 0%, 
    rgba(140,20,10, calc(var(--glow-opacity, 0.15) * 0.5)) 40%, 
    transparent 70%);
  box-shadow: inset 0 0 var(--glow-radius, 40px) rgba(180,30,20, var(--glow-opacity, 0.15));
  transition: background 300ms ease, box-shadow 300ms ease;
}
```

##### 5.3 JS 帧关联逻辑（方尖碑 JS 模块内）

```
帧索引 0-8 (Tile01-09) → --glow-opacity: 0.10~0.18, --glow-radius: 30~40px
帧索引 9-10 (Tile10-11) → --glow-opacity: 0.30~0.45, --glow-radius: 50~65px
```

每次帧切换时调用 `obeliskRedGlow.style.setProperty('--glow-opacity', ...)` 和 `setProperty('--glow-radius', ...)`

#### 验收标准

- [ ] Tile10/11 帧时红光明显增强（亮度+范围），Tile01-09 帧时内敛低亮
- [ ] `radial-gradient` 从碑体中心向外扩散，不饱和、不刺眼
- [ ] CSS transition 使亮度切换平滑（300ms ease）
- [ ] 红色光效色值 `rgba(180,30,20,...)`, 饱和度 60-70%

---

### T-6 · 仪式光环 + 金尘粒子系统

| 属性 | 值 |
|------|-----|
| **依赖** | T-1（纯黑底就绪）、T-2（方尖碑定位参考） |
| **涉及文件** | `frontend/index.html`、`frontend/css/main.css`、（金尘 JS 可并入方尖碑模块） |
| **预估难度** | ⭐⭐⭐ 中 |
| **分类** | 前端 |
| 🅲 | 与 T-4 / T-5 并行 |

#### 操作清单

##### 6.1 HTML（`index.html`）

在 `.copy-select-stage` 内、`#obelisk` 之后插入：

```html
<div id="ritualRings" class="ritual-rings">
  <div class="ritual-ring ritual-ring-inner"></div>
  <div class="ritual-ring ritual-ring-outer"></div>
</div>
<canvas id="goldParticleCanvas"></canvas>
```

##### 6.2 CSS 仪式光环（`main.css`，标注 `/* === ADR-005: 仪式光环 === */`）

| 选择器 | 关键属性 |
|--------|---------|
| `.ritual-rings` | `position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); z-index:0.5; pointer-events:none;` |
| `.ritual-ring` | `position:absolute; border-radius:50%; border:1.5px solid rgba(180,140,60,0.5); box-shadow:0 0 20px rgba(180,140,60,0.3); transform:rotateX(75deg);` |
| `.ritual-ring-inner` | `width:24vw; height:24vw; animation:ringRotateInner 10s linear infinite;` |
| `.ritual-ring-outer` | `width:38vw; height:38vw; animation:ringRotateOuter 12s linear infinite reverse;` |
| `@keyframes ringRotateInner` | `0% { transform: rotateX(75deg) rotateZ(0deg); } 100% { transform: rotateX(75deg) rotateZ(360deg); }` |
| `@keyframes ringRotateOuter` | `0% { transform: rotateX(75deg) rotateZ(0deg); } 100% { transform: rotateX(75deg) rotateZ(-360deg); }` |

##### 6.3 CSS 金尘 Canvas（`main.css`）

```css
#goldParticleCanvas {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  z-index: 1.5; pointer-events: none;
}
```

##### 6.4 JS 金尘粒子引擎（并入方尖碑 JS 模块或独立）

- Canvas 尺寸 = `.copy-select-stage` 尺寸（跟随 resize）
- 粒子数 30（默认，20-50 范围）
- 颜色 `rgba(200,160,80, 0.4~0.8)`
- 半径 1-3px，`ctx.shadowBlur = 6`
- 运动：布朗运动 + 微弱上升（`vy -= 0.02~0.05`）+ 边界回弹
- `requestAnimationFrame` 驱动
- 暴露 `window.GoldParticles = { start(), stop(), resize() }`

#### 验收标准

- [ ] 方尖碑底部可见 2 层同心暗金椭圆环，缓慢旋转（内环 ~10s，外环 ~12s 反向）
- [ ] 环体 `rotateX(75deg)` 模拟地面透视
- [ ] Canvas 内有 20-50 个金尘粒子漂浮，缓慢上升+布朗运动
- [ ] 粒子带柔和辉光，不刺眼
- [ ] 金尘 Canvas `pointer-events: none` 不影响交互

---

### T-7 · 收尾清理（删除旧金束 + 移除 goldBeams.css 引用 + client.js 适配）

| 属性 | 值 |
|------|-----|
| **依赖** | T-1、T-2、T-3、T-4、T-5、T-6（所有功能就绪后清理旧代码） |
| **涉及文件** | `frontend/index.html`、`frontend/css/main.css`、`frontend/js/client.js` |
| **预估难度** | ⭐⭐ 中低 |
| **分类** | 前端 |

#### 操作清单

##### 7.1 `index.html`

- **删除** `<link rel="stylesheet" href="css/goldBeams.css">`（第 9 行）
- **删除** `#copyGoldBeams` 整个 DOM 块及其子元素（第 157-167 行附近）
- **更新注释**：`#pageCopySelect` 上方注释改为「副本选择页面（纯黑背景 + 方尖碑 + 视口金框）」

##### 7.2 `client.js` — `showPage()` 函数（约 L78-98）

- 删除金束控制代码：
  - `const beams = document.getElementById('copyGoldBeams');` (×3)
  - `if (beams) beams.classList.add('active');`
  - `if (beams) beams.classList.remove('active');` (×2)
- 新增方尖碑生命周期管理：
  ```js
  if (page === pageCopySelect) {
    // ... IsometricBg 启动之后
    if (window.Obelisk?.start) window.Obelisk.start();
    if (window.GoldParticles?.start) window.GoldParticles.start();
  } else {
    if (window.Obelisk?.stop) window.Obelisk.stop();
    if (window.GoldParticles?.stop) window.GoldParticles.stop();
  }
  ```

##### 7.3 `main.css`

- 删除 `#copyGoldBeams` 相关样式（如有内联在 main.css 中）
- 新增页面初始化逻辑：`.page#pageCopySelect` 非 active 时 `#obelisk` / `#goldParticleCanvas` / `.ritual-rings` / `#viewportGoldFrame` 均隐藏

##### 7.4 `roomHall.js`

- 检查 `getAnomalyBounds()` 返回值是否影响 `positionCopyCardsRing()` 中的椭圆半径计算，必要时微调 `radiusX`/`radiusY` 偏移量
- 确认副本卡片 3 个按钮位置/文字/跳转完全不变

#### 验收标准

- [ ] `goldBeams.css` 不再被任何页面加载
- [ ] `#copyGoldBeams` DOM 元素完全移除
- [ ] 控制台无 `getElementById('copyGoldBeams')` 相关报错
- [ ] 页面切换到 `#pageCopySelect` 时：黑色背景 + 方尖碑动画 + 视口金框 + 金尘 + 光环 全部正常启动
- [ ] 离开 `#pageCopySelect` 时：所有动画正确停止
- [ ] 三个副本卡片位置/文字/跳转与原版完全一致
- [ ] `roomHall.js` 卡片环形布局正常

---

## 八、实现顺序建议

```
第1天:  T-1 (背景清理) ──→ T-2 (方尖碑DOM) + T-3 (视口金框) 并行
第2天:  T-4 (碑体质感) + T-5 (红色流光) + T-6 (光环+金尘) 并行推进
第3天:  T-7 (收尾清理) → 全链路联调 → Review
```

## 九、风险与回滚策略

| 风险 | 缓解措施 |
|------|---------|
| T-2 `clip-path` 裁剪不精确 | 提供 3 组 polygon 坐标备选（尖碑/方碑/梯形），可快速切换 |
| T-2 序列帧 crossfade 闪烁 | 备选方案：降为直接切换（无过渡），保证最低可用性 |
| T-7 清理后金束丢失回滚路径 | T-1~T-6 期间保留 `#copyGoldBeams` 和 `goldBeams.css`，仅在 T-7 最后删除 |
| 移动端 `filter:blur()` 性能 | 媒体查询 `(max-width:768px)` 降级为 `filter: none` |
