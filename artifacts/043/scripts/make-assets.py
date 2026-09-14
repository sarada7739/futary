# 043: リリース履歴の素材を作る（再現用。docs/sample/README.md「043 で作ったもの」）。
#   python make-assets.py
# 1. packages/ui/assets/panel-releases.png — ホームの「リリース履歴を見る」の ✦。原本無し。
#    既存の panel-*.png と同じ規格（96×96・RGBA・単色 #4A3733・線幅 6px・塗りなし）で
#    4 方向の星を 1 つ描く（見本 pink/01 の形）。8 倍で描いて縮小
# 2. packages/ui/assets/release-gift.jpg — お知らせシートの上の贈り物の絵（ホワイト）。
#    docs/sample/simpleMode/リリース履歴/04-new-feature-sheet.jpg の贈り物とリボンの部分を切り出す
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "packages" / "ui" / "assets"
SAMPLE = ROOT / "docs" / "sample" / "simpleMode" / "リリース履歴"

INK = (0x4A, 0x37, 0x33, 255)
SCALE = 8
SIZE = 96


def star_points(cx, cy, outer, inner):
    # 4 方向の星（外周 4 点・内周 4 点を交互に）。内周を小さくすると先が尖る
    pts = []
    for i in range(8):
        r = outer if i % 2 == 0 else inner
        angle = i * 45
        import math

        rad = math.radians(angle - 90)
        pts.append((cx + r * math.cos(rad), cy + r * math.sin(rad)))
    return pts


def make_icon():
    big = SIZE * SCALE
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = cy = big / 2
    # 線幅 6px（96 基準）。星の外周は 40px（半径。中央の 80px の中に収める）
    width = 6 * SCALE
    pts = star_points(cx, cy, 40 * SCALE, 11 * SCALE)
    d.line(pts + [pts[0]], fill=INK, width=width, joint="curve")
    # 角を丸める（既存アイコンの角丸に合わせる）
    for x, y in pts:
        d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=INK)
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    out = ASSETS / "panel-releases.png"
    im.save(out, optimize=True)
    print("wrote", out, im.size)


def make_gift():
    src = Image.open(SAMPLE / "04-new-feature-sheet.jpg").convert("RGB")
    # 見本（768×1360）の贈り物とリボン（y 655〜800、x 200〜565）。NEW のピルは含めない（部品が描く）
    box = (200, 655, 568, 800)
    im = src.crop(box)
    # 幅 736px（2 倍表示で 368pt）に揃える。写真ではなく淡い絵なので品質 85
    w, h = im.size
    target_w = 736
    im = im.resize((target_w, round(h * target_w / w)), Image.LANCZOS)
    # 見本の地は真っ白ではない（(255,250,246) 前後）ので、シートの面（surface = #FFFFFF）に
    # 置くと薄い四角が見える。地に近い画素（RGB の最小値が 236 以上）を白へ寄せる（軟らかいマスク）
    r, g, b = im.split()
    from PIL import ImageChops

    darkest = ImageChops.darker(ImageChops.darker(r, g), b)
    alpha = darkest.point(lambda v: 0 if v < 236 else round(255 * (v - 236) / (255 - 236)))
    white = Image.new("RGB", im.size, (255, 255, 255))
    im = Image.composite(white, im, alpha)
    out = ASSETS / "release-gift.jpg"
    im.save(out, quality=85, optimize=True)
    print("wrote", out, im.size)


if __name__ == "__main__":
    make_icon()
    make_gift()
