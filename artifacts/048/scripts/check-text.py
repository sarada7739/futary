# 048 段階2: 草案（md）の文面と HTML の文面が一致することを機械で確かめる（052 の check-text.py を元に、規約は 8 節も比べ、特商法を足した）。
# 意図した差は「解約後のデータ」の 2 箇所だけ（047 の猶予が入るまで「新しく追加できなくなります」。A のメモ）。
# md 側: 冒頭の引用・「（草案）」の題・「A のメモ（公開しない）」・8 節（【048 で足す】）を除く。
# html 側: タグを剥がし、ヘッダ（ロゴ・タグライン）とフッターを除く。
# どちらも空白を潰して比較する
import re, sys, html as htmlmod

def md_lines(path):
    out = []
    in_meta = False
    skip_section = False
    for line in open(path, encoding="utf-8").read().splitlines():
        s = line.strip()
        if s.startswith(">") or s == "---" or s.startswith("# "):
            continue
        if s.startswith("## A のメモ"):
            in_meta = True
        if in_meta:
            continue
        if s.startswith("### "):
            skip_section = False
            if skip_section:
                continue
        if skip_section:
            continue
        if not s:
            continue
        s = s.replace("**", "")
        if s.startswith("|---"):
            continue
        if s.startswith("|"):
            cells = [c.strip() for c in s.strip("|").split("|")]
            out.extend(cells)
            continue
        s = re.sub(r"^#{2,4} ", "", s)
        s = re.sub(r"^- ", "", s)
        out.append(s)
    return [norm(x) for x in out]

# 見出しの節番号は比べない（規約 8 節を省いた分、HTML 側は番号を詰めてある。A の判断。
# 番号以外の文面はそのまま比べる）
def norm(x):
    x = re.sub(r"\s+", "", x)
    return re.sub(r"^\d+\.", "", x)

def html_lines(path):
    src = open(path, encoding="utf-8").read()
    body = re.search(r"<main>([\s\S]*)</main>", src).group(1)
    body = re.sub(r"<br\s*/>", "\n", body)
    # 行の中の強調（<strong>）は行を割らない。ブロック要素だけ改行にする
    body = re.sub(r"</?strong>", "", body)
    text = re.sub(r"<[^>]+>", "\n", body)
    text = htmlmod.unescape(text)
    return [norm(x) for x in text.splitlines() if x.strip()]

ok = True
for md, page in [("docs/legal/terms-draft.md", "apps/landing/terms.html"), ("docs/legal/tokushoho-draft.md", "apps/landing/tokushoho.html")]:
    a = md_lines(md)
    b = html_lines(page)
    print(f"== {page}: md {len(a)} 行 / html {len(b)} 行")
    import difflib
    diff = list(difflib.unified_diff(a, b, fromfile=md, tofile=page, lineterm="", n=0))
    if diff:
        ok = False
        print("\n".join(diff))
    else:
        print("一致")
sys.exit(0 if ok else 1)
