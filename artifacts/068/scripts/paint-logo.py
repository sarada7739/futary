# 068 追補: 人間のモデルのテクスチャ（4096×4096）から、背面の中央の Apple のロゴを塗りつぶす。
#   python artifacts/068/scripts/paint-logo.py <basecolor.jpg> <出力.png> <確認用の縮小.png>
# ロゴを囲む箱の中を、箱の縁の色から上下左右の線形補間（Coons の面）で埋める（背面はなだらかな同じ色なので
# 縁から補えば継ぎ目が出ない）。ほかに他社の印（文字・ロゴ）はテクスチャに無かった（目で全体を見た）
import sys

import numpy as np
from PIL import Image

src, dst, preview = sys.argv[1], sys.argv[2], sys.argv[3]
# ロゴ（影を含む）を囲む箱。テクスチャの画素の座標（左・上・右・下）
BOX = (1740, 2400, 2110, 2830)

im = np.asarray(Image.open(src).convert("RGB")).astype(np.float64)
left, top, right, bottom = BOX
# 縁のすぐ外側の 4 画素ぶんを平均してノイズをならす
top_row = im[top - 4 : top, left:right].mean(axis=0)  # (w, 3)
bottom_row = im[bottom : bottom + 4, left:right].mean(axis=0)
left_col = im[top:bottom, left - 4 : left].mean(axis=1)  # (h, 3)
right_col = im[top:bottom, right : right + 4].mean(axis=1)
h, w = bottom - top, right - left
v = np.linspace(0, 1, h)[:, None, None]
u = np.linspace(0, 1, w)[None, :, None]
corner_tl, corner_tr = top_row[0], top_row[-1]
corner_bl, corner_br = bottom_row[0], bottom_row[-1]
patch = (
    (1 - v) * top_row[None, :, :]
    + v * bottom_row[None, :, :]
    + (1 - u) * left_col[:, None, :]
    + u * right_col[:, None, :]
    - ((1 - u) * (1 - v) * corner_tl + u * (1 - v) * corner_tr + (1 - u) * v * corner_bl + u * v * corner_br)
)
out = im.copy()
out[top:bottom, left:right] = patch
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst)
small = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS)
small.save(preview)
print("painted", BOX)
