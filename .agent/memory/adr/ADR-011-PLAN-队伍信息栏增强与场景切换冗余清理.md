# ADR-011-PLAN · 队伍信息栏增强 + 场景切换冗余清理

**状态**：✅ **COMPLETED**（2026-08-07 T-1 队伍栏增强 + T-2 场景切换冗余清理均已完成）
**创建日期**：2026-08-07
**改动边界**：前端 `index.html` + `client.js` + `main.css`

## 一、需求

1. **队伍信息栏增强**：显示同房间组队队友的 hp、san 值和五维属性（str/dex/con/per/wil）。
2. **场景切换冗余清理**：右侧栏"场景背景"折叠面板存在两个重复标题栏，删掉一个。

## 二、现状核实

### 队伍信息栏（当前）
- `frontend/js/client.js` `renderTeam()`（L1002-1060）：
  - 每个队员条目显示：`name` + `❤️hp/maxHp 🧠san/maxSan`
  - 五维属性仅通过 **hover 弹窗**（`.team-attr-popup`）展示，非常驻
  - `roomPlayers` 数据源含 `attr`（hp/maxHp/san/maxSan/str/dex/con/per/wil），字段完整
- `frontend/css/main.css` L1144-1200：`.team-member`、`.team-stats` 样式存在；hover 弹窗 `.team-attr-popup` 样式存在

### 场景切换冗余（已定位）
- `frontend/index.html` L425-435 右侧栏第 4 折叠面板 `data-section="bg"`：
  - 外层 `collapsible-header` 标题：`🖼️ 场景背景`
  - 内层 `#bgSwitcherPanel` 内又有 `<div class="panel-title">🖼️ 场景背景</div>`（L433）
  - → **两个重复标题栏**，删除内层重复的 `panel-title`

## 三、修改方案

### T-1：队伍信息栏增强（client.js + main.css）

**目标**：每个队员条目**常驻**显示五维属性 + hp/san，不再仅依赖 hover 弹窗。

**client.js `renderTeam()`** 修改队员条目 HTML：
```js
div.innerHTML = `
  <div class="team-member-main">
    <span class="name">${p.name}</span>
    <span class="team-stats">❤️${p.attr.hp}/${p.attr.maxHp} 🧠${p.attr.san}/${p.attr.maxSan}</span>
  </div>
  <div class="team-attr-row">
    <span class="attr-cell">💪${p.attr.str ?? '?'}</span>
    <span class="attr-cell">🏃${p.attr.dex ?? '?'}</span>
    <span class="attr-cell">🛡️${p.attr.con ?? '?'}</span>
    <span class="attr-cell">👁️${p.attr.per ?? '?'}</span>
    <span class="attr-cell">🌀${p.attr.wil ?? '?'}</span>
  </div>`;
```

**main.css** 追加样式（`.team-member-main`、`.team-attr-row`、`.attr-cell`），保持与现有 `.team-member`/`.team-stats` 风格一致。

> 说明：五维图标使用 emoji（与现有 ❤️🧠 风格一致），不依赖缺失的物理 PNG；hover 弹窗保留作为补充。

### T-2：删除冗余场景切换栏（index.html）

删除 `frontend/index.html` L433 内层重复标题：
```html
<div id="bgSwitcherPanel" class="bg-switcher-panel hidden">
  <div class="panel-title">🖼️ 场景背景</div>   <!-- ★ 删除此行 -->
  <div id="bgSwitcherThumbs" class="bg-switcher-thumbs"></div>
</div>
```
保留外层 `collapsible-header` "🖼️ 场景背景" 作为唯一标题。

> 注意：`bgSwitcher.js` `ensureDOM()` 中若 HTML 遗漏面板会自动创建（含 title），但此处 HTML 已有面板，仅删内层重复标题不影响其逻辑（panel-title 仅样式层）。

## 四、验收标准

1. 右侧栏"小队成员"面板：每个队员条目直接显示 name + hp/san + 五维（str/dex/con/per/wil），数值正确。
2. 右侧栏"场景背景"面板：仅剩 1 个标题栏，无重复。
3. `renderTeam` 触发（进入房间/成员变化/角色选择）时五维正确渲染；hover 弹窗仍可用。
4. 页面无控制台报错；`node --check frontend/js/client.js` 通过。

## 五、文件改动清单

| 文件 | 动作 |
|------|------|
| `frontend/js/client.js` | 修改 `renderTeam()` 队员条目 HTML |
| `frontend/css/main.css` | 追加 `.team-member-main`/`.team-attr-row`/`.attr-cell` 样式 |
| `frontend/index.html` | 删除 `#bgSwitcherPanel` 内重复 `panel-title` |
