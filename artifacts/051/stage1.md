# 051: プロダクト名を Nisoine に変える（ドメイン以外） — 実装の報告

2026-09-15 / セッションB。タスク定義 `docs/tasks/051-rename-nisoine.md`。利用者に見える名前と絵だけ。中の名前（`@futary/*`・URL・`localStorage` の鍵・バケット・`slug`/`scheme`）と過去の記録は触っていない。

## 絵（`scripts/make-assets.py`。PIL。再現できる）

| 出力 | 元 | どう作ったか |
|---|---|---|
| `packages/ui/assets/logo-mark.png`・`apps/landing/assets/logo.png`（600×159） | `wordmark-transparent.png`（RGBA 1536×1024。ぼかしの縁） | **アルファ 190 未満を透明に落とし、190〜240 を 0〜255 に伸ばす**（240 以上 = 文字の芯は不透明。芯のアルファは 240〜254 に分布していた）。RGB は文字の芯の色 (60, 31, 13) に揃えた（縁の画素は黒く沈んでいて、そのままだと黒い縁が出る）。文字の bbox + 8px で切り、幅 600 に縮小 |
| `apps/app/assets/icon.png`（1024）・`apps/landing/assets/apple-touch-icon.png`（180）・`favicon.png`（48。app と landing）・**`apps/app/public/apple-touch-icon.png`（180。`/app` のホーム画面アイコン。`+html.tsx` が指す）・`icon-192.png`・`icon-512.png`（PWA の manifest）** | `icon-1024.jpg` | 縮小だけ。角丸は付けない。定義の「`apps/app/assets/apple-touch-icon.png`」は実際には `apps/app/public/` にあった |
| `android-icon-foreground.png`（512。中央 66% に全体）・`-background.png`（512。四隅の平均色 (253, 231, 219)）・`-monochrome.png`（432。N の白抜き） | 同 | — |
| `apps/landing/assets/ogp.png`（1200×630） | B が組んだ | 生成りの地 (255, 246, 243) + ワードマーク幅 560 + 「日々が、ふたりの記録になる。」（游ゴシック Bold 46）+ 「ふたり専用SNS」（游ゴシック Regular 26）。今の `ogp.png` と同じ構図 |

**T6**（`stage1/t6.txt`）: `logo-mark.png` の四隅のアルファ [0, 0, 0, 0]。不透明（255）の画素 14,667・縁（1〜254）11,236。縁が多めに見えるのは 600 に縮めた LANCZOS の再サンプルで輪郭が 1px 滲むため（元の 1297 幅では芯が主）。見た目は `stage1/wordmark-on-{pink,white,dark}.png`（濃い地でも滲まない・欠けない）。停止条件「縁が落とし切れない」には当たらなかった。

## 文字

| 場所 | 後 |
|---|---|
| `apps/landing/index.html` | `title`「Nisoine - ふたり専用SNS」・`description`（機能の列挙は 4 つのまま。締めを「日々が、ふたりの記録になる。」に）・`og:site_name`/`og:title`/`twitter:title`・ロゴの `alt`（幅 200×53）・タグライン・フッター。GitHub の URL は旧名のまま（リポジトリ名） |
| `apps/app/app/+html.tsx` | `apple-mobile-web-app-title`「Nisoine」。**Poppins 300 の preload と `@font-face` を外した**（ホワイトの文字ロゴ専用だった。フォントのファイルは残している）。`<title>` は元々無い（expo-router が `app.json` の `name` から出す） |
| `apps/app/app.json` | `name`「Nisoine」（`slug`・`scheme` はそのまま） |
| `apps/api/src/procedures/album.ts` | `filename` を `nisoine-YYYYMMDD-{imageId}.jpg` に（T2） |
| `apps/app/lib/album-zip.ts` | ZIP 名を `nisoine-…zip` に（T2） |
| `apps/api/src/lib/link-preview.ts` | `nisoine-link-preview/1 (+https://futary-api…)`（T3。URL は Worker のまま） |
| `sign-in.tsx`・`invite.tsx`・`profile.tsx` | ロゴの `accessibilityLabel`・招待の共有文「Nisoineでペアを作りました」 |
| `app/(tabs)/index.tsx` | **ロゴは両モードで同じ画像**（120×32。`home-logo-text` と Poppins 300 の文字ロゴを消した。`useTheme` も読まなくなった）（T4） |
| `apps/app/lib/releases.ts` | 3.0.0「Nisoine になりました」（`route` 無し）（T5） |
| `CLAUDE.md`・`README.md`・`docs/requirements.md`・`docs/architecture.md` | 冒頭を Nisoine + 旧名の 1 行。`requirements.md` の名称・タグラインも |
| `apps/app/public/manifest.webmanifest` | `name`・`short_name`「Nisoine」（定義に無いが、PWA として入れたときのホーム画面の名前 = 利用者に見える） |
| `docs/sample/README.md` | `nisoine/` の 3 枚と OGP の出自 |

