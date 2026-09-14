# 051: Nisoine の絵を docs/sample/nisoine/ から切り出す（PIL）。
#   python make-assets.py
# 1. ワードマーク: wordmark-transparent.png（RGBA。ぼかしの縁）→ アルファ 190 未満を透明に落とし、190〜240 を 0〜255 に（240 以上 = 文字の芯は不透明）
#    伸ばす（文字の縁 1〜2px だけ残る）。色は文字の芯の色（rgb 60,31,13）に揃える（縁の画素は黒っぽく沈んでいた）。
#    文字の bbox で切り、幅 600 に縮小 → packages/ui/assets/logo-mark.png・apps/landing/assets/logo.png
# 2. アイコン: icon-1024.jpg → icon.png（1024）・apple-touch-icon.png（180。landing）・favicon.png（48。app と landing）・
#    android-icon-foreground.png（512。中央の N を 66% に置き、周りは透明 = セーフゾーン）・
#    android-icon-background.png（512。アイコンの地の色 = 元の四隅の平均）・android-icon-monochrome.png（432。N の白抜き）
# 3. OGP: 1200×630。生成りの背景（今の ogp.png の色）+ ワードマーク + 「日々が、ふたりの記録になる。」+ 「ふたり専用SNS」
#    日本語のフォントは Windows の游ゴシック（C:/Windows/Fonts/YuGothB.ttc / YuGothR.ttc）
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "docs/sample/nisoine"
OUT = Path(__file__).resolve().parent.parent / "stage1"
OUT.mkdir(exist_ok=True)

CORE_RGB = (60, 31, 13)
ALPHA_LOW = 190
ALPHA_HIGH = 240

# --- 1. ワードマーク ---------------------------------------------------------
src = np.array(Image.open(SRC / "wordmark-transparent.png").convert("RGBA")).astype(np.float32)
alpha = src[..., 3]
a = np.clip((alpha - ALPHA_LOW) / (ALPHA_HIGH - ALPHA_LOW), 0, 1) * 255
out = np.zeros_like(src)
out[..., 0], out[..., 1], out[..., 2] = CORE_RGB
out[..., 3] = a
ys, xs = np.where(a > 0)
pad = 8
box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(src.shape[1], xs.max() + pad + 1), min(src.shape[0], ys.max() + pad + 1))
wordmark = Image.fromarray(out.astype(np.uint8), "RGBA").crop(box)
print("wordmark crop", box, wordmark.size)
# 幅 600 に（縦横比はそのまま）
scale = 600 / wordmark.width
wordmark_600 = wordmark.resize((600, round(wordmark.height * scale)), Image.LANCZOS)
wordmark_600.save(ROOT / "packages/ui/assets/logo-mark.png")
wordmark_600.save(ROOT / "apps/landing/assets/logo.png")
print("logo", wordmark_600.size)

# T6 の数字: 四隅が透明・文字の画素が不透明
w6 = np.array(wordmark_600)
corners = [w6[0, 0, 3], w6[0, -1, 3], w6[-1, 0, 3], w6[-1, -1, 3]]
opaque = int((w6[..., 3] == 255).sum())
semi = int(((w6[..., 3] > 0) & (w6[..., 3] < 255)).sum())
print("T6 corners alpha", corners, "opaque", opaque, "semi(edge)", semi, "ratio edge/opaque", round(semi / opaque, 3))
(OUT / "t6.txt").write_text(
    f"logo-mark.png {wordmark_600.size}\ncorners alpha {corners}\nopaque pixels {opaque}\nsemi-transparent (edge) pixels {semi}\nedge/opaque {semi / opaque:.3f}\nalpha threshold {ALPHA_LOW}..{ALPHA_HIGH} -> 0..255, rgb set to {CORE_RGB}\n",
    encoding="utf-8",
)
# 確認用: ピンクの地・ホワイトの地・濃い地に置いたもの
for name, bg in [("on-pink", (255, 245, 240)), ("on-white", (255, 255, 255)), ("on-dark", (60, 40, 40))]:
    canvas = Image.new("RGBA", (640, wordmark_600.height + 40), bg + (255,))
    canvas.alpha_composite(wordmark_600, (20, 20))
    canvas.convert("RGB").save(OUT / f"wordmark-{name}.png")

