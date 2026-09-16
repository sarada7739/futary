# 047: プレミアムをやめたあと、無料枠を超える写真に鍵を掛ける — 実装の報告

2026-09-16 / セッションB。タスク定義 `docs/tasks/047-plan-downgrade-lock.md`（main 47aa9f0）。

## 変えたもの

| 場所 | 何を |
|---|---|
| `packages/contract/src/couple.ts` | `LOCK_GRACE_DAYS = 30`・`planStateSchema`（`{plan:"paid"}` \| `{plan:"free", lockAt: 秒\|null, locked: boolean}`）・`coupleWithPlanSchema.planState` |
| `packages/contract/src/album.ts` | `photoSchema.url` を nullable に・`locked: boolean` を足した（鍵の写真は `url: null`・`caption: ""`・`locked: true`。`width`/`height`/`takenAt` は残す） |
| `apps/api/src/lib/plan.ts` | **判定の 1 箇所**: `resolvePlanState(row, now)`（`resolvePlan` はその `.plan`）。猶予の起点 `lockOriginOf`（0節 #11: `expires_at` → `manual` なら `updated_at` → `stripe` で `expires_at` 無しは鍵なし → どれでもない形も鍵なし）。`unlockedPhotos(db, coupleId)`（`taken_at, id` 昇順の先頭 30 枚を 1 文で。`album_id`・`key`・大きさも返す）。`loadPlanRow` に `updated_at` |
| `apps/api/src/procedures/album.ts` | `loadLock`（locked のときだけ先頭 30 を引く。paid・猶予中は引かない）。`photo.list`（アルバム）: 30 に無い写真は `url null`。`photo.downloadUrl`・`album.updatePhoto`: 鍵の写真は `NOT_FOUND`。`album.get/list/create/update/addPhotos/removePhotos` の `toAlbum`: カバーが鍵ならそのアルバムの鍵でない中でいちばん新しいものに倒す（無ければ null）。`ALBUM_SELECT` に `cover_id`。`album.list` は鍵の文脈を 1 度だけ引いて全アルバムに使う |
| `apps/api/src/procedures/couple.ts` | `couple.get` が `planState` を返す。`albumQuota.used` は鍵を含む（変えていない） |
| `apps/app/lib/plan.ts` | `lockNotice(planState, quota)`（猶予中: 「2026年10月16日までに写真を保存してください。それ以降、無料枠を超える写真は見られなくなります」・鍵の後: 「無料枠を超える 70 枚は見られません」）・`lockNoticeShort`（詳細用） |
| `apps/app/components/lock-band.tsx`（新規） | 帯。猶予中は「ZIP で保存 ›」「プレミアムについて ›」、鍵の後は「プレミアムについて ›」 |
| `apps/app/app/(tabs)/album.tsx` | 使用量のカードの上に帯（「ZIP で保存」= すべての写真）。タイムラインのプレビューの `url` を nullable に対応 |
| `apps/app/app/(tabs)/album-detail.tsx` | 見出しの下に帯（短い形。「ZIP で保存」= このアルバム）。鍵のマス（`surface-tint` + 鍵 + 「プレミアムで解放」。押すと 045 のシート）。ビューア・説明文の編集・保存は `url` のある写真だけ（鍵の写真は渡さない）。選択モードでは鍵のマスも選べる（削除できる。保存には入らない） |
| `apps/app/app/(tabs)/profile.tsx` | プランの行の上に帯（「ZIP で保存」= すべての写真） |
| `apps/app/lib/album-zip.ts` | 鍵の写真（`url null`）は ZIP に入れない |
| `apps/landing/tokushoho.html` `terms.html` `index.html` | 0節 #12: 特商法「解約後のデータについて」を草案の文面に・規約 8 節を草案の「30 日の猶予」の行に・FAQ「いつでも ZIP」→「ZIP で」 |

## テスト

