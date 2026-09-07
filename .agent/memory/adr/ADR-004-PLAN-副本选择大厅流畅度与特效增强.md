# ADR-004-PLAN：副本选择大厅流畅度与特效增强方案

| 属性 | 值 |
|------|-----|
| ADR ID | ADR-004-PLAN |
| 状态 | `PLANNING` |
| 依赖 ADR | ADR-003-PLAN（上一轮 UI 优化已完成 T-1~T-4） |
| 创建日期 | 2026-08-06 |
| 设计基调 | 暗金克苏鲁 — 与登录扉页 `loginLoadingAnim.css` 金色流光体系一致 |

---

## 需求映射总览

| # | 用户需求 | 对应任务 | 要点 |
|---|---------|---------|------|
| 1 | 方尖碑更流畅 | T-1 | 提升 requestAnimationFrame 稳定帧率、减少 phase 切换抖动、异象瓦片预渲染缓存 |
| 2 | 环绕方尖碑下半圈 | T-2 | 仅在下半圆弧（角度 0°→180°）排布卡片，椭圆贴合方尖碑底部 |
| 3 | 红色流光更大，辐射感 | T-3 | 多层同心径向脉冲、色阶从深红→猩红→亮橙辐射扩散、扩大半径 2.5× |
| 4 | 锯齿状红色光带 ×10+ | T-4 | 背景 Canvas 层绘制锯齿形光带，红光亮斑从左到右循环漂移 |
| 5 | 合页金色流光，大且奢华 | T-5 | 书籍合页过渡叠加四角金束+对角金线+金色粒子爆发+外环扩展，参照 `loginLoadingAnim.css` |

---

## 依赖拓扑图

<table style="border-collapse:collapse; font-size:13px; font-family:Consolas,monospace; line-height:1.6; width:100%;">
  <tr style="background:#1a1714;">
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">任务</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">硬依赖</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">软依赖</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">可并行组</td>
    <td style="padding:8px 14px; border:1px solid #3a352e; font-weight:600; color:#d4a843;">难度</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-1 方尖碑渲染流畅度</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">无</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#5b8cbd;">A 组</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">⭐⭐</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-2 下半圈卡片环绕</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">无</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#ffa726;">T-1（方尖碑坐标）</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#5b8cbd;">A 组</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">⭐⭐</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-3 红色流光辐射增强</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#b84444;">T-1</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#5b8cbd;">B 组</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">⭐⭐⭐</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-4 锯齿红色光带背景</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#b84444;">T-1</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#5b8cbd;">B 组</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">⭐⭐⭐</td>
  </tr>
  <tr>
    <td style="padding:6px 14px; border:1px solid #3a352e;">T-5 合页金色流光奢华化</td>
    <td style="padding:6px 14px; border:1px solid #3a352e; color:#b84444;">T-1, T-3, T-4</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">—</td>
    <td style="padding:6px 14px; border:1px solid #3a352e;">⭐⭐⭐⭐</td>
  </tr>
</table>

**并行策略**：A 组（T-1 + T-2）先行 → B 组（T-3 + T-4）跟进 → T-5（汇聚收尾）

---

## T-1：方尖碑渲染流畅度升级

| 属性 | 值 |
|------|-----|
| ID | T-1 |
| 优先级 | P0（高） |
| 涉及文件 | `frontend/js/isometricBg.js` |

### 问题诊断

当前 `drawAnomalyTile()` 每帧对 Tile09/Tile11 执行：
- 4 层径向渐变计算
- 1 层 color-dodge 叠加
- 8 个粒子光点的三角函数运算
- 每帧创建 5+ 个 `createRadialGradient` / `createLinearGradient` 对象

在部分低性能设备上导致抖动。

### 修改方案

#### 1.1 预计算渐变缓存

异象瓦片位置每次 phase 切换后才变化，不必每帧重建渐变。新增缓存对象：

```js
const _anomalyCache = { cx: 0, cy: 0, r: 0, ts: 0, dirty: true };
```

