"""
process_forge_furnace_v2.py — 处理新强化炉图片（装备强化炉.png → forge_furnace3.png）
- 背景纯白 → 去白底转透明（羽化过渡，保留主体浅色高光）
- 裁剪到主体 bbox，减少四周空白
- 可选暗金风格：主体暗度/饱和度微调，融入克苏鲁暗金 UI
用法: E:\\miniconda3\\envs\\coc_rpg_env\\python.exe tools/process_forge_furnace_v2.py
"""
from PIL import Image
import math, os

SRC = r'E:\coc-rpg-game\assets\ui\装备强化炉.png'
DST = r'E:\coc-rpg-game\assets\ui\forge_furnace3.png'

# 去白底参数
TRANS_D = 30      # 到白色距离 <= 此值 → 全透明
KEEP_D = 70       # 到白色距离 >= 此值 → 全不透明
# 暗金风格（可调，0=不处理）
DARKEN = 1.0      # 整体压暗倍率（1.0 不变）
SAT = 1.08        # 饱和度倍率
GOLD_TINT = (0.0, 0.0, 0.0)  # 金色染色偏移（加在暗部，保持主体）

def main():
    im = Image.open(SRC).convert('RGBA')
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            d = math.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2)
            if d <= TRANS_D:
                a = 0
            elif d >= KEEP_D:
                a = 255
            else:
                a = int(255 * (d - TRANS_D) / (KEEP_D - TRANS_D))
            # 风格微调：略压暗 + 提饱和，让偏白的高光更接近暗金 UI 的暖灰
            if a > 0 and (DARKEN != 1.0 or SAT != 1.0 or GOLD_TINT != (0, 0, 0)):
                rr = r * DARKEN + GOLD_TINT[0]
                gg = g * DARKEN + GOLD_TINT[1]
                bb = b * DARKEN + GOLD_TINT[2]
                # 简易饱和度提升（到灰度的方向外推）
                gray = (rr + gg + bb) / 3
                rr = gray + (rr - gray) * SAT
                gg = gray + (gg - gray) * SAT
                bb = gray + (bb - gray) * SAT
                px[x, y] = (int(max(0, min(255, rr))), int(max(0, min(255, gg))), int(max(0, min(255, bb))), a)
            else:
                px[x, y] = (r, g, b, a)
    # 裁剪到主体 bbox（alpha > 40）
    alpha = im.getchannel('A')
    bbox = alpha.point(lambda v: 255 if v > 40 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    im.save(DST)
    print('已保存:', DST, im.size)

if __name__ == '__main__':
    main()
