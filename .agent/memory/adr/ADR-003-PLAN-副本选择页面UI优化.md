# ADR-003-PLAN：副本选择页面 UI 优化方案

| 属性 | 值 |
|------|-----|
| ADR ID | ADR-003-PLAN |
| 状态 | `PLANNING` |
| 依赖 ADR | ADR-001（已完成需求澄清，本次为新特性） |
| 创建日期 | 2026-08-06 |
| 预估总工时 | 约 8-12 小时（5 任务） |
| 设计基调 | 暗金克苏鲁 — 与登录扉页 `loginLoadingAnim.css` 风格统一 |

---

## 需求映射总览

| # | 用户需求 | 对应任务 | 要点 |
|---|---------|---------|------|
| 1 | 卡片环绕方尖碑 | T-2 | 圆形/椭圆环布局，JS 动态计算位置 |
| 2 | 加速方尖碑动图 | T-1 | CYCLE_DURATION 10.5s→3.5s，整体节奏提速 |
| 3 | 红色流光 | T-1 | 流动光效替代简单 sin 呼吸 |
| 4 | 移除下方背景图 | T-1 | 方尖碑区域圆形遮罩消除地面瓦片 |
| 5 | 金色流光 | T-3 | 四角光束 + 对角斜光束 + 光环 + 卡片金边 sweep |
| 6 | 飞页效果 | T-4 | 副本启动→游戏页的羊皮纸封合过渡 |
| 7 | 整体一致性 | T-5 | 配色/动画参数审计 + 响应式适配 |

---

## 依赖拓扑图

<table style="border-collapse:collapse; font-size:13px; font-family:Consolas,monospace; line-height:1.6; width:100%;">
  <tr style="background:#1a1714;">
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">任务</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">硬依赖</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">软依赖</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">可并行组</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">类别</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">难度</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-1 isometricBg 引擎升级</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">无</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#5b8cbd;">A 组</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">前端 Canvas</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">⭐⭐⭐</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-2 环形卡片布局系统</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">无</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#ffa726;">T-1（方尖碑坐标约定）</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#5b8cbd;">A 组</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">前端 CSS+JS</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">⭐⭐⭐</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-3 金色流光效果层</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">无</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#ffa726;">T-2（卡片位置参考）</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#5b8cbd;">B 组</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">前端 CSS+JS</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">⭐⭐</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-4 飞页过渡动画</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#b84444;">T-1, T-2, T-3</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">前端 CSS+JS</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">⭐⭐⭐⭐</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-5 整体风格统一与收尾</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#b84444;">T-1, T-2, T-3, T-4</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">前端 CSS</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">⭐</td>
  </tr>
</table>

**并行策略**：A 组（T-1 + T-2）先行 → B 组（T-3）可与 A 组末尾重叠 → T-4（汇聚点）→ T-5（收尾）

---

## T-1：isometricBg 引擎升级（加速 + 红流 + 去地面）

| 属性 | 值 |
|------|-----|
| ID | T-1 |
| 优先级 | P0（高 — 基础设施） |
| 类别 | 前端 Canvas 2D |
| 预估代码量 | ~80 行修改 / ~30 行新增 |
| 依赖 | 无 |
| 涉及文件 | `frontend/js/isometricBg.js` |

### 子任务拆解

#### 1.1 加速循环周期

当前时序常量及其关系：
```
CYCLE_DURATION = 10500ms
  = 5 phases × PHASE_DURATION(2000ms)
  = 5 phases × (STATIC_DURATION(1500ms) + FADE_DURATION(500ms))
```

**修改方案**：将 `CYCLE_DURATION` 从 10500ms 缩减至 **3500ms**（3 倍加速），等比缩放内部常量：

| 常量 | 旧值 | 新值 | 说明 |
|------|------|------|------|
| `CYCLE_DURATION` | 10500 | 3500 | 完整循环 |
| `PHASE_DURATION` | 2000 | 700 | 每 phase |
| `STATIC_DURATION` | 1500 | 500 | 静态停留 |
| `FADE_DURATION` | 500 | 200 | 交叉淡入淡出 |