在瓦片坐标变化时标记 `dirty=true`，仅重建时分配新渐变对象；否则复用上次计算结果。

#### 1.2 粒子轨道预计算

8 个粒子的轨道参数（角速度、径向振幅、相位）在初始化时预计算一次存入数组，绘制时只做简单查表和乘法：

```js
const PARTICLE_COUNT = 8;
let _particles = null;
function _initParticles() {
  _particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    _particles.push({
      angleSpeed: 0.0006 + Math.random() * 0.0003,
      phase: i * Math.PI * 0.25,
      distBase: 0.65 + Math.random() * 0.15,
      distAmp: 0.15 + Math.random() * 0.1,
      distFreq: 0.002 + Math.random() * 0.001,
      alphaSpeed: 0.004 + Math.random() * 0.002,
      alphaPhase: i * 1.3,
    });
  }
}
```

#### 1.3 异象层离屏 Canvas 预渲染

对 Tile09/Tile11（红色流光瓦片），首次进入时渲染到离屏 Canvas，后续直接 `drawImage(offscreenCanvas)` 而非重复绘制所有叠加层。仅在 `dirty` 时重建离屏缓冲。

#### 1.4 requestAnimationFrame 时间步长稳定

当前 `draw(timestamp)` 取绝对 `timestamp`，在浏览器后台标签页切回时可能出现跳跃。增加时间钳制：

```js
function draw(timestamp) {
  if (!running) return;
  if (!startTime) startTime = timestamp;
  // 钳制 delta：防止标签页后台恢复时的大跳帧
  const rawElapsed = timestamp - startTime;
  const _lastElapsed = draw._lastElapsed ?? 0;
  const delta = Math.min(rawElapsed - _lastElapsed, 100); // 最大 100ms 步进
  draw._elapsedAcc += delta;
  draw._lastElapsed = rawElapsed;
  // ... 用 draw._elapsedAcc 替代 elapsed
}
```

#### 1.5 方尖碑动图帧率提示

瓦片 Image 对象的 `naturalWidth/naturalHeight` 已知为 256px（见代码 L42-45）。GIF 动图本身帧率无法通过 Canvas 控制；但减少 Canvas 重绘开销后，浏览器有更多资源解码 GIF 帧，间接提升观感。如有必要，可将 Tile09/Tile11 替换为精灵图并用 CSS steps() 驱动（后续迭代）。

---

## T-2：环形卡片下半圈环绕

| 属性 | 值 |
|------|-----|
| ID | T-2 |
| 优先级 | P0（高） |
| 涉及文件 | `frontend/js/roomHall.js`, `frontend/css/main.css` |

### 当前行为

`positionCopyCardsRing()` 中：
```js
const theta = (i * 2 * Math.PI / N) - Math.PI / 2; // 从顶部开始，360° 全环
```

6 张卡片均匀分布在整个椭圆上（顶部 + 底部 + 左右）。

### 目标行为

卡片仅分布在方尖碑**下方**（角度范围：0° 到 π，即右→下→左），在方尖碑底部呈弧形环绕。

### 修改方案

#### 2.1 角度映射

```js
// 仅下半圈（0° → 180°，即 sin(θ) ≥ 0 的下半部分）
// 0° = 右侧, 90° = 正下方, 180° = 左侧
const startAngle = 0;           // 弧度，右侧起点
const endAngle = Math.PI;       // 弧度，左侧终点
const arcRange = endAngle - startAngle;

cards.forEach((card, i) => {
  const t = N === 1 ? 0.5 : i / (N - 1);  // 0..1 均匀插值
  const theta = startAngle + t * arcRange; // 0 → π
  let left = anomalyCx + radiusX * Math.cos(theta) - cardW / 2;
  let top = anomalyCy - radiusY * Math.cos(theta) + radiusY * 1.1 - cardH / 2;
  // ...
});
```

> 关键调整：`anomalyCy` 是方尖碑中心。卡片在下方需要 `top = anomalyCy + offset`。重新推导：θ=0→右侧，θ=π/2→正下方，θ=π→左侧。则 `left = cx + rx*cos(θ)`, `top = cy + ry*sin(θ) + offset`。

