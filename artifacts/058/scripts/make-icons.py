# 058: 人間の絵 docs/sample/weather/icons-source.png（1168×880・RGBA・6 マス。AI 生成）から 5 つを切り出す。
# 0節 #6: 晴 = 上段左・曇 = 上段右・雨 = 下段左・雪 = 下段中・雷 = 下段右。上段真ん中（太陽 + 雲）は使わない。
# マスの角丸の地（薄いピンクがかった白。(253,251,252)〜(254,245,246) の勾配）を落として絵だけにする:
# マスの縁から「地の色の画素」（白〜薄いピンク: 3 色とも BG_MIN 以上で、青みが赤みを超えない = R >= B）だけを
# 塗りつぶし（flood fill）で透明にする。雲（青みがかった白。B > R）・雪（水色）・黄・青は地の色でないので止まる。
# 「隣との差」で広げると雲の淡い勾配を伝って雲まで消えた（実測）ので、絶対の色で判定する。
# 残った絵の外接矩形を正方形に広げ、112×112（表示は最大 28 CSS px）の透過 PNG に。
# 出力: packages/ui/assets/weather-{sun,cloud,rain,snow,thunder}.png（仮の絵と同じ名前・規格）
# 実行: python artifacts/058/scripts/make-icons.py
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "docs" / "sample" / "weather" / "icons-source.png"
DST = ROOT / "packages" / "ui" / "assets"
SIZE = 112
BG_MIN = 228  # 地の暗い側（マスの縁の影）も拾う
PAD = 0.08  # 正方形にしたあとの余白（絵が縁に触れないように）

im = Image.open(SRC).convert("RGBA")
a = np.array(im)
alpha = a[:, :, 3] > 0


def runs(v):
    out, start = [], None
    for i, x in enumerate(v):
        if x and start is None:
            start = i
        if not x and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(v) - 1))
    return out


cols = runs(alpha.any(axis=0))
rows = runs(alpha.any(axis=1))
assert len(cols) == 3 and len(rows) == 2, (cols, rows)

# (行, 列) → 名前。上段真ん中は使わない
TILES = {(0, 0): "sun", (0, 2): "cloud", (1, 0): "rain", (1, 1): "snow", (1, 2): "thunder"}


def cut(r, c):
    y0, y1 = rows[r]
    x0, x1 = cols[c]
    tile = a[y0 : y1 + 1, x0 : x1 + 1].copy()
    h, w = tile.shape[:2]
    rgb = tile[:, :, :3].astype(int)
    opaque = tile[:, :, 3] > 0
    # マスの縁（不透明の外周）から塗りつぶす
    seen = np.zeros((h, w), dtype=bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if opaque[y, x]:
                q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if opaque[y, x]:
                q.append((y, x))
    while q:
        y, x = q.popleft()
        if seen[y, x] or not opaque[y, x]:
            continue
        seen[y, x] = True
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and opaque[ny, nx]:
                r_, g_, b_ = rgb[ny, nx]
                if min(r_, g_, b_) >= BG_MIN and r_ >= b_:
                    q.append((ny, nx))
    tile[seen, 3] = 0
    # 絵の外接矩形 → 正方形 + 余白
    ys, xs = np.where(tile[:, :, 3] > 0)
    top, bottom, left, right = ys.min(), ys.max(), xs.min(), xs.max()
    side = int(max(bottom - top, right - left) * (1 + PAD * 2))
    cy, cx = (top + bottom) / 2, (left + right) / 2
    box = (int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2))
    out = Image.fromarray(tile).crop(box)  # 外に出た分は透明
    return out.resize((SIZE, SIZE), Image.LANCZOS), (int(seen.sum()), int((tile[:, :, 3] > 0).sum()))


for (r, c), name in TILES.items():
    icon, (removed, kept) = cut(r, c)
    icon.save(DST / f"weather-{name}.png", "PNG", optimize=True)
    print(f"weather-{name}.png: 地を {removed} 画素落とし、絵 {kept} 画素 → {SIZE}x{SIZE} {(DST / f'weather-{name}.png').stat().st_size} bytes")
