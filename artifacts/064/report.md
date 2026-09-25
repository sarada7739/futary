# 064: デモの「ほしいもの」に Amazon の実在の商品を 1 件足す

`docs/tasks/064-demo-want-amazon.md`。

## 誰のほしいものか（0節 #1 と違う。人間の指示）

タスク定義はれんだが、**人間の指示でゆいに入れた**（「デモのほしい物リストを見る時、ゆいが初期表示っぽいからゆいのに入れて」）。ゲストの `/?demo=1` でほしいものを開くと、ゆいのタブが先に選ばれている（下の `want-yui.png`）。件数は **ゆい 3・れん 2**。T1 もそれに合わせた。タスク定義 0節 #1・040 の 6 節の「ゆい 2・れん 3」は A が直す。

## 入れたもの

| 項目 | 値 |
|---|---|
| 題名 | グンゼのインナーシャツ |
| URL | `https://www.amazon.co.jp/dp/B00F2G8ZLS`（`?` 無し） |
| メモ | 白の LL。2 枚組のやつ |
| 持ち主 | ゆい（`DEMO_USER_WOMAN_ID`） |
| 日付 | `createdDaysAgo: 1`（ゆいのタブの先頭） |
| 画像 | `packages/db/seed/assets/want-gunze.jpg`（キー `couples/demo-couple/wants/demo-want-image-gunze.jpg`） |

## 画像の取り方（0節 #5）

1. `node artifacts/064/scripts/fetch-gunze.mjs <元画像>`: 040 の `extractMeta`（`apps/api/src/lib/link-preview.ts`。Amazon は `data-old-hires`）と同じ User-Agent で商品ページを 1 度だけ取る。結果:
   - ページ 200・題名「Amazon | (グンゼ)GUNZE インナーシャツ やわらか肌着 綿100% 抗菌防臭加工 半袖V首 2枚組 SV61152 03 ホワイト LL | …」
   - 画像 `https://m.media-amazon.com/images/I/41ZuU4kMscL._AC_SL1254_.jpg`（200・image/jpeg・31,537 バイト・1175×1199）
2. `python artifacts/064/scripts/resize-gunze.py <元画像> packages/db/seed/assets/want-gunze.jpg`: 白地の正方形にして（切り落とさない）800×800・JPEG 品質 82 → **20,773 バイト**

ボット対策の画面は返らなかった（停止条件に当たらない）。

## T1〜T3

`packages/db/seed/demo.test.ts`:
- T1「wantsはゆい3件・れん2件。画像は2件R2に置く。手に入れたものが1件ある」: 画像の 2 件は両方 `couples/demo-couple/wants/…jpg` で、`images` に同じキーがある
- T2「amazon.co.jp を指すのは1件だけでURLに ? が無い。他は example.com」: Amazon の 1 件はゆいのもので画像付き
- T3「want-gunze.jpg は 800×800・250KB 以下の JPEG」: SOF から寸法を読む

`pnpm -r test`: ui 23・date 68・db **34**（+2）・app 630・api 780 = **1,535**。type-check・lint 緑。

## seed:local が main で落ちていた（直した）

`pnpm --filter @futary/db seed:local` が `ERR_MODULE_NOT_FOUND …/packages/date/src/holidays` で落ちた。058 で `packages/date/src/index.ts` に拡張子の無い `export * from "./holidays"` が入り、Node が .ts を直接実行する `seed/run.ts` から読めなくなっていた。**人間の `seed:remote` も同じ `run.ts` を通るので同じく落ちる。**

- `packages/date/src/index.ts`: `export * from "./holidays.ts"`
- `tsconfig.base.json`: `allowImportingTsExtensions: true`（packages/db が既に持つ設定を共通に。type-check は全部 `tsc --noEmit`）。date・contract・app・api の 4 つが `packages/date/src` を型検査するので、1 か所ずつ足すより共通に置いた
- 直したあと `seed:local` は完走（「完了。DEMO_COUPLE_ID = demo-couple」）。type-check・lint・全テスト緑。Metro（`app-web`）も `.ts` 付きの import で問題なく束ねた（下の画面）

## 画面（ローカル・iPhone 幅 375×812・Chromium）

`node artifacts/064/scripts/capture.mjs artifacts/064`（`api-dev`・`app-web` を起動して `seed:local` の後）。

- `want-yui.png`: ゲストで開いたほしいもの。**ゆいのタブが選ばれた状態**で、先頭がグンゼ（画像つき）、次がマグカップ、ニット
- `want-ren.png`: れんのタブ。フィルムカメラ・インテリアの写真集（手に入れた）の 2 件

**画像についての注意:** ローカルの API が返す画像の署名付き URL は本番の R2 を指し、`seed:local` の画像はローカルのバケットにしか無いので、ローカルではマグカップも含めてどの画像も読めない（ブラウザで両方 `error` を確かめた）。撮影に限り、`wants/demo-want-image-*.jpg` への要求を同梱の画像で応えている（`capture.mjs` の `context.route`。差し替えたのはグンゼとマグカップの 2 件）。**画面のレイアウトと API の応答（ゆいの 3 件・グンゼが先頭・画像のキー付き）は本物、画像の中身は同梱のファイル。**本番の見え方は人間の `seed:remote` の後に確かめる。

## 本番のデモへの反映（人間）

デプロイの後に `pnpm --filter @futary/db seed:remote`（デモペアだけを消して入れ直す）。