> 比例保持：`PHASE_DURATION = STATIC_DURATION + FADE_DURATION`，`CYCLE_DURATION = 5 × PHASE_DURATION`

同时加快雾气漂移速度（`drawMist` 中 `now * 0.015` → `now * 0.04`）和地面偏移速度（`0.004` → `0.012`，`0.0025` → `0.0075`），使整体节奏一致。

#### 1.2 红色流光替代简单呼吸

**当前实现**（`drawAnomalyTile`，约 L258-264）：
- 仅在 `idx === 8 || idx === 10`（Tile09/Tile11）时叠加 `rgba(180,40,30, breath)` 半透明矩形
- `breath = 0.2 + sin(t * 0.0008) * 0.3`，是均匀的呼吸式明暗变化

**目标效果**：流动的红色光效，沿方尖碑表面自下而上或自中心向外扩散。

**实现思路**：

1. **多层径向渐变叠加**：在异象瓦片上方绘制 2-3 层 `createRadialGradient`，每层有不同的相位偏移：
   - 内层：`rgba(200, 30, 20, α)` 从中心向外扩散，α 由 `sin(t * speed1 + phase1)` 驱动
   - 外层：`rgba(140, 20, 40, α)` 更大范围，不同频率
   - 边缘辉光：`rgba(220, 60, 30, α)` 沿瓦片边缘的 box-shadow 式发光

2. **垂直扫掠光带**：用 `createLinearGradient` 生成一条水平暗红光带，从上往下周期移动：
   ```js
   const sweepY = (timestamp * 0.08) % (ah * 1.5) - ah * 0.25;
   const sweepGrad = ctx.createLinearGradient(0, sweepY - 20, 0, sweepY + 20);
   sweepGrad.addColorStop(0, 'rgba(200,40,30,0)');
   sweepGrad.addColorStop(0.5, 'rgba(220,60,30,0.35)');
   sweepGrad.addColorStop(1, 'rgba(200,40,30,0)');
   ```
   用 `ctx.globalCompositeOperation = 'color-dodge'` 叠加在瓦片上。

3. **粒子光点**（可选进阶）：在方尖碑区域内散布 8-12 个微小光点，以随机轨道飘浮。

> 仅在 `idx === 8 || idx === 10`（Tile09 和 Tile11）时激活红色流光，其他异象瓦片保持原样。

#### 1.3 移除方尖碑下方地面瓦片层

**当前行为**：`drawGroundLayer` 用菱形网格铺满整个画布，包括方尖碑正下方区域。

**修改方案**：在 `drawGroundLayer` 绘制完成后、返回前，叠加一个**径向透明遮罩**：

```js
// 在 ctx.restore() 之前
const maskCx = canvasW / 2;
const maskCy = verticalBase + verticalRange / 2; // 与异象中心对齐
const maskRadius = anomalyW * 0.7; // 略小于方尖碑尺寸

const maskGrad = ctx.createRadialGradient(maskCx, maskCy, maskRadius * 0.6, maskCx, maskCy, maskRadius);
maskGrad.addColorStop(0, 'rgba(0,0,0,1)');     // 中心完全不透明（遮盖地面）
maskGrad.addColorStop(0.7, 'rgba(0,0,0,0.8)');
maskGrad.addColorStop(1, 'rgba(0,0,0,0)');     // 边缘完全透明
ctx.fillStyle = maskGrad;
ctx.fillRect(maskCx - maskRadius, maskCy - maskRadius, maskRadius * 2, maskRadius * 2);
```

> 注意：遮罩使用 `destination-out` 合成模式会清除像素，但可能影响后续图层。更安全的方式是先用离屏 Canvas 渲染地面层，再用遮罩合成。建议用上述径向渐变覆盖（与背景色 `#0a0908` 混合）作为简化方案。

### 接口变更

- 新增 `window.IsometricBg.getAnomalyBounds()` → `{ cx, cy, width, height }`，供 T-2 环形布局使用。
- 新增 `window.IsometricBg.setCycleSpeed(multiplier)`，方便后续微调。

---

## T-2：环形卡片布局系统

