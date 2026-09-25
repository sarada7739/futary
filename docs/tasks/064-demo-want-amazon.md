# 064: デモの「ほしいもの」に Amazon の実在の商品を 1 件足す

## 目的

**人間の指示（2026-09-25）。** デモペアの「ほしいもの」に、Amazon の商品を 1 件足す。

- URL（人間がくれた短縮 URL の転送先）: `https://www.amazon.co.jp/dp/B00F2G8ZLS`
- 商品: グンゼ インナーシャツ やわらか肌着 綿100% 半袖V首（2 枚組）

URL を貼ると商品の画像と題名が付く（040 の link-preview）という本物の見え方を、デモでも見せる。

## 0. 決めたこと（A）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | 誰のほしいもの | **れん**（`DEMO_USER_MAN_ID`）。れんは 3 件になる（ゆい 2・れん 3） | 男性用の肌着 |
| 2 | 題名 | **`グンゼのインナーシャツ`**（Amazon の長い題名は使わない。デモの他の題名と同じ短さ） | 一覧で 1 行に収まる |
| 3 | URL | **`https://www.amazon.co.jp/dp/B00F2G8ZLS`**（`ref`・`social_share` 等の追跡の引数は付けない） | 共有の追跡を載せない |
| 4 | メモ | **`白の LL。2 枚組のやつ`** | 他のデモと同じく一言 |
| 5 | 画像 | **Amazon の商品画像を使う（人間の選択）。**B が 1 度だけ 040 の link-preview と同じ抽出（Amazon のホストは `data-old-hires`）で画像を取り、**正方形 800×800・JPEG 品質 82 に整えて `packages/db/seed/assets/want-gunze.jpg` に置く**（他のデモ画像と同じく同梱。種データを作るたびに Amazon を取りに行かない）。取り方の手順は `artifacts/064/scripts/` に | 種データを決定的に保つ。外部の都合で種データが変わらない |
| 6 | 日付 | `createdDaysAgo: 1`（一番新しい。一覧の先頭に出る） | 枠の中で最初に目に入る |
| 7 | デモは実在の店を指さない（040 の 6 節・`demo.ts` のコメント） | **この 1 件だけ例外**（人間の指示）。他の 4 件は `example.com` のまま。`demo.ts` のコメントと 040 の 6 節を「例外 1 件」に直す | 本物の Amazon の見え方を見せるのが目的 |
| 8 | 画像の出自 | `docs/sample/README.md` の表に `want-gunze.jpg` の行（**Amazon の商品ページの画像。実在の商品。人間の指示でデモに使う**）。A が足した | 出自を記録する（他の画像と同じ） |

## 1. B の作業

- `packages/db/seed/demo.ts`: `DEMO_ASSET_FILES.wantGunze`・`wantDefs` に 1 件（0節 #1〜#6）。画像のキーは `wantImageKey("demo-want-image-gunze")`。コメントを 0節 #7 の形に
- `packages/db/seed/assets/want-gunze.jpg`（0節 #5）
- `packages/db/seed/demo.test.ts`: 件数（ゆい 2・れん 3）・画像を持つのが 2 件・Amazon の URL は 1 件だけで他は `example.com`
- ローカルで `seed:local` → `/app/?demo=1` のほしいものに画像付きで出る画面を `artifacts/064/`

## 2. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | `wants` はゆい 2・れん 3。画像を持つのは 2 件で、キーは両方 `couples/demo-couple/wants/…jpg` | `packages/db/seed/demo.test.ts` |
| T2 | `amazon.co.jp` を指すのは 1 件だけで、URL に `?` が無い。他は `example.com` | 同上 |
| T3 | `want-gunze.jpg` が 800×800・250KB 以下 | 同上か `scripts` |

## 完了条件

- T1〜T3。`pnpm -r test`・型チェック・lint
- 画面 `artifacts/064/`（ローカルのデモのほしいもの）
- **本番のデモへの反映は人間**: デプロイの後に `pnpm --filter @futary/db seed:remote`（デモペアだけを消して入れ直す。`demo.ts` の DELETE は `couple_id` で絞ってある）
- `releases.ts` に載せない（デモのデータで、機能ではない）
- `state.md` / `worklog.md`

## 停止条件

- Amazon から画像が取れない（ボット対策の画面が返る）→ ブラウザで開いた画像の URL を人間にもらう。A へ
- レビュー往復 3 回 → A へ

## 順序

すぐ。小さい（種データ 1 件・画像 1 枚・テスト）。
