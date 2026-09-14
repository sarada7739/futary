# 045: プレミアム関連の素材を作る（再現用。docs/sample/README.md「045 で作ったもの」）。
#   python make-assets.py
# 1. packages/ui/assets/icon-lock.png — 上限のシートの鍵（見本 04 の形）。原本無し。
#    既存の panel-*.png と同じ規格（96×96・RGBA・単色 #4A3733・線幅 6px・塗りなし）。
#    部品側で tintColor を primary にして、primarySubtle の円の上に置く
# 2. packages/ui/assets/icon-warning.png — 残りの警告カードの ⚠（見本 01 の形）。同じ規格
# 8 倍で描いて縮小（043 の make-assets.py と同じ）
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "packages" / "ui" / "assets"

INK = (0x4A, 0x37, 0x33, 255)
SCALE = 8
SIZE = 96
WIDTH = 6 * SCALE


def new_canvas():
    big = SIZE * SCALE
    return Image.new("RGBA", (big, big), (0, 0, 0, 0))


def rounded_rect(d, box, r, width):
    d.rounded_rectangle(box, radius=r, outline=INK, width=width)


def make_lock():
    im = new_canvas()
    d = ImageDraw.Draw(im)
    s = SCALE
    # 本体: 幅 52・高さ 38 の角丸四角（中央やや下）
    body = (22 * s, 42 * s, 74 * s, 80 * s)
    rounded_rect(d, body, 8 * s, WIDTH)
    # つる: 半径 15 の半円 + 縦線（本体の上）
    cx = 48 * s
    top = 20 * s
    r = 15 * s
    d.arc((cx - r, top, cx + r, top + 2 * r), start=180, end=360, fill=INK, width=WIDTH)
    d.line([(cx - r, top + r), (cx - r, 42 * s)], fill=INK, width=WIDTH)
    d.line([(cx + r, top + r), (cx + r, 42 * s)], fill=INK, width=WIDTH)
    # 鍵穴: 小さな丸
    hole_r = 5 * s
    d.ellipse((cx - hole_r, 57 * s - hole_r, cx + hole_r, 57 * s + hole_r), fill=INK)
    d.line([(cx, 57 * s), (cx, 68 * s)], fill=INK, width=int(4.5 * s))
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    out = ASSETS / "icon-lock.png"
    im.save(out, optimize=True)
    print("wrote", out, im.size)


def make_warning():
    im = new_canvas()
    d = ImageDraw.Draw(im)
    s = SCALE
    # 三角: 頂点 (48,14)・左下 (12,80)・右下 (84,80)。角は丸める
    pts = [(48 * s, 14 * s), (12 * s, 80 * s), (84 * s, 80 * s)]
    d.line(pts + [pts[0]], fill=INK, width=WIDTH, joint="curve")
    for x, y in pts:
        d.ellipse([x - WIDTH / 2, y - WIDTH / 2, x + WIDTH / 2, y + WIDTH / 2], fill=INK)
    # ！: 縦線と点
    d.line([(48 * s, 38 * s), (48 * s, 58 * s)], fill=INK, width=WIDTH)
    dot_r = 4 * s
    d.ellipse((48 * s - dot_r, 68 * s - dot_r, 48 * s + dot_r, 68 * s + dot_r), fill=INK)
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    out = ASSETS / "icon-warning.png"
    im.save(out, optimize=True)
    print("wrote", out, im.size)


if __name__ == "__main__":
    make_lock()
    make_warning()