| # | 何を | どこで | 結果 |
|---|---|---|---|
| T1 | `resolvePlanState`: 行なし・Checkout 前の free（stripe・expires 無し）→ lockAt null。paid 期限内 → paid。期限切れ +29 日は猶予中・+30 日ちょうどで locked。Stripe の canceled も同じ起点。手で free は `updated_at`。未知の source は鍵なし | `apps/api/test/plan-lock.test.ts` | 緑 |
| T2 | 2 アルバム 25 + 15 = 40 枚（taken_at が交互）で locked: 全体の昇順 31〜40 枚目が `url null`・locked・caption 空。30 枚目までは URL あり。`unlockedPhotos` と一致 | 同上 | 緑 |
| T3 | 鍵の写真の `downloadUrl` → NOT_FOUND。鍵でない写真は取れる。`updatePhoto` も NOT_FOUND | 同上 | 緑 |
| T4 | カバーが鍵 → 鍵でない中でいちばん新しいものに倒れる。鍵でない写真が無いアルバムは `cover null`。`album.list` も同じ | 同上 | 緑 |
| T5 | 40 枚で locked → 10 枚消して 30 枚 → 全部外れる。paid に戻す → 外れる | 同上 | 緑 |
| T6 | locked で `addPhotos` → PLAN_LIMIT。`album.create` の cover も PLAN_LIMIT | 同上 | 緑 |
| T7 | 猶予中は全部の URL が返り、`couple.get` の `planState.lockAt` = 期限 + 30 日。`used` は鍵を含む | 同上 | 緑 |
| T8 | 詳細: 猶予中の帯に日付と「ZIP で保存」（このアルバムのシート）。鍵の後の帯・鍵のマス・押すとシート・ビューアは開かない・鍵でないマスはビューア（鍵の写真は渡さない = 1 枚だけ）。選択モードで鍵のマスを選んで削除できる。一覧: 帯が使用量のカードの上・「ZIP で保存」= すべて・「プレミアムについて」→ /premium。マイページ: 帯と ZIP。lockAt null には帯が無い | `apps/app/test/album-detail-screen.test.tsx` `album-screen.test.tsx` `profile-screen.test.tsx` `plan-lock.test.ts` `album-zip.test.ts` | 緑 |
| T9 | 隣のペアの古い 40 枚を数えない。相手の写真の `downloadUrl` は NOT_FOUND のまま | `plan-lock.test.ts` | 緑 |
| T10 | `/tokushoho` の行が草案の文面。`/terms` 8 節に「30 日の猶予」。`/` に「いつでも ZIP」が無い | `apps/api/test/landing.test.ts` | 緑 |
| T11 | 200 件 × 3 枚（600 枚）で locked: `unlockedPhotos` は 30 個・先頭 10 件のアルバム。`photo.list` の 1 ページが通り、`album.list`（200 件）のカバーは 10 件だけ | `plan-lock.test.ts` | 緑 |

`pnpm lint`・`pnpm type-check`・`pnpm test`（api 731・app 565・db 32・date 67・ui 16）すべて緑。

## 画面（`artifacts/047/stage1/`。390×844・両モード。`scripts/capture.mjs`）

| ファイル | 何 |
|---|---|
| `{pink,white}-album-list-grace.png` `-locked.png` | 一覧の帯（使用量のカードの上） |
| `{pink,white}-album-detail-grace.png` `-locked.png` | 詳細の帯 |
| `{pink,white}-album-detail-locked-tiles.png` | 鍵のマス（31〜40 枚目） |
| `{pink,white}-album-detail-locked-sheet.png` | 鍵のマスを押した 045 のシート |
| `{pink,white}-profile-grace.png` `-locked.png` | マイページの帯 |
| `capture-grace.json` `capture-locked.json` | 帯の文言・鍵のマスの数（10）・**`photo.list` の応答: locked で 40 枚中 URL あり 30・locked 10**（確認観点「鍵の写真は URL を持たない」） |

写真のマスが空に見えるのはローカル R2 の署名付き URL を Playwright が読めないため（045 の画面と同じ）。
撮影用のペアは 045 の `make-session.mjs --used=40` で作り、`scripts/set-plan.mjs grace|locked|paid` で `couple_plans` を切り替えた（ローカルだけ。終わったら paid に戻した）。

## B が決めたこと

- 帯は **無料枠を超えていないとき（`used <= limit`）は出さない**（失うものが無い。猶予中も同じ）
- 帯の日付は `formatDateJa(todayJst(lockAt * 1000))`（年付き。「2026年10月16日までに」）
- 鍵の写真は `album.updatePhoto` も NOT_FOUND（`downloadUrl` と同じ。画面は鍵のマスから編集に入れない）
- 選択モードで鍵のマスも選べる（0節 #6「自分で減らす」= 削除できる）。保存は `url` のある写真だけ。鍵だけを選んで保存を押すと「プレミアムで解放されていない写真は保存できません」
- `photoSchema.locked` は常に返す（タイムラインの写真は `false`）。`url` は nullable
- 猶予の起点が 0節 #11 のどれにも当てはまらない形（未知の `source`・`updated_at` 無し）は鍵なし（T1 に固定）。実データで当てはまらない行は見つけていない

## A へ

- `docs/architecture.md` 5節の `couple.get`（`planState`）と `photo.list`（`url` nullable・`locked`）の行は A
- `docs/legal/tokushoho-draft.md` 末尾のメモ「047 が入るまでは〜に書き換えて公開し、047 のあとで戻す」は済んだ（草案は A の文書なので触っていない）

## 停止条件の確認

- 先頭 30 の id は `ORDER BY taken_at, id LIMIT 30` の 1 文（パラメータは `couple_id` と 30 の 2 つ）
- 「猶予 30 日」「古い順 30 枚」は変えていない
