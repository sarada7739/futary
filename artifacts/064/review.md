# 064 — R の判定

futary-R で origin/task/064-demo-want-amazon（6ab2dbf）を checkout。`worklog.md` は追記のみ（削除 0 行）。

**受け入れ。必須修正なし。**

## 種データ（0節 #2〜#6）

- 題名「グンゼのインナーシャツ」・URL `https://www.amazon.co.jp/dp/B00F2G8ZLS`（`?` 無し）・メモ「白の LL。2 枚組のやつ」・`createdDaysAgo: 1`・画像キー `wantImageKey("demo-want-image-gunze")` はタスク定義どおり
- `demo.ts` のコメントは 0節 #7 の「例外は Amazon の 1 件だけ」の形。`docs/sample/README.md` 108 行に出自（A が足した）
- `packages/db/seed/demo.test.ts` 34 件 緑（T1〜T3。T3 は SOF から 800×800 を読む）

## 持ち主（0節 #1 と違う）

れん → **ゆい**は人間の指示（報告に引用あり）。R は判定しない（仕様の判断）。タスク定義 0節 #1・T1 と 040 の 6 節の「ゆい 2・れん 3」を直すのは A。state.md に A への申し送りとして書いてあるか確かめてください。

## seed が落ちていた件の修正

- `packages/date/src/index.ts` の拡張子の無い `export * from "./holidays"` は 058（#406、a5afd2c）で入ったもの（R も確かめた）。以来 `seed:local`・`seed:remote` は `ERR_MODULE_NOT_FOUND` で落ちていた
- `allowImportingTsExtensions` を `tsconfig.base.json` に: `tsc` は全パッケージ・root とも `--noEmit` なので、出力を伴うコンパイルで衝突する経路は無い（`allowImportingTsExtensions` は noEmit が前提）
- **配信物への影響も確かめた**: API は `wrangler deploy --dry-run` が通り（3.5 MB）、出力に `BUNDLED_HOLIDAYS` と 2026 年の祝日が入っている（esbuild が `./holidays.ts` を解決できている）。アプリは B が Metro（`app-web`）で束ねて画面を撮っている。`expo export` も同じ Metro の解決なので同じ。`packages/date` のテスト 68 件 緑
- `packages/date/src` の他の相対 import に拡張子の抜けは無い

## 記録（判定に使わない）

1. ローカルの撮影で画像だけ `context.route` で同梱ファイルに差し替えた件は、報告に明記されていて、差し替えたのは画像の中身だけ（レイアウトと API の応答は本物）。本番の見え方は人間の `seed:remote` の後
2. 画像は Amazon の商品画像（実在の商品）を公開リポジトリに同梱し、デモで表示する。人間の選択（0節 #5）で出自も記録済み。R は判定しない

## 私が確かめていないこと

- `expo export`（`pnpm build:public`）の実走。Metro の開発サーバで束ねられていることと同じ解決器であることに頼った
- 本番の `seed:remote` の結果（人間の手番）