| 属性 | 值 |
|------|-----|
| ID | T-2 |
| 优先级 | P0（高 — 核心交互） |
| 类别 | 前端 CSS + JS |
| 预估代码量 | ~50 行 CSS 修改 / ~60 行 JS 新增 |
| 软依赖 | T-1（需 `getAnomalyBounds()` 坐标约定） |
| 涉及文件 | `frontend/css/main.css`, `frontend/js/roomHall.js` |

### 子任务拆解

#### 2.1 CSS 改造：从 Flex 网格到绝对定位环

**修改 `.copy-cards-ring`**：
```css
.copy-cards-ring {
  position: absolute;
  /* 不再使用 flex-wrap; 子元素由 JS 绝对定位 */
  pointer-events: none; /* 容器不拦截点击 */
}
```

**修改 `.copy-ring-card`**：
```css
.copy-ring-card {
  position: absolute;
  /* left/top 由 JS 动态设置 */
  width: 200px;        /* 从220px略缩，适配环形 */
  transform-origin: center center;
  transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
  pointer-events: auto; /* 卡片自身可点击 */
  animation: cardFloatIn 0.6s ease-out both;
}
/* 入场动画 */
@keyframes cardFloatIn {
  from { opacity: 0; transform: translateY(20px) scale(0.85); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
```

#### 2.2 JS 环形定位算法

在 `renderCopyCards()` 中，卡片创建后调用 `positionCopyCardsRing()`：

**核心逻辑**：
1. 从 `IsometricBg.getAnomalyBounds()` 获取方尖碑中心 `(anomalyCx, anomalyCy)` 和尺寸
2. 计算环形参数：
   - 椭圆半长轴 `radiusX = anomalyWidth * 0.9 + 120`（比方尖碑大一圈）
   - 椭圆半短轴 `radiusY = anomalyWidth * 0.7 + 100`（垂直方向略扁）
   - 总卡片数 N（3-7 张动态）
3. 每张卡片的角度 `θ = i * (2π / N) - π/2`（从顶部开始）
4. 卡片中心位置：
   ```
   left = anomalyCx + radiusX * cos(θ) - cardWidth/2
   top  = anomalyCy + radiusY * sin(θ) - cardHeight/2
   ```
5. 卡片 z-index 按 sin(θ) 排序（前面的卡片在上层，营造环绕纵深感）
6. 每张卡片设置 `animation-delay: i * 0.08s` 实现交错入场

**边界情况**：
- 仅 1-2 张卡片（新手只有初级副本）时，使用较紧凑的排列
- 卡片不超出视口：`left` 限制在 `[20, canvasW - cardWidth - 20]`，`top` 限制在 `[headerHeight + 20, canvasH - cardHeight - 20]`
- 窗口 resize 时重新计算位置

#### 2.3 与现有渲染逻辑集成

`roomHall.js` 的 `renderCopyCards()` 当前用 `appendChild` 将卡片加入 `copyCardsRing`。改造后：
- 保持卡片 DOM 创建逻辑不变
- 在 `appendChild` 循环后调用 `positionCopyCardsRing()`
- `positionCopyCardsRing()` 读取 Canvas 尺寸和方尖碑坐标，为每张卡设置 `style.left` / `style.top`
- 监听 `window.resize` 重新计算（带 debounce 100ms）

---

## T-3：金色流光效果层

| 属性 | 值 |
|------|-----|
| ID | T-3 |
| 优先级 | P1（中 — 氛围增强） |
| 类别 | 前端 CSS + JS |
| 预估代码量 | ~120 行 CSS / ~50 行 JS |
| 软依赖 | T-2（卡片 DOM 就位后挂载流光） |
| 涉及文件 | `frontend/css/main.css`（或新建 `frontend/css/copySelectGold.css`）, `frontend/js/roomHall.js` |

### 子任务拆解

#### 3.1 四角 + 对角暗金光束

**复用登录页方案**（`loginLoadingAnim.css` 中 `.gold-beams` 系统），在副本选择页叠加层中创建相同结构：

在 `#pageCopySelect` 内、`.copy-select-overlay` 之上插入一个新的光束容器：

