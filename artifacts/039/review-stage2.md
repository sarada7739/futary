R から B へ。PR #275（039 段階2、head e8f7415。d045ed3 のヘッダの変更を含む）は受け入れ。必須修正は無い。マージしてよい。A にも同文を送る。この文を `artifacts/039/review-stage2.md` に一字一句そのまま保存すること。

# 039 段階2（PR #275）— R の判定

futary-R で pr-275（e8f7415）を checkout して実行した。apps/app 352件・`type-check`・`lint` 緑。触ったものは全て戻した。

## A の「守りたいこと」一文への答え

「段階2の差分は全部 `appearance === "white"` の側にあり、ピンクの描画・値・並びは何一つ変わらない。分岐を読む画面ファイルは `index.tsx` と `stats.tsx` の2つだけ」— **成り立っている。**ただしピンクに「描画以外」の差が2つある（下の記録）。

## A の6点への答え

### 1. 変更範囲と画素比較の対応 — 覆っている

- `stats-card.tsx`・`feature-panel.tsx` の利用者は `(tabs)/index.tsx` だけ（`git grep` で確認。テストと artifacts を除く）。`statsHeroPlaceholder` は `stats.tsx` だけ。つまり段階2の描画の変更はホームと統計の2画面に閉じ、画素比較の3画面（ホーム・タイムライン・統計）がそれを覆う
- `stage2/pink-pixel-diff.json`: ホーム・タイムライン・統計は 0 / 1,316,640（`maxChannelDiff` 0）。マイページは段階1と同じ位置ずれ
- ピンク側のコードの変化も読んだ: `stats.tsx` は行を配列（key 付き）にして同じ `<View gap>` に流す形（`false` → `null` の差だけ。描画は同じ）。`stats-card.tsx` はピンクの style をオブジェクトにまとめて spread、`glow={appearance === "pink"}`（ピンクでは true）。`feature-panel.tsx` のピンク側 JSX は無変更
- `+html.tsx` の inline script は1本のまま（`<script` が1箇所）。`scripts/`・`apps/api`・`packages/db`・`packages/contract` は差分ゼロ

### 2. `appearance` を読む場所 — 増えていない

`git grep` の結果（`packages/ui/src/appearance.tsx` 除く）: `packages/ui` の `card` `fab` `screen`、部品の `stats-card` `feature-panel`、画面の `index.tsx`（a）・`stats.tsx`（f）、段階1の `_layout.tsx`（タブバー枠線）・`profile.tsx`（切り替え UI）。3箇所目の画面ファイルは無い。

### 3. 差し替え口 — 1箇所。型宣言は同じ形

- 写真8枚 + ヒーロー1枚は `packages/ui/src/assets.ts` の `export { default as panelPhoto* }` / `statsHeroPlaceholder` だけ。`index.tsx` はそれを `photo` prop で `FeaturePanel` に渡すだけで、ファイル名を持たない
- `packages/ui/src/jpg.d.ts` と `apps/app/types/assets.d.ts` の `*.jpg` は `png.d.ts` と同じ形（`const value: number; export default value`）

### 4. Poppins 300 — 035 と同じ置き方。CSP は動いていない

- `apps/app/public/fonts/poppins-300.woff2`（7,840 bytes、`wOF2` マジック）。**Google Fonts の `css2?family=Poppins:wght@300` が返す latin の URL（`v24/pxiByp8kv8JHgFVrLDz8Z1xlFQ.woff2`）を私が取得して sha256 を比べた: 完全一致**（`78bc3aa7…`）。B の申告どおりのファイル
- `<link rel="preload">` 1本 + `@font-face` 1ブロックを 500・800 と同じ形で追加。`font-src 'self'` のまま（`build-public.mjs` に差分無し）。inline script は1本のまま（`EXPECTED_INLINE_SCRIPT_COUNT` 2 = Expo Router + 段階1の先読み）

### 5. 記念日カードの3状態 — 壊れていない（私が実際に描いて確かめた）

B のテストは `dating` と `dating_upcoming` だけなので、一時テスト（削除済み）で white を描いた:
- `unset`: 「付き合った日を設定する」の導線あり・数字ブロック無し（`parts` が null）・「会った日数：94日」は素の文字・ハート無し
- `hidden`（`primary_date='none'`）: 導線無し・数字無し・「会った日数」だけ
- `married_upcoming`: 「結婚まで あと」を残す（`dating_upcoming` と同じ扱い）
- `married`: 「結婚して」の小見出しを出さず「日目」だけ
- 統計画面 white: `unset` で導線の行を含む4行、`hidden` で記念日行の無い3行。区切り線は最後の行に無い

6件全部通った。`stats-card.tsx` の条件 `(!isWhite || (status !== "dating" && status !== "married"))` は「白では現在進行の小見出しだけ消し、未来の日付は残す」を正しく表している。

### 6. サーバ側 — 触れていない

`git diff --stat origin/main...pr-275 -- apps/api packages/db packages/contract scripts` は空。

## 記録（判定に使わない）

1. **ピンクの利用者にも Poppins 300 が preload される**（`+html.tsx` の `<link rel="preload">` は外観で分岐できない静的 HTML）。約 8KB の追加リクエストが1本。描画には影響しないが、「ピンクは何一つ変わらない」の「描画以外」の例外として書いておく。同様に `home-logo-image` / `screen-bokeh` の `testID` は DOM の属性として増えている（画素は 0 差）
2. **ホワイトの統計のヘッダは、d045ed3 で「空の帯」になる。**Web のタブヘッダには元から戻るボタンが無い（段階1の `dev/white-stats.png` を切り出して見た: 題「統計」と下線だけ）。題と下線を消したので、いまはデモバナーとヒーローの間に約 56pt の白い余白だけが残っている（`stage2/white-stats.png` 同位置を切り出して確認）。A の「戻るは残す」は Web では残すものが無い。ヘッダを残す判断自体は A のものなので変えない。人間が余白を気にするなら `headerShown: false` を白のときだけ、が次の一手

## 私が確かめていないこと

- iPhone 実機（Safari）の見え方。B も測っていない（stage2.md 11節）
- 本番ビルドの実行

段階2、受け入れ。人間に見せる4点（stage2.md 11節）はそのまま渡してよい。
