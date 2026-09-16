# 056: docs/sample/landing/phone-frame.png（1024×1536。AI 生成）を apps/landing/assets/phone-frame.png に置く。
# 人間の絵は画面部分と外側が既に透明（alpha 0。B が測った: 画面は x 208〜814・y 114〜1426 = 606×1312 で、
# 390×844 と同じ比〈2.165〉。ノッチは x 335〜693・y 114〜166）。切り抜きは要らず、大きさだけ整える。
# 目安 150KB 以下。超えるなら幅 800 に（0節 #7・1節）。
# 実行: python artifacts/056/scripts/make-assets.py
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "docs" / "sample" / "landing" / "phone-frame.png"
DST = ROOT / "apps" / "landing" / "assets" / "phone-frame.png"
LIMIT = 150 * 1024

im = Image.open(SRC).convert("RGBA")
W, H = im.size
a = im.getchannel("A")
px = a.load()
# 画面の矩形（透明）を測り直して出す（CSS の位置と倍率の根拠）
cx, cy = W // 2, H // 2
l = cx
while l > 0 and px[l - 1, cy] == 0:
    l -= 1
r = cx
while r < W - 1 and px[r + 1, cy] == 0:
    r += 1
x = cx - 200  # ノッチ（x 335〜693）を避け、角丸にも掛からない列
t = cy
while t > 0 and px[x, t - 1] == 0:
    t -= 1
b = cy
while b < H - 1 and px[x, b + 1] == 0:
    b += 1
print(f"画面: x {l}..{r} y {t}..{b} = {r - l + 1}x{b - t + 1}（比 {(b - t + 1) / (r - l + 1):.3f}。390x844 は {844 / 390:.3f}）")
assert px[cx, cy] == 0, "画面の中央が透明でない"
assert px[l - 10, cy] > 0, "縁が不透明でない"

for width in (1024, 800):
    out = im if width == W else im.resize((width, round(H * width / W)), Image.LANCZOS)
    out.save(DST, "PNG", optimize=True)
    size = DST.stat().st_size
    print(f"{width}: {size / 1024:.0f}KB")
    if size <= LIMIT:
        break