# --- 2. アイコン -------------------------------------------------------------
icon = Image.open(SRC / "icon-1024.jpg").convert("RGB")
icon.save(ROOT / "apps/app/assets/icon.png")
icon.resize((180, 180), Image.LANCZOS).save(ROOT / "apps/landing/assets/apple-touch-icon.png")
icon.resize((48, 48), Image.LANCZOS).save(ROOT / "apps/app/assets/favicon.png")
icon.resize((48, 48), Image.LANCZOS).save(ROOT / "apps/landing/assets/favicon.png")
# /app のホーム画面アイコンと PWA の manifest のアイコン（apps/app/public。+html.tsx が apple-touch-icon を指す）
icon.resize((180, 180), Image.LANCZOS).save(ROOT / "apps/app/public/apple-touch-icon.png")
icon.resize((192, 192), Image.LANCZOS).save(ROOT / "apps/app/public/icon-192.png")
icon.resize((512, 512), Image.LANCZOS).save(ROOT / "apps/app/public/icon-512.png")
ic = np.array(icon)
corner_mean = tuple(int(v) for v in np.concatenate([ic[:32, :32].reshape(-1, 3), ic[:32, -32:].reshape(-1, 3), ic[-32:, :32].reshape(-1, 3), ic[-32:, -32:].reshape(-1, 3)]).mean(axis=0))
print("icon corner mean (android background)", corner_mean)
Image.new("RGBA", (512, 512), corner_mean + (255,)).save(ROOT / "apps/app/assets/android-icon-background.png")
# 前景: 中央の 66%（Android のセーフゾーン）に元のアイコン全体を縮めて置く。周りは透明
fg = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
inner = round(512 * 0.66)
fg.alpha_composite(icon.resize((inner, inner), Image.LANCZOS).convert("RGBA"), ((512 - inner) // 2, (512 - inner) // 2))
fg.save(ROOT / "apps/app/assets/android-icon-foreground.png")
# モノクロ: 濃い茶（N）の画素を白にしたシルエット（アルファ）。432 の中央 66%
dark = (ic.astype(int).sum(axis=2) < 200)
mono_src = Image.fromarray((dark * 255).astype(np.uint8), "L")
mono = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
inner_m = round(432 * 0.66)
sil = mono_src.resize((inner_m, inner_m), Image.LANCZOS)
white = Image.new("RGBA", (inner_m, inner_m), (255, 255, 255, 255))
white.putalpha(sil)
mono.alpha_composite(white, ((432 - inner_m) // 2, (432 - inner_m) // 2))
mono.save(ROOT / "apps/app/assets/android-icon-monochrome.png")

# --- 3. OGP ------------------------------------------------------------------
BG = (255, 246, 243)
INK = (74, 55, 51)
MUTED = (150, 130, 125)
ogp = Image.new("RGB", (1200, 630), BG)
wm = wordmark.resize((560, round(wordmark.height * 560 / wordmark.width)), Image.LANCZOS)
ogp.paste(wm, ((1200 - wm.width) // 2, 150), wm)
draw = ImageDraw.Draw(ogp)
bold = ImageFont.truetype("C:/Windows/Fonts/YuGothB.ttc", 46)
regular = ImageFont.truetype("C:/Windows/Fonts/YuGothR.ttc", 26)
catch = "日々が、ふたりの記録になる。"
sub = "ふたり専用SNS"
cw = draw.textlength(catch, font=bold)
draw.text(((1200 - cw) / 2, 150 + wm.height + 52), catch, font=bold, fill=INK)
sw = draw.textlength(sub, font=regular)
draw.text(((1200 - sw) / 2, 150 + wm.height + 52 + 46 + 40), sub, font=regular, fill=MUTED)
ogp.save(ROOT / "apps/landing/assets/ogp.png")
print("ogp", ogp.size)