## テスト

| # | どこ | 何を |
|---|---|---|
| T1 | `stage1/t1-grep.txt` | `git grep -i futary`（ランディング・`+html.tsx`・`app.json`・画面・`releases.ts`。`@futary/` の import を除く）の残りは **`slug`/`scheme`・コメント 2 行・`localStorage` の鍵・1.0.0 の題「futary リリース」・GitHub の URL 2 つ**だけ（どれも 2節「変えないもの」） |
| T2 | `apps/api/test/album.test.ts`・`r2-signed-url.test.ts`・`apps/app/test/album-zip.test.ts` 他 | `filename`・ZIP 名の期待値を `nisoine-` に |
| T3 | `apps/api/test/link-preview.test.ts` | `LINK_PREVIEW_USER_AGENT` が `/^nisoine-link-preview\/1 \(\+https:\/\//` |
| T4 | `apps/app/test/white-stage2.test.tsx` | white・pink ともに `home-logo-image`（同じ `src`・`aria-label` Nisoine）で `home-logo-text` は無い |
| T5 | `apps/app/test/releases.test.ts`・`releases-screen.test.tsx`・`home-releases.test.tsx` | 先頭が 3.0.0・`route` 無し。お知らせは 3.0.0 の 2 行で「使ってみる」と絵が無い。「使ってみる」の配線は最新を route 付きに差し替えて見る（`../lib/releases` を getter で部分モック） |
| T6 | `stage1/t6.txt` | 上 |

`pnpm -r test`: ui 16・date 66・db 32・app 534・api 626 緑。`pnpm type-check`・`pnpm lint` 緑。

## スクリーンショット（`stage1/`。`scripts/capture.mjs`）

`pink-home`・`white-home`（ロゴ 120×32。両モード同じ画像）・`pink-home-release-sheet`（3.0.0 のお知らせ）・`pink-sign-in`・`landing-phone`・`landing-pc`（`apps/landing` を `python -m http.server` で配信して撮った）・OGP は `apps/landing/assets/ogp.png` そのもの・`wordmark-on-{pink,white,dark}`。`capture.json` にランディングの `title`/`og:*`/タグライン/フッターの文字。

## B が決めたこと（A に知らせる）

- ワードマークのアルファの閾値は **190〜240**（定義「文字の縁 1〜2px だけ残す」）。RGB を芯の色に揃えた（黒い縁を出さない）
- ホームのロゴは 120×32、サインインは 240×64、ランディングは 200×53（元の 168×59 と幅を揃えず、ワードマークの比率 3.77 で見た目の大きさを揃えた）
- Poppins 300 の preload と `@font-face` を外した（使う要素が無くなった）。`apps/app/public/fonts/poppins-300.woff2`（約 8KB）は残している（消すのは別の判断）
- OGP の日本語は游ゴシック（Windows）。ランディングの本文は既存の CSS のまま
- Android の前景は「元のアイコン全体を中央 66% に」（N だけ切り出さない。地のグラデーションと ✦ も入る）。モノクロは N のシルエット

## 停止条件の確認

- ワードマークの縁: 落とし切れた（`wordmark-on-dark.png`）
- 日本語フォント: 游ゴシックがあった
- ホワイトのホームで濃い茶のロゴが浮くか: `white-home.png`。浮いていない（B の目）。人間の目で

## 人間に頼むこと

1. Google OAuth の同意画面のアプリ名を Nisoine に（Google Cloud Console。0節 #8）
2. デプロイ後、iPhone のホーム画面にアイコンを入れ直す（apple-touch-icon）
3. X に URL を貼って OGP の絵が出るか

## 人間の手番（2026-09-15。A 経由）

1. **Google OAuth の同意画面のアプリ名を Nisoine に変えた（済）。**
2. **X の投稿画面で OGP のカード（Nisoine）が出ることを確認（済）。**
3. iPhone のアイコン入れ直し: 個別の報告なし（A は 051 を完了とした）

**051 完了（2026-09-15）。**
