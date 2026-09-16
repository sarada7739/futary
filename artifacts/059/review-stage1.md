# 059 段階1 — R の判定

futary-R で origin/task/059-landing-demo（7ab8b2d）を checkout。`landing.test.ts` 33 件 緑。`worklog.md` は追記のみ（削除行 0）。

**受け入れ。必須修正なし。**

## 差分で確かめたこと（0節との突き合わせ）

- #1・#2: `<img class="ai-band-photo">` と `.ai-band-photo` の CSS（PC・720px 未満の 2 箇所）が消えている。`apps/landing/assets/hands-cafe.jpg` は削除、`docs/sample/landing/` の原本は残る。`docs/sample/README.md` は A が「使わない」に直してある。`.ai-band` は `flex` のまま `.ai-band-copy`（`flex: 1 1 auto`・中央寄せ）だけになるので文字は帯の中央（`pc-ai-band.png`・高さ 200）
- #3・#4: `.demo-inner { grid-template-columns: 527px 1fr; gap: 40px; align-items: center }`。右の列は h2（左寄せ）→ `.demo-lead`（文言「デモ画面です。」・負のマージンを外した）→ h3 → `ul.demo-guide` → `a.btn.btn-primary`（`→` なし）。`.phone` の `margin: 0 auto` を外したのは grid の左列に置くので妥当。`.demo-more` は消えている
- #5: 3 行の文言・`<strong>` の位置は 0節どおり（T2 が文字どおりに固定している）。他の文言は足していない
- #6・#7: 767px の `display: none` はそのまま（T3）。960px 未満の分岐は無い
- #8: h2 → h3 の順（T4）
- #10: `.photo-card { padding: 22px }`・`img { border-radius: 14px }`。`.cards-2 .photo-card img` は `aspect-ratio` と `object-fit` だけなので角丸は共通の値が効く。`capture.json`: 6 枚とも下・左右 23px（22 + 枠線 1）・14px
- アプリ・API のコードは触っていない（差分のファイル一覧で確認）。リリース履歴にも足していない
- `pc-demo.png`: スマホが左、右の列が上下中央（`copyCenterOffset: 0`）。`consoleErrors` 0

## 記録（判定に使わない）

1. 800 幅でボタンが 2 行に折れる（B の報告どおり。0節 #7「そのままでよい」の範囲）。直すなら B の案（`white-space: nowrap; padding-inline: 32px`）でよいが、判断は A・人間
2. A へ: タスク定義 T4 の「054 T3（見出しの階層）」は 054 に無い（054 T3 は `<img>` の width/height）。B が 059 T4 として新しく書いたテストで固定している。タスク定義の表の参照だけ直すとよい
3. `capture.json` の `buttonText` が文字化けしている（書き出しの文字コード）。判定には `pc-demo.png` と T2 を使った。任意

## 私が確かめていないこと

- 本番デプロイ後の `https://nisoine.com/`（人間の手番）
- Windows 以外のフォントでの折り返し