```html
<div id="copyGoldBeams" class="gold-beams active">
  <div class="gold-beam tl"></div>
  <div class="gold-beam tr"></div>
  <div class="gold-beam bl"></div>
  <div class="gold-beam br"></div>
  <div class="gold-beam-diag d1"></div>
  <div class="gold-beam-diag d2"></div>
  <div class="gold-beam-diag d3"></div>
  <div class="gold-beam-diag d4"></div>
</div>
```

- 直接复用 `loginLoadingAnim.css` 的 `@keyframes beamSlideTL/TR/BL/BR` 和 `beamSlideDiag`
- 但要将 `position: fixed` 改为 `position: absolute`（相对于 `#pageCopySelect`）
- 引入方式：在 `index.html` 的 `<head>` 中链接 `loginLoadingAnim.css`（当前未引入 index.html），或将光束动画提取到一个共享 CSS 文件

**方案选择**：建议将光束相关 CSS 提取到新的 `frontend/css/goldBeams.css`，`login.html` 和 `index.html` 均引用，避免重复。

#### 3.2 中心旋转光环

在方尖碑区域叠加一个与登录页相同的 `.gold-ring` 效果：
- 位置跟随 `anomalyCx, anomalyCy`
- 尺寸比方尖碑稍大（`anomalyWidth * 1.2`）
- 使用 `ringExpand` 关键帧动画（1.8s 循环）

#### 3.3 卡片暗金边框 sweep

为每张 `.copy-ring-card` 添加 `::before` 伪元素的 sweep 动画（类似登录按钮的 `btnGoldSweep`）：

```css
.copy-ring-card::after {
  content: '';
  position: absolute; inset: -1px;
  border-radius: 10px;
  background: linear-gradient(120deg,
    transparent 30%,
    rgba(212,168,67,0.25) 45%,
    rgba(212,168,67,0.5) 50%,
    rgba(212,168,67,0.25) 55%,
    transparent 70%
  );
  background-size: 200% 100%;
  animation: cardGoldSweep 3s ease-in-out infinite;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}
.copy-ring-card:hover::after { opacity: 1; }

@keyframes cardGoldSweep {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

> 为避免与现有 `::before`（径向渐变悬浮光）冲突，sweep 放在 `::after`。

#### 3.4 粒子飘浮（可选进阶）

在 Canvas 层面，于方尖碑周围生成 15-20 个暗金微光粒子（类似登录页的粒子系统但色系统一为暗金）。粒子以方尖碑为中心做椭圆轨道运动，带微弱拖尾。

> 此子任务标记为可选，如工时紧张可延后至 T-5 整体收尾时补充。

---

## T-4：飞页过渡动画（副本选择 → 游戏）

| 属性 | 值 |
|------|-----|
| ID | T-4 |
| 优先级 | P0（高 — 核心体验） |
| 类别 | 前端 CSS + JS |
| 预估代码量 | ~80 行 CSS / ~60 行 JS |
| 硬依赖 | T-1, T-2, T-3 |
| 涉及文件 | 新建 `frontend/js/copySelectTransition.js`, `frontend/css/main.css`, `frontend/js/roomHall.js`, `frontend/index.html` |

### 子任务拆解

#### 4.1 过渡流程设计

```
用户点击"启动副本" (房主)
  │
  ├─ 1. 副本选择页开始淡出（header + 卡片 opacity 过渡）
  ├─ 2. Canvas 背景保持（方尖碑最后一帧定格）
  ├─ 3. 羊皮纸飞页封合动画（左页/右页从两侧翻入覆盖画面）
  ├─ 4. 书脊暗金线脉冲闪烁
  ├─ 5. 全屏暗金遮罩淡出
  └─ 6. 切换至 #pageGame，游戏界面淡入
```

总时长控制在 **1.2-1.5s**（不可过长，避免玩家等待焦虑）。

#### 4.2 HTML 结构注入

在 `#pageCopySelect` 内、Canvas 之上插入飞页容器（默认隐藏）：

```html
<div id="copyParchmentOverlay" class="parchment-overlay hidden">
  <div class="parchment-stage">
    <div class="parchment-left"></div>
    <div class="parchment-right"></div>
    <div class="parchment-spine"></div>
  </div>
</div>
```

#### 4.3 CSS 动画定义