#### 2.2 弧度与间距

方尖碑底部额外下移 0.15×radiusY，使卡片不与方尖碑底部重叠：

```js
const arcBottomOffset = radiusY * 0.15;
// top = anomalyCy + radiusY * Math.sin(theta) + arcBottomOffset - cardH/2
```

#### 2.3 CSS 微调

卡片 `animationDelay` 改为从中心向外（中间卡片先出现）：

```js
const distFromCenter = Math.abs(t - 0.5); // 0→0.5→0
card.style.animationDelay = (distFromCenter * 0.4) + 's';
```

---

## T-3：红色流光辐射增强

| 属性 | 值 |
|------|-----|
| ID | T-3 |
| 优先级 | P0（高） |
| 涉及文件 | `frontend/js/isometricBg.js` |

### 当前行为

`drawAnomalyTile()` 中 4 层红色光效半径最大 `r * 0.9`（r ≈ 瓦片宽度的一半），偏内敛。

### 目标效果

红色流光像**从方尖碑中心向外辐射**，范围扩大到方尖碑面积的 2.5 倍，层次分明，有明显光束放射感。

### 修改方案

#### 3.1 扩大辐射半径 + 多层色阶

```
内层（核心白热）：r × 0.0 → r × 0.3   颜色：rgba(255,80,20,0.7)→rgba(220,30,10,0)
中层（猩红辐射）：r × 0.15 → r × 0.9  颜色：rgba(200,20,10,0.5)→rgba(140,10,20,0)
外层（暗红余晖）：r × 0.5 → r × 2.0   颜色：rgba(120,10,20,0.3)→rgba(0,0,0,0)
远端光晕：        r × 1.5 → r × 2.8   颜色：rgba(60,5,10,0.12)→rgba(0,0,0,0)
```

共 4 层同心径向脉冲，每层独立相位和频率。

#### 3.2 放射状光线（Ray Beams）

在径向渐变之上叠加 12 条从中心射出的楔形光线：

```js
const rayCount = 12;
for (let i = 0; i < rayCount; i++) {
  const rayAngle = (timestamp * 0.0004 + i * Math.PI * 2 / rayCount) % (Math.PI * 2);
  const rayAlpha = 0.08 + Math.sin(timestamp * 0.003 + i) * 0.05;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rayAngle);
  const rayGrad = ctx.createLinearGradient(0, 0, r * 2.2, 0);
  rayGrad.addColorStop(0, `rgba(240,60,20,${rayAlpha + 0.1})`);
  rayGrad.addColorStop(0.3, `rgba(200,30,15,${rayAlpha})`);
  rayGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rayGrad;
  ctx.fillRect(0, -3, r * 2.2, 6);
  ctx.restore();
}
```

#### 3.3 垂直扫掠光带加宽

当前扫掠带宽 `h * 0.15`，扩大到 `h * 0.3`，并叠加 2 条不同相位的扫掠带。

---

## T-4：锯齿状红色光带背景

| 属性 | 值 |
|------|-----|
| ID | T-4 |
| 优先级 | P0（高） |
| 涉及文件 | `frontend/js/isometricBg.js`（新增绘制函数） |

### 设计描述

在副本大厅背景中绘制**至少 10 条**从左到右的锯齿形红色光带（zigzag），每条光带上有从左向右循环移动的红色亮斑。

光带位于地面层和异象层之间（Z=-300），水平横跨画布，垂直间距均匀分布。

### 实现方案

#### 4.1 锯齿路径生成

