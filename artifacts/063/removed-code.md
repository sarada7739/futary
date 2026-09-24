# 063: 消した使われなくなったコード（0節 #10・#11）

探し方: `node artifacts/063/scripts/find-unused-exports.mjs`（export された名前が、定義したファイルの外に一度も出てこないものを挙げる。道具は入れない）。挙がったものを 1 つずつ `grep -rn` で 0 件と確かめてから消した。素材は `packages/ui/assets/`・`apps/landing/assets/` のファイル名を `apps`・`packages`・`scripts` の ts/tsx/html/css/mjs/json から探した。

## 消したもの

| 何 | どこ | 確かめたこと |
|---|---|---|
| SVG フィルタの定義一式（`DISPLACEMENT_MAP_SVG`・`DISPLACEMENT_MAP`・`glassFilter()`・`GLASS_FILTER_DEFS` と `<body>` の中の `<div dangerouslySetInnerHTML>`） | `apps/app/app/+html.tsx` | 061 段階3 で `glass-tab-bar.tsx` から `url(` が無くなり、`nisoine-glass-*` を引くものが 0 件（#10） |
| `Glass.filterId`・`lensBlurRadius`・`lensBrightness`・`lensSaturate`（型と 2 外観の値） | `packages/ui/src/theme.ts` | 同上。`lensTint`・`lensRim` は `glass-tab-bar.tsx` が使うので残す（#10） |
| `unlockedPhotoIds()` | `apps/api/src/lib/plan.ts` | 参照 0 件（`unlockedPhotos()` を album.ts が直接使う）。047 で足して使われないまま |
| `type Db` | `packages/db/src/index.ts` | 参照 0 件 |
| `tab-album.png` | `packages/ui/assets/` | 参照 0 件（008 で置いて一度も使われていない） |

`pnpm build:public` の出力の `apps/api/public/app/index.html` に `nisoine-glass`・`feDisplacementMap` が 0 件（ビルドの inline script の検査も 2 本のまま通った）。

## 候補に挙がったが残したもの

| 何 | 理由 |
|---|---|
| `coupleMembers`・`couplePlans`（`packages/db/src/schema/couple.ts`） | drizzle-kit がマイグレーションを生成するためのスキーマ定義（`drizzle.config.ts` の `schema`）。import されなくても要る |
| export されているがファイルの中で使われているもの（約 110 件。`AiProvider`・`*Props`・`*Schema` など） | 死んだコードではない（`export` が余分なだけ）。0節 #11 は「どこからも import されない」ものを消す対象にしているが、中で使われているものは export を外すだけの変更になり、コメントとデッドコード以外の差分を増やすので触らない |
| `panelPhotoToday`・`panel-today.png` | 0節 #11 のとおり残す（041 で「次フェーズで戻す」） |