**打开动画**（`parchmentLeftOpen` / `parchmentRightOpen`）：与登录页刚好相反——两页从中间向外翻开，最后消失。

```css
/* 阶段1：翻开 */
.parchment-overlay.opening .parchment-left {
  animation: parchmentLeftOpen 0.4s ease-in forwards;
}
.parchment-overlay.opening .parchment-right {
  animation: parchmentRightOpen 0.4s ease-in forwards;
}
@keyframes parchmentLeftOpen {
  0%   { transform: rotateY(-90deg); opacity: 0; }
  100% { transform: rotateY(0deg); opacity: 1; }
}
@keyframes parchmentRightOpen {
  0%   { transform: rotateY(90deg); opacity: 0; }
  100% { transform: rotateY(0deg); opacity: 1; }
}

/* 阶段2：封合 */
.parchment-overlay.closing .parchment-left {
  animation: parchmentLeftSeal 0.45s ease-in forwards;
}
.parchment-overlay.closing .parchment-right {
  animation: parchmentRightSeal 0.45s ease-in forwards;
}
/* 复用登录页的 parchmentLeftSeal/RightSeal + spineFlash keyframes */

/* 阶段3：遮罩淡出 */
.parchment-overlay.fading {
  animation: overlayFadeOut 0.5s ease-in forwards;
}
```

#### 4.4 JS 过渡控制器

新建 `frontend/js/copySelectTransition.js`：

```js
window.CopySelectTransition = {
  /**
   * 播放"进入寂静之地"飞页过渡
   * @param {function} onComplete - 过渡完成后回调（切换到游戏页）
   */
  playEnterAnimation(onComplete) {
    const overlay = document.getElementById('copyParchmentOverlay');
    // 1. 显示飞页 → 播放打开动画
    // 2. 0.5s 后 → 播放封合动画
    // 3. 0.45s 后 → 书脊闪光 → 遮罩淡出
    // 4. 0.5s 后 → onComplete()
  },

  /** 中止动画（异常情况） */
  abort() { /* 清理 DOM 状态 */ }
};
```

#### 4.5 与 roomHall.js 集成

在 `roomHall.js` 的 `copyStart` socket 事件处理中：

```js
_on('copyStart', ({ copyName }) => {
  if (!_active && !currentRoomId) return;

  // ★ 播放飞页过渡
  if (window.CopySelectTransition) {
    window.CopySelectTransition.playEnterAnimation(() => {
      switchPage('pageGame');
      const publicLog = document.getElementById('publicLog');
      if (publicLog && typeof window.appendLog === 'function') {
        window.appendLog(publicLog, '副本【' + copyName + '】已开启', 'KP');
      }
    });
  } else {
    // 降级：直接切换
    switchPage('pageGame');
    // ...
  }
});
```

---

## T-5：整体风格统一与收尾

| 属性 | 值 |
|------|-----|
| ID | T-5 |
| 优先级 | P1（中 — 品质保证） |
| 类别 | 前端 CSS |
| 预估代码量 | ~30 行修改 |
| 硬依赖 | T-1, T-2, T-3, T-4 |
| 涉及文件 | `frontend/css/main.css`, `frontend/js/roomHall.js` |

### 子任务拆解

#### 5.1 配色审计

对照登录扉页的暗金色板，统一副本选择页所有新增元素的颜色：

| 用途 | 应使用的变量/色值 |
|------|-------------------|
| 主金色 | `var(--gold)` = `#d4a843` |
| 暗金（光束） | `#a08040` |
| 中间金（sweep 高光） | `#c8a860` |
| 金色发光阴影 | `rgba(212,168,67, 0.2~0.5)` |
| 暗色背景 | `var(--bg)` = `#0a0908` |
| 面板背景 | `var(--panel-bg)` = `#141210` |

检查项：
- 卡片边框 `border-color`、`box-shadow` 是否使用金色
- 标题 `text-shadow` 色值是否正确
- 红色流光 `rgba(200,40,30,*)` 不得偏离克苏鲁暗红氛围
- 光束动画参数是否与登录页一致

#### 5.2 响应式适配

