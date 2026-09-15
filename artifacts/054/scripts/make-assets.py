# 054: docs/sample/landing/ の写真（AI 生成）を apps/landing/assets/ へ役割の名前で置く。
# タスク定義 0節 #8: JPEG 品質 78〜82・表示幅の 2 倍まで（ヒーローは幅 1552 のまま可）・
# 1 枚 250KB 以下・合計 1.5MB 以下。EXIF は落とす（PIL は save 時に付けない）。
# 実行: python artifacts/054/scripts/make-assets.py（リポジトリのルートで）
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "docs" / "sample" / "landing"
PROFILE = ROOT / "docs" / "sample" / "プロフィール画像"
DST = ROOT / "apps" / "landing" / "assets"
MAX_BYTES = 250 * 1024
TOTAL_MAX = 1.5 * 1024 * 1024

# (元, 出力名, 出力の幅。None は元のまま)。表示幅の 2 倍を上限に
PLAN = [
    (SRC / "hero-beach.jpg", "hero-beach.jpg", 1552),          # ヒーロー。幅 960 表示 → 元のまま可
    (SRC / "phone-chat.jpg", "phone-chat.jpg", 640),           # 3 列カード（表示 ~300）
    (SRC / "phone-photos.jpg", "phone-photos.jpg", 640),
    (SRC / "calendar-desk.jpg", "calendar-desk.jpg", 640),
    (SRC / "hands-cafe.jpg", "hands-cafe.jpg", 640),           # AI まとめの帯の右（表示 ~320）
    (SRC / "ai-network.jpg", "ai-network.jpg", 1360),          # 帯の地（表示 960 → 元のまま）
    (SRC / "want-grid.jpg", "want-grid.jpg", 800),             # 2 枚並び（表示 ~400）
    (SRC / "polaroid-softcream.jpg", "polaroid-softcream.jpg", 800),
    (SRC / "polaroid-three.jpg", "polaroid-three.jpg", 800),
]


def save_under_limit(img: Image.Image, out: Path) -> tuple[int, int]:
    # 品質 82 から 78 まで下げて 250KB に収める。収まらなければ停止条件（350KB）を見る
    for q in (82, 80, 78):
        img.save(out, "JPEG", quality=q, optimize=True, progressive=True)
        if out.stat().st_size <= MAX_BYTES:
            return out.stat().st_size, q
    return out.stat().st_size, 78


def main() -> None:
    DST.mkdir(exist_ok=True)
    total = 0
    for src, name, width in PLAN:
        img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        if width and img.width > width:
            img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
        size, q = save_under_limit(img, DST / name)
        total += size
        print(f"{name}: {img.width}x{img.height} q{q} {size / 1024:.0f}KB")

    # 統計カードの丸いアイコン（120px の円 → 240×240）。顔が中央上寄りなので上を残して正方形に
    for src, name in ((PROFILE / "woman1.jpg", "avatar-yui.jpg"), (PROFILE / "man1.jpg", "avatar-ren.jpg")):
        img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        side = min(img.size)
        left = (img.width - side) // 2
        top = max(0, (img.height - side) // 4)
        img = img.crop((left, top, left + side, top + side)).resize((240, 240), Image.LANCZOS)
        size, q = save_under_limit(img, DST / name)
        total += size
        print(f"{name}: 240x240 q{q} {size / 1024:.0f}KB")

    print(f"合計 {total / 1024:.0f}KB（上限 {TOTAL_MAX / 1024:.0f}KB）")
    assert total <= TOTAL_MAX, "合計が 1.5MB を超えた"

    # AI まとめの帯の色: ai-network.jpg の地の色を取る（0節 #7）
    ai = Image.open(DST / "ai-network.jpg").convert("RGB").resize((16, 9))
    px = sorted(ai.getdata(), key=lambda p: sum(p))
    r, g, b = px[len(px) // 4]  # 暗い側の 1/4 分位（光る点を避ける）
    print(f"ai-network の地: #{r:02X}{g:02X}{b:02X}")


if __name__ == "__main__":
    main()