```js
function drawRedZigzagBands(timestamp) {
  const bandCount = 12;          // 12 条光带
  const bandSpacing = canvasH / (bandCount + 1);
  const zigzagAmplitude = 18;   // 锯齿振幅（像素）
  const zigzagPeriod = 80;      // 锯齿周期（像素）

  ctx.save();
  ctx.globalAlpha = 0.25;

  for (let b = 0; b < bandCount; b++) {
    const baseY = bandSpacing * (b + 1);
    const phaseOffset = b * 0.3; // 每条光带不同相位

    ctx.beginPath();
    ctx.moveTo(0, baseY);

    // 锯齿路径：从左到右
    for (let x = 0; x <= canvasW; x += zigzagPeriod * 0.5) {
      const dir = (Math.floor(x / (zigzagPeriod * 0.5)) % 2 === 0) ? 1 : -1;
      const y = baseY + dir * zigzagAmplitude;
      ctx.lineTo(x, y);
    }

    // 光带样式：暗红底色 + 移动亮斑
    const bandGrad = ctx.createLinearGradient(0, baseY - 6, 0, baseY + 6);
    bandGrad.addColorStop(0, 'rgba(80,15,15,0)');
    bandGrad.addColorStop(0.5, 'rgba(160,25,20,0.4)');
    bandGrad.addColorStop(1, 'rgba(80,15,15,0)');
    ctx.strokeStyle = bandGrad;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}
```

#### 4.2 移动亮斑

在每条锯齿光带上叠加从左到右循环移动的发光亮点：

```js
function drawRedBandGlints(timestamp) {
  const bandCount = 12;
  const bandSpacing = canvasH / (bandCount + 1);
  const glintSpeed = 0.06; // 像素/ms

  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; // 叠加发光

  for (let b = 0; b < bandCount; b++) {
    const baseY = bandSpacing * (b + 1);
    // 每个亮斑位置沿锯齿移动
    const glintX = ((timestamp * glintSpeed + b * 200) % (canvasW + 300)) - 150;

    // 在该位置绘制径向发光点
    const glintGrad = ctx.createRadialGradient(glintX, baseY, 0, glintX, baseY, 40);
    glintGrad.addColorStop(0, 'rgba(255,80,40,0.7)');
    glintGrad.addColorStop(0.3, 'rgba(220,40,20,0.3)');
    glintGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glintGrad;
    ctx.fillRect(glintX - 40, baseY - 40, 80, 80);

    // 第二亮斑（延迟 1/3 画布宽度）
    const glintX2 = ((glintX + canvasW * 0.33) % (canvasW + 300)) - 150;
    const glintGrad2 = ctx.createRadialGradient(glintX2, baseY, 0, glintX2, baseY, 30);
    glintGrad2.addColorStop(0, 'rgba(255,60,30,0.4)');
    glintGrad2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glintGrad2;
    ctx.fillRect(glintX2 - 30, baseY - 30, 60, 60);
  }

  ctx.restore();
}
```

#### 4.3 渲染层级插入

在 `draw()` 主循环中，地面层之后、异象层之前调用：

```js
// ---- 第2.5层：红色锯齿光带 Z=-300 ----
drawRedZigzagBands(timestamp);
drawRedBandGlints(timestamp);
```

> 注意：锯齿光带应置于 `drawGroundLayer` 的 `ctx.restore()` 之后，`drawAnomalyLayer` 之前。

---

## T-5：书籍合页金色流光奢华化

| 属性 | 值 |
|------|-----|
| ID | T-5 |
| 优先级 | P0（高） |
| 涉及文件 | `frontend/css/main.css`, `frontend/js/roomHall.js`（触发逻辑） |

### 当前行为

`parchment-transition-overlay` 有左右书页、书脊线、四角光束容器 `.parchment-transition-beams`。但 CSS 中该容器仅有占位样式，**未注入金色光束动画**（与 `loginLoadingAnim.css` 中的 `.gold-beams` 体系脱节）。

### 目标效果

书籍合页（close/seal）时，爆发与登录扉页完全一致的奢华金色流光：
- 四角金色光束向中心扫掠
- 对角斜向金线交错
- 中心金色光环扩展
- 金色粒子爆散

### 修改方案

#### 5.1 CSS：复用 loginLoadingAnim 的金色流光体系

在 `main.css` 的 `parchment-transition-beams` 区域补充完整流光动画：

