# 058: 天気の絵の仮置き（人間の絵 docs/sample/weather/icons-source.png がまだ無い）。
# 112×112・透過 PNG・役割の名前（weather-{sun,cloud,rain,snow,thunder}.png）。人間の絵が来たら
# artifacts/058/scripts/make-icons.py で切り出して差し替える（形式・名前は同じにする）。
# 実行: python artifacts/058/scripts/make-icons-placeholder.py
from pathlib import Path
from PIL import Image, ImageDraw
import math

ROOT = Path(__file__).resolve().parents[3]
DST = ROOT / "packages" / "ui" / "assets"
S = 8  # 8 倍で描いて縮小（線をなめらかに）
N = 112 * S
LINE = 8 * S

SUN = (245, 166, 35)
CLOUD = (150, 150, 160)
RAIN = (90, 150, 220)
SNOW = (120, 170, 230)
THUNDER = (240, 190, 40)


def canvas():
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def save(im, name):
    im = im.resize((112, 112), Image.LANCZOS)
    im.save(DST / name, "PNG", optimize=True)
    print(name, (DST / name).stat().st_size, "bytes")


def cloud_shape(d, cx, cy, w, color, outline_only=False):
    # 丸 3 つ + 台で雲
    r = w * 0.22
    parts = [(cx - w * 0.22, cy, r), (cx, cy - w * 0.12, r * 1.25), (cx + w * 0.24, cy + w * 0.02, r * 0.95)]
    fill = None if outline_only else color
    for x, y, rr in parts:
        d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=fill, outline=color, width=LINE)
    d.rounded_rectangle((cx - w * 0.44, cy, cx + w * 0.44, cy + w * 0.22), radius=w * 0.11, fill=fill, outline=color, width=LINE)
    if not outline_only:
        # 内側の線を消す（塗りで重ねる）
        for x, y, rr in parts:
            d.ellipse((x - rr + LINE, y - rr + LINE, x + rr - LINE, y + rr - LINE), fill=color)
        d.rounded_rectangle((cx - w * 0.44 + LINE, cy + LINE, cx + w * 0.44 - LINE, cy + w * 0.22 - LINE), radius=w * 0.08, fill=color)


# 晴: 太陽（丸 + 光線 8 本）
im, d = canvas()
c = N / 2
r = N * 0.2
d.ellipse((c - r, c - r, c + r, c + r), fill=SUN)
for i in range(8):
    a = i * math.pi / 4
    x1, y1 = c + math.cos(a) * r * 1.5, c + math.sin(a) * r * 1.5
    x2, y2 = c + math.cos(a) * r * 2.1, c + math.sin(a) * r * 2.1
    d.line((x1, y1, x2, y2), fill=SUN, width=LINE)
save(im, "weather-sun.png")

# 曇: 雲
im, d = canvas()
cloud_shape(d, N / 2, N * 0.5, N * 0.8, CLOUD)
save(im, "weather-cloud.png")

# 雨: 雲 + 雨粒 3 本
im, d = canvas()
cloud_shape(d, N / 2, N * 0.36, N * 0.72, CLOUD)
for i, x in enumerate((0.34, 0.5, 0.66)):
    y = N * (0.66 + (0.04 if i == 1 else 0))
    d.line((N * x + N * 0.03, y, N * x - N * 0.03, y + N * 0.16), fill=RAIN, width=LINE)
save(im, "weather-rain.png")

# 雪: 雪の結晶（線 3 本 + 枝）
im, d = canvas()
r = N * 0.36
for i in range(3):
    a = i * math.pi / 3
    dx, dy = math.cos(a), math.sin(a)
    d.line((c - dx * r, c - dy * r, c + dx * r, c + dy * r), fill=SNOW, width=LINE)
    for s in (-1, 1):
        for t in (0.55, 0.85):
            px, py = c + dx * r * t * s, c + dy * r * t * s
            for b in (-1, 1):
                ab = a + b * math.pi / 3
                d.line((px, py, px + math.cos(ab) * r * 0.22 * s, py + math.sin(ab) * r * 0.22 * s), fill=SNOW, width=LINE)
save(im, "weather-snow.png")

# 雷: 稲妻
im, d = canvas()
pts = [(N * 0.58, N * 0.08), (N * 0.3, N * 0.55), (N * 0.5, N * 0.55), (N * 0.4, N * 0.92), (N * 0.72, N * 0.42), (N * 0.52, N * 0.42)]
d.polygon(pts, fill=THUNDER)
save(im, "weather-thunder.png")
