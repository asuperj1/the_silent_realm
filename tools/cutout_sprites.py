# -*- coding: utf-8 -*-
"""改进版战斗立绘抠图：双阈值洪水填充 + 边缘羽化
用法: python tools/cutout_sprites.py [文件名]  (缺省处理全部)
"""
import os, sys, glob
from collections import deque
from PIL import Image, ImageFilter
import numpy as np

SRC_DIR = r'assets/青峰山战斗立绘'
OUT_DIR = r'assets/青峰山战斗立绘/cutout'

KERNEL_T = 45      # 确定背景核阈值（曼哈顿距离和）
SPREAD_T = 88      # 蔓延阈值（覆盖渐变背景，稍宽松）
FEATHER = 1.2      # 边缘羽化高斯半径


def cutout(name):
    path = os.path.join(SRC_DIR, name)
    img = Image.open(path).convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]

    # 背景色：优先取四角小块中位色（贴近纯背景）；若四角差异大（主体到角）退回整条边缘中位色
    edge = np.concatenate([arr[0, :, :3], arr[-1, :, :3], arr[:, 0, :3], arr[:, -1, :3]])
    corners = [arr[2:20, 2:20, :3], arr[2:20, w - 20:w - 2, :3],
               arr[h - 20:h - 2, 2:20, :3], arr[h - 20:h - 2, w - 20:w - 2, :3]]
    cmed = np.array([np.median(c.reshape(-1, 3), axis=0) for c in corners])
    spread = cmed.max(axis=0) - cmed.min(axis=0)
    bg = np.median(cmed, axis=0).astype(int) if spread.sum() < 80 else np.median(edge, axis=0).astype(int)

    dist = np.abs(arr[..., :3].astype(int) - bg).sum(axis=2)
    kernel = dist < KERNEL_T        # 确定背景
    spread = dist < SPREAD_T        # 可蔓延背景（含渐变）

    # 洪水填充：从四边种子，只经过 spread 区域
    visited = np.zeros((h, w), bool)
    q = deque()
    def seed(y, x):
        if spread[y, x] and not visited[y, x]:
            visited[y, x] = True
            q.append((y, x))
    for x in range(w):
        seed(0, x); seed(h - 1, x)
    for y in range(h):
        seed(y, 0); seed(y, w - 1)
    while q:
        y, x = q.popleft()
        if y > 0 and not visited[y - 1, x] and spread[y - 1, x]: visited[y - 1, x] = True; q.append((y - 1, x))
        if y < h - 1 and not visited[y + 1, x] and spread[y + 1, x]: visited[y + 1, x] = True; q.append((y + 1, x))
        if x > 0 and not visited[y, x - 1] and spread[y, x - 1]: visited[y, x - 1] = True; q.append((y, x - 1))
        if x < w - 1 and not visited[y, x + 1] and spread[y, x + 1]: visited[y, x + 1] = True; q.append((y, x + 1))

    # 只清除与边缘连通的背景；孤立背景色块（主体内部浅色）保留
    alpha = np.where(visited, 0, 255).astype(np.uint8)

    # 主体内部若残留与背景色极近的大块（防空洞），仅清非常确定的孤立小块
    # —— 不处理内部，避免误伤

    # 羽化：alpha 高斯模糊制造半透明过渡边（先只对边界区域，防内部晕开）
    a_img = Image.fromarray(alpha, 'L')
    soft = a_img.filter(ImageFilter.GaussianBlur(FEATHER))
    arr[..., 3] = np.array(soft)

    out = Image.fromarray(arr, 'RGBA')
    os.makedirs(OUT_DIR, exist_ok=True)
    out.save(os.path.join(OUT_DIR, name))
    n_alpha = (np.array(soft) > 0)
    print(f'{name}: 透明 {100*(np.array(soft)==0).mean():.1f}% 半透明 {100*((np.array(soft)>0)&(np.array(soft)<255)).mean():.1f}% '
          f'包围盒 x {np.where(n_alpha)[1].min()}-{np.where(n_alpha)[1].max()} y {np.where(n_alpha)[0].min()}-{np.where(n_alpha)[0].max()}')


def main():
    names = sys.argv[1:] if len(sys.argv) > 1 else [os.path.basename(p) for p in glob.glob(os.path.join(SRC_DIR, '*战斗立绘.png')) if 'cutout' not in p]
    for n in names:
        try:
            cutout(n)
        except Exception as e:
            print(f'{n}: FAIL {e}')


if __name__ == '__main__':
    main()
