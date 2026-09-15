# 055: プレミアムの写真を 50 万枚までにする — 実装の報告

2026-09-16 / セッションB。タスク定義 `docs/tasks/055-premium-photo-limit-500k.md`。

## 変えたもの

| 場所 | 何を |
|---|---|
| `apps/api/src/procedures/album.ts` | `MAX_ALBUMS_PER_COUPLE` 100 → 1,000（0節 #1。`LIMIT_REACHED` の判定）。`album.list` の注釈を 1,000 件・署名 1,000 本に（署名は手元の HMAC 計算で R2 への往復は無い） |
| `packages/contract/src/album.ts` | 注釈の「100 件」→「1,000 件」（2 箇所。値は持っていない） |
| `packages/contract/src/couple.ts` | `PAID_ALBUM_PHOTO_LIMIT` 50_000 → 500_000（文言用の定数。サーバはこの数で止めていない） |
| `apps/app/lib/plan.ts` `apps/app/app/(tabs)/premium.tsx` | 注釈だけ（`paidPhotoLimitLabel()` は定数から「写真 50 万枚まで」を出す。実装は変えていない） |
| `apps/app/lib/releases.ts` | 3.2.0「プレミアムで保存できる写真が 50 万枚になりました」・本文「アルバムの写真を 50 万枚まで保存できます」・`route: "/premium"`（0節 #5）。**3.1.0 の文言は変えていない** |

触っていないもの: 1 アルバム 500 枚（`MAX_PHOTOS_PER_ALBUM`）・無料プラン 30 枚・`album.list` のページング無し・特商法の表記。
規約 8 節（`docs/legal/terms-draft.md`・`apps/landing/terms.html`）に枚数は書かれていなかったので触っていない（`grep "枚"` で 0 件）。
045 の上限シートに「5 万」は無かった（`grep "5 万"` は `/premium` の文言・リリース履歴・契約の定数のみ）。

## テスト

| # | 何を | どこで | 結果 |
|---|---|---|---|
| T1 | 999 件を入れて 1,000 件目は作れ、1,001 件目で `LIMIT_REACHED`。削除で空きができれば作れる | `apps/api/test/album.test.ts` T6 | 緑 |
| T2 | 499 枚に 2 枚で `LIMIT_REACHED`・1 枚は入る・501 枚目で `LIMIT_REACHED`（041 T6。変えていない） | 同上 | 緑 |
| T3 | 1,000 件（999 件に表紙 1 枚ずつ）で `album.list` が通り 1,000 件返る。応答の JSON は **602,392 bytes**（1MB 未満。断定は `< 1_000_000`。実測は断定を `< 1` にして落として読んだ） | 同上（T1 と同じ it） | 緑 |
| T4 | `/premium` に「写真 50 万枚まで」があり `/5 万枚/` が無い | `apps/app/test/premium-screen.test.tsx` | 緑 |
| T5 | `LATEST_VERSION` が 3.2.0・題名・本文 1 行・`/premium`。3.1.0 の文言はそのまま。お知らせシートも 3.2.0 の文言 | `apps/app/test/releases.test.ts` `home-releases.test.tsx` | 緑 |

`pnpm lint` ・ `pnpm type-check` ・ `pnpm test`（api 694・app 551・db 32・date 67・ui 16）すべて緑。

## 停止条件の確認

- `album.list` は 1 文に `couple_id` の 1 パラメータだけ（D1 の 100 には当たらない）。応答は 602KB で 1MB 未満 → 件数は 1,000 のまま（500 に落としていない）
- `docs/architecture.md` に「100 件」は `album.removePhotos` の `photoIds`（429 行。別の話）しか残っていない → 起票なし
