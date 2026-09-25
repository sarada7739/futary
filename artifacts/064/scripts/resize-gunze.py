# 064: fetch-gunze.mjs で取った元画像を、白地の正方形 800×800・JPEG 品質 82 に整える
#   python artifacts/064/scripts/resize-gunze.py <元画像> packages/db/seed/assets/want-gunze.jpg
# 商品画像は白地なので、縦横の短い方を白で埋めて正方形にしてから縮める（切り落とさない）
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
print("original", im.size)
side = max(im.size)
canvas = Image.new("RGB", (side, side), (255, 255, 255))
canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
canvas = canvas.resize((800, 800), Image.LANCZOS)
canvas.save(dst, "JPEG", quality=82, optimize=True)
print("saved", dst, canvas.size)
