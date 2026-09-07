# 物品生图方案（Item Icon Generation Plan）

> 为 44 件物品（6 全局 + 38 青峰山）批量生成**无字物品图标**，与 258 枚技能图标同一美术体系（LOL 厚涂、深色烟雾底、戏剧性打光），但突出**单物件特写**（道具/装备格图标风格，类《暗黑破坏神》物品格）。

## 一、图片规格

| 项 | 值 |
|---|---|
| 尺寸 | 请求 512×512（即梦 T2I 实际返回 1024×1024，前端按格缩略） |
| 命名 | `assets/items/{itemId}.png`（如 `assets/items/QFSC001.png`） |
| 无字 | 是（与技能图标统一，UI 内无文字） |
| 静态托管 | `server.js` 已挂载 `/assets` → 根目录 `assets`，前端直接拼 URL 访问 |

## 二、提示词模板

```
game item icon for '{物品名}', {ITEM_THEME 单物件主题}, {TYPE_STYLE 类型基底}{QUALITY_GLOW 品质氛围}, game item icon, single object prop filling the frame, dramatic side rim lighting, painterly thick brush fantasy art, deep dark smoky background, subtle glowing edge highlight, ultra detailed, absolutely no text
```

- **TYPE_STYLE（类型基底）**
  - consumable：`survival consumable prop, liquid or packaged goods`
  - material：`crafting material prop, metal and industrial parts`
  - plot：`paper document prop, vintage ink and aged paper`
  - equipment：`worn equipment prop, metal and fabric`
- **QUALITY_GLOW（品质氛围）**：white 无 / green 绿光 / blue 蓝光 / purple 暗紫史诗光 / gold 金光 / orange 燃烧橙光 / red 血红凶兆光 / black 漆黑虚空能量·克苏鲁恐怖
- **NEGATIVE**：text, watermark, words, letters, numbers, symbols, chinese characters, label, ui element, description box, frame, border, lowres, blurry, deformed, flat vector, flat icon, logo, signature, hands

## 三、脚本

- 入口：`tools/gen_item_icons.js`
- 读源：`config/items/global_items.json` + `config/items/dungeons/*.json`（含 bossDrop）
- 主题表：脚本内 `ITEM_THEME` 按 itemId 逐件定制英文主题（如 QFSE013→shoggoth core fragment, pulsating void crystal with tentacles）
- 防护：复用 `guard.generateImage`（嵌套防抖 + 熔断重试 + 频率/每日限流）+ `api_rate_limit`（5/分钟，30/日）
- 幂等：已存在 `assets/items/{itemId}.png` 自动跳过（可断点续跑）
- 日志：`logs/item_icons.log`

## 四、运行方式

```bash
node tools/gen_item_icons.js all     # 全部 44 张（串行，约 6-10 分钟）
node tools/gen_item_icons.js QFS     # 仅青峰山 38 张
node tools/gen_item_icons.js G       # 仅全局 6 张
node tools/gen_item_icons.js G-002   # 单张
```

> ⚠️ 每日限流 30 次：全量 44 张需 2 天；如需一次跑完，临时调高 `tools/api_rate_limit.js` 的 `CONFIG.DAILY_LIMIT`（如 50）。生图扣即梦 API 费用，建议先跑 `G` / 单张看效果，满意后再全量。

## 五、前端对接（已完成）

- 图标渲染改为**图片 + emoji 兜底**：优先 `/assets/items/{itemId}.png`，`onerror` 时隐藏图片、显示原 emoji，未生成图片的物品自动回退，不破 UI。
- 接入点：`frontend/js/itemCatalog.js`（图鉴卡）、`frontend/js/warehouse.js`（仓库/背包格）。
- CSS：`frontend/css/main.css` 新增 `.gicon img` / `.gemoji` / `.cat-card-icon img` / `.cat-emoji`。

## 六、验证状态

- ✅ 脚本可用：`G-002 基础绷带` 生成成功（185KB，1024×1024）
- ✅ 服务器静态访问：`http://localhost:3000/assets/items/G-002.png` 返回 200
- ✅ 前端语法/兜底逻辑无错误