```css
/* 四角光束（参照登录扉页 .gold-beam 语法） */
.parchment-transition-beams .gold-beam {
  position: absolute;
  width: 2px;
  background: linear-gradient(90deg,
    transparent,
    rgba(180, 140, 60, 0.6) 30%,
    rgba(212, 168, 67, 0.9) 50%,
    rgba(180, 140, 60, 0.6) 70%,
    transparent
  );
  animation: parchBeamSlide 1.8s ease-in-out forwards;
  opacity: 0;
}
```

> 注意：合页是一次性动画（`forwards`），不循环（与登录循环加载不同）。

#### 5.2 金色粒子爆发

在 overlay 内新增粒子容器，合页瞬间从书脊位置爆散金色粒子：

```css
.parchment-gold-particles {
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 10000; pointer-events: none;
  display: none;
}
.parchment-gold-particles.active { display: block; }

.parchment-gold-particle {
  position: absolute;
  width: 4px; height: 4px;
  background: #d4a843;
  border-radius: 50%;
  box-shadow: 0 0 8px rgba(212,168,67,0.8), 0 0 16px rgba(255,200,80,0.5);
  animation: goldParticleBurst 1.2s ease-out forwards;
}
```

JS 动态创建 40-60 个粒子，从书脊中心向随机方向爆散。

#### 5.3 光环扩展

参照 `loginLoadingAnim.css` 的 `ringExpand`：

```css
.parchment-gold-ring {
  position: fixed;
  top: 50%; left: 50%;
  width: 0; height: 0;
  border: 2px solid rgba(212,168,67,0.8);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 9998;
  display: none;
  box-shadow: 0 0 30px rgba(212,168,67,0.5), inset 0 0 30px rgba(212,168,67,0.2);
}
.parchment-gold-ring.active {
  display: block;
  animation: parchRingExpand 1.5s ease-out forwards;
}
@keyframes parchRingExpand {
  0%   { width: 0; height: 0; opacity: 1; }
  100% { width: 1200px; height: 1200px; opacity: 0; }
}
```

#### 5.4 JS 触发逻辑

在 `roomHall.js` 的 `navigateToLobby` 或相应的副本进入流程中，船帆过渡 overlay 显示时：

```js
function triggerParchmentTransition(callback) {
  const overlay = document.getElementById('parchmentTransitionOverlay');
  const beams = overlay.querySelector('.parchment-transition-beams');
  const ring = document.getElementById('parchmentGoldRing');
  const particles = document.getElementById('parchmentGoldParticles');

  // 阶段1：展开书页 + 金束
  overlay.classList.add('active');
  beams.classList.add('active');
  ring.classList.add('active');

  // 阶段2：0.5s 后爆发粒子
  setTimeout(() => {
    spawnGoldParticles(50);
    particles.classList.add('active');
  }, 500);

  // 阶段3：1.2s 后封合书页
  setTimeout(() => {
    overlay.classList.add('closing');
    beams.classList.remove('active');
  }, 1200);

  // 阶段4：2s 后完成
  setTimeout(() => {
    overlay.classList.add('done');
    overlay.classList.remove('active', 'closing');
    ring.classList.remove('active');
    particles.classList.remove('active');
    if (callback) callback();
  }, 2000);
}
```

---

## 影响范围

| 文件 | 改动类型 | 预估行数 |
|------|---------|---------|
| `frontend/js/isometricBg.js` | 修改 + 新增 | +120 / ~40 |
| `frontend/js/roomHall.js` | 修改 | ~20 / +30 |
| `frontend/css/main.css` | 新增 | +150 |
| `frontend/index.html` | 新增 DOM 元素 | +10 |

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 锯齿光带 + 红色流光叠加影响性能 | 使用离屏 Canvas 预渲染锯齿光带（静态路径不变） |
| 金色粒子 DOM 过多 | 最多 60 个绝对定位 div，动画结束即移除 |
| 下半圈卡片在副本数量少时显空 | 最少 2 张时仍均匀分布弧线，1 张时居中 |
| GIF 帧率不可控 | 后续迭代用 spritesheet + CSS steps() 替代 GIF |
