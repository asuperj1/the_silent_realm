# ADR-010-PLAN · 登录/注册页卡片居中修复

**状态**：✅ **COMPLETED**（2026-08-07 T-1 已修复：login.css 追加 .global-gold-canvas 定位规则，卡片恢复居中）
**创建日期**：2026-08-07
**规划人**：Orchestrator（bug 根因已由代码审查定位）

## 一、Bug 现象

寂静之地登录/注册页面中，登录/注册界面框（`.auth-card`）不居中显示。

## 二、根因（已定位）

`frontend/auth/login.html` 引用了 `<canvas id="globalGoldParticles" class="global-gold-canvas">`，但 `.global-gold-canvas` 的样式（`position: fixed; top:0; left:0; width:100%; height:100%`）定义在 `frontend/css/main.css` L1954，而 **登录页只加载 `login.css` + `loginLoadingAnim.css`，未加载 `main.css`**。

后果：该 canvas 在登录页无 `position: fixed`，成为 `body`（`display:flex; align-items:center; justify-content:center`）的**普通 flex 子项**参与布局，占据空间将 `.auth-card` 挤偏。`#bgCanvas` 因 `login.css` 中有 `position:fixed` 正常脱离文档流，故只有全局金尘 canvas 是问题源。

## 三、修改方案（1 文件，1 规则）

**文件**：`frontend/auth/login.css`

**新增**（文件末尾追加）：
```css
/* 全局金色粒子 Canvas（登录页未加载 main.css，需补定位，避免挤占 flex 居中） */
.global-gold-canvas {
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 0;
  pointer-events: none;
}
```

**效果**：canvas 脱离文档流，`.auth-card` 恢复 flex 居中；不影响其他页面（main.css 已有同规则）。

## 四、验收标准

1. 浏览器访问登录页，`.auth-card` 水平/垂直居中。
2. `#globalGoldParticles` canvas 不挤占布局（position: fixed）。
3. 登录/注册标签切换正常，金尘粒子仍显示。
4. `node --check` 无需（纯 CSS）；页面无控制台报错。

## 五、文件改动清单

| 文件 | 动作 |
|------|------|
| `frontend/auth/login.css` | 追加 1 条 `.global-gold-canvas` 规则 |
