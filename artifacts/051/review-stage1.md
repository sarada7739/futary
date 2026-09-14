# 051（PR #357）— R の判定

futary-R で be7b70f を checkout して実行した。ui 16・date 66・db 32・app 534 緑。api は 609 緑・17 赤（`BETTER_AUTH_SECRET` 未設定の既知の環境起因。045 のときと同じ 17 件。T2・T3 の `link-preview`・`album`・`r2-signed-url` は 94 本すべて緑）。`tsc --noEmit` 緑・`eslint .` 緑。`worklog.md` は追記のみ。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 読んで確かめたこと

- **T1（自分で grep した）**: `apps/app/app`・`components`・`lib`・`apps/api/src`・`apps/landing`・`packages/ui/src`・`packages/db/seed`・`public`・`app.json` の `futary` は、`@futary/` の import・`slug`/`scheme`/`storagePrefix`・`localStorage` の鍵 4 つ・R2 のバケット名・Worker の URL・1.0.0 の題・GitHub の URL・`style.css` の 1 行目・コメントだけ。**利用者に見える文字列に `futary` は残っていない。**B の `t1-grep.txt` と一致
- T2: `album.ts` の `filename` と `album-zip.ts` の `zipFileName` が `nisoine-`。テストの期待値も
- T3: `LINK_PREVIEW_USER_AGENT` が `nisoine-link-preview/1 (+https://futary-api…)`（URL は Worker のまま = 2節）
- T4: `index.tsx` の分岐が消え、両モード同じ `Image`（`home-logo-image`・`accessibilityLabel` Nisoine）。`useTheme` を読まなくなった。`white-stage2.test.tsx` が両モードで見ている。`white-home.png` で濃い茶のロゴが白地で浮いていない（私の目でも）
- T5: `releases.ts` の先頭が 3.0.0・`route` 無し。A が 048 の段階2 を 3.1.0 に直している（0節 #7 と整合）
- **T6（PIL で自分で測った）**: `logo-mark.png` 600×159 RGBA。四隅のアルファ 0・0・0・0。不透明 14,667・縁 11,236（B の `t6.txt` と一致）。縁の RGB の平均 (56, 24, 8) ≈ 芯 (61, 31, 13)。黒い縁は無い。`wordmark-on-dark.png` で濃い地に滲み・欠け無し
- 絵の寸法: `icon.png` 1024・`apple-touch-icon.png` 180（app/public と landing は同じバイト）・`favicon.png` 48 × 2・`icon-192`/`icon-512`・Android 前景 512・背景 512・モノクロ 432。`logo-mark.png` と `landing/assets/logo.png` は同じバイト。`ogp.png` 1200×630（見た: 生成りの地・ワードマーク・「日々が、ふたりの記録になる。」・「ふたり専用SNS」。定義 0節 #5 の構図）
- 2節「変えないもの」: `slug`/`scheme`・`@futary/*`・鍵・バケット・URL・過去の docs と worklog・1.0.0 の題はそのまま。docs 4 つの冒頭に旧名の 1 行
- Poppins 300: `+html.tsx` の preload と `@font-face` を外し、`fontWeight: "300"` や `poppins-300` を使う要素は `apps/app`・`packages/ui` に残っていない（grep）。ファイルは残っている（B の報告どおり）
- 定義との違い（B の報告）: `apple-touch-icon.png` の置き場が `apps/app/public/`（`+html.tsx` が指す）。`manifest.webmanifest` の `name`/`short_name` は定義に無いが「利用者に見える名前」の 1節の趣旨どおり
- 人間の絵 3 枚は `docs/sample/nisoine/` にあり、`docs/sample/README.md` に出自

## 記録（判定に使わない）

1. `apps/landing/style.css` 1 行目のコメント「futary ランディングページ」と、コード中のコメントの `futary`（`ai.ts`・`link-preview.ts`・`r2-signed-url.ts`・`album.ts` 等）は 2節「コメントは触らない」のとおり残っている。見えない。記録だけ
2. `apps/app/public/fonts/poppins-300.woff2`（約 8KB）は参照が無くなった。消すかは A の判断（急がない）

## 私が確かめていないこと

- 人間の手番 3 つ（Google OAuth の同意画面の名前・iPhone のアイコン入れ直し・X で OGP）
- `landing-pc.png`・`landing-phone.png`・`pink-sign-in.png`・`pink-home-release-sheet.png` は見ていない（`white-home.png`・`wordmark-on-dark.png`・`ogp.png` を見た）