- 环形卡片在小屏（<768px）时，自动切换为垂直列表布局（降级方案），避免卡片重叠
- Canvas 等距背景在高 DPI 屏幕上的缩放质量检查
- 飞页过渡在移动端的动画性能（必要时降低光束数量）

#### 5.3 交互细节

- 卡片 hover 时除边框发光外，增加微弱的 `scale(1.03)` + `translateY(-2px)`
- 被选中（已通关）的副本卡片显示金色勾号标记
- 锁定（未解锁）的副本卡片显示暗色蒙版 + 锁图标
- `btnBackToCharFromCopySelect` 按钮 hover 增加金色边框过渡

#### 5.4 性能检查

- `requestAnimationFrame` 中无内存泄漏（`drawAnomalyTile` 渐变对象是否频繁创建——可用缓存）
- Canvas `getAnomalyBounds()` 调用频率（仅 resize 时重新计算，不每帧调用）
- CSS `will-change` 属性在动画元素上的合理使用（`transform`, `opacity`）

---

## 涉及文件总清单

| 文件 | 操作 | 关联任务 |
|------|------|---------|
| `frontend/js/isometricBg.js` | 修改 | T-1 |
| `frontend/css/main.css` | 修改 | T-2, T-3, T-4, T-5 |
| `frontend/js/roomHall.js` | 修改 | T-2, T-4 |
| `frontend/index.html` | 修改（新增 DOM 元素） | T-3, T-4 |
| `frontend/css/goldBeams.css` | **新建**（从 loginLoadingAnim.css 提取光束动画） | T-3 |
| `frontend/js/copySelectTransition.js` | **新建** | T-4 |
| `frontend/auth/loginLoadingAnim.css` | 修改（提取共享部分） | T-3 |
| `frontend/auth/login.html` | 修改（改用共享 goldBeams.css） | T-3 |

---

## 风险与注意事项

1. **Canvas 遮罩与合成模式兼容性**：`globalCompositeOperation` 在不同浏览器表现可能略有差异。T-1 中地面遮罩优先使用径向渐变覆盖而非 `destination-out`。
2. **环形布局在 3 张卡片以下时视觉效果稀疏**：需要设计紧凑排列的降级方案（如上半圆排列 + 更大间距）。
3. **金色光束 CSS 提取可能影响登录页**：需同步测试登录页动画是否正常。
4. **飞页过渡与 `showPage` 的页面切换时机冲突**：`showPage` 是同步切换（classList 操作），飞页过渡需要异步等待动画完成。建议在过渡期间锁定页面切换。
5. **瓦片加载失败容错**：已有 `onerror → resolve()` 容错，新逻辑需兼容瓦片为 null 的情况。

---

## 附录 A：时序速查表

### isometricBg 新时序

| 阶段 | 时长 | 说明 |
|------|------|------|
| 完整循环 | 3500ms | 5 phases |
| 单 phase | 700ms | STATIC + FADE |
| 静态停留 | 500ms | 瓦片完全可见 |
| 交叉淡入淡出 | 200ms | 两 phase 瓦片叠加 |

### 飞页过渡时序

| 阶段 | 时长 | 说明 |
|------|------|------|
| 页面淡出 | 200ms | 卡片 + header opacity → 0 |
| 飞页翻开 | 400ms | 羊皮纸从中间展开覆盖画面 |
| 飞页封合 | 450ms | 左右页向中间翻折 + 书脊闪光 |
| 遮罩淡出 | 500ms | 全屏暗金遮罩 → 透明 |
| **总时长** | **~1.3s** | 不含页面淡出（可与翻开重叠） |

---

## 附录 B：坐标约定（T-1 ↔ T-2 接口）

```js
// isometricBg.js 暴露
window.IsometricBg.getAnomalyBounds() → {
  cx: number,      // 方尖碑中心 X（画布坐标）
  cy: number,      // 方尖碑中心 Y（画布坐标）
  width: number,   // 方尖碑渲染宽度
  height: number,  // 方尖碑渲染高度
  radius: number   // 方尖碑外接圆半径 = max(width, height) / 2
}
```

环形卡片以此 `{ cx, cy }` 为圆心，`radius + cardMargin` 为半径排列。
