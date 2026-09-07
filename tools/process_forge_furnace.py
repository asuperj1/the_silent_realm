# -*- coding: utf-8 -*-
"""
处理锻造炉图片：assets/ui/装备强化炉.png → assets/ui/forge_furnace2.png
1. 去掉右下角"豆包AI"浅灰暖色水印文字
2. 全图去白底（背景 → 透明）
3. 裁剪四周空白，让炉子主体更大（在横条炉区用 contain 完整显示）
"""
from PIL import Image
import numpy as np

SRC = 'assets/ui/装备强化炉.png'
DST = 'assets/ui/forge_furnace2.png'

im = Image.open(SRC).convert('RGB')
a = np.array(im).astype(int)
h, w, _ = a.shape

# ---- 1. 水印擦除：右下角区域中，颜色接近浅灰暖色文字 (128,120,105) 的像素 ----
# 水印文字：饱和度低、亮度中等的暖灰；炉子主体：深色(<70)；背景：纯白(>245)
r, g, b = a[:,:,0], a[:,:,1], a[:,:,2]
gray = (r + g + b) / 3.0

# ★ 水印位置：用户在地图编辑器标点"豆包水印需要删除" col49,row58（COLS=ROWS=60，图片 2048）
# 换算绝对像素中心：x=(49/60)*2048≈1673, y=(58/60)*2048≈1979；擦除范围覆盖整行文字（约 ±200x±160）
WM_CX, WM_CY = round((49 / 60) * w), round((58 / 60) * h)
WM_X0, WM_Y0 = max(0, WM_CX - 240), max(0, WM_CY - 200)
WM_X1, WM_Y1 = min(w, WM_CX + 220), min(h, WM_CY + 120)
print('watermark center px:', (WM_CX, WM_CY), 'box:', (WM_X0, WM_Y0, WM_X1, WM_Y1))
# 水印颜色特征：灰 80~210，且 R>B（暖色偏棕），饱和度低
is_watermark = (gray > 80) & (gray < 215) & ((r - b) > 4) & ((r - g) > -30) & ((g - b) > -30)

# 只在水印 bbox 内操作，且排除纯背景（白色）
in_wm_box = np.zeros((h, w), dtype=bool)
in_wm_box[WM_Y0:WM_Y1, WM_X0:WM_X1] = True
wm_mask = is_watermark & in_wm_box

# 形态学膨胀：把相邻水印笔画像素也纳入（消除边缘残留，手动实现 3x3 膨胀）
def dilate(mask, iters=2):
    out = mask.copy()
    for _ in range(iters):
        padded = np.pad(out, 1, mode='constant', constant_values=False)
        out = (padded[:-2,:-2] | padded[:-2,1:-1] | padded[:-2,2:] |
               padded[1:-1,:-2] | padded[1:-1,1:-1] | padded[1:-1,2:] |
               padded[2:,:-2] | padded[2:,1:-1] | padded[2:,2:])
    return out
wm_mask = dilate(wm_mask, iters=2)

# 统计
print('watermark pixels to erase:', int(wm_mask.sum()))

# 擦除：用周围背景色（白色）填充。先记录水印像素位置，稍后整体填充背景色
wm_ys, wm_xs = np.where(wm_mask)

# 填充颜色 = 白底（原图背景就是纯白）
FILL = np.array([255, 255, 255], dtype=int)
a[wm_ys, wm_xs] = FILL

# ---- 2. 去白底：非白像素保留，白色/近白变透明 ----
# 距离白色较远的像素视为炉子主体（背景纯白 → 全透明）
bg_dist = np.sqrt(((a - np.array([255,255,255]))**2).sum(axis=2))
alpha = np.zeros((h, w), dtype=np.uint8)
# 近白像素（残留白边）彻底透明
alpha[bg_dist <= 18] = 0
alpha[bg_dist > 48] = 255          # 明确主体
# 过渡区半透明羽化（18~48）
edge = (bg_dist > 18) & (bg_dist <= 48)
alpha[edge] = np.clip((bg_dist[edge] - 18) * 8.5, 20, 255).astype(np.uint8)

rgba = np.dstack([a, alpha]).astype(np.uint8)
out = Image.fromarray(rgba, 'RGBA')

# ---- 3. 裁剪空白（只按实质主体 alpha>40 计算 bbox，剔除白边，使炉子更大） ----
alpha_arr = alpha
ys, xs = np.where(alpha_arr > 40)
if len(xs):
    pad = 6
    x0 = max(0, xs.min() - pad); y0 = max(0, ys.min() - pad)
    x1 = min(w, xs.max() + pad + 1); y1 = min(h, ys.max() + pad + 1)
    out = out.crop((x0, y0, x1, y1))
    print('crop to:', (x1-x0), 'x', (y1-y0))

out.save(DST)
print('saved', DST, out.size, out.mode)

# 验证
chk = np.array(out)
print('final alpha: transparent', round((chk[:,:,3]<10).mean()*100,1), '% opaque', round((chk[:,:,3]>=250).mean()*100,1), '%')
# 检查右下角是否还有水印残留
c = np.array(out)
rr, gg, bb, aa = c[:,:,0].astype(int), c[:,:,1].astype(int), c[:,:,2].astype(int), c[:,:,3]
h2, w2 = c.shape[:2]
region = aa[max(0,h2-260):h2, max(0,w2-260):w2]
nontrans = (region>0).sum()
print('right-bottom 260x260 non-transparent px after crop:', int(nontrans))
