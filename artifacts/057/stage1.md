# 057: 運営の画面（数と、プランの切り替え）— 実装の報告

2026-09-16 / セッションB。タスク定義 `docs/tasks/057-admin.md`（main f6e14d6）。

## 変えたもの

| 場所 | 何を |
|---|---|
| `packages/db/src/schema/admin.ts`・`migrations/0025_admin_actions.sql` | `admin_actions`（`id`〈ULID〉・`admin_user_id`・`action`・`couple_id`・`detail`〈JSON〉・`created_at`）。**FK 無し**（退会しても残す。0節 #10）。`created_at` の索引 1 つ。drizzle-kit で生成して名前だけ役割に |
| `packages/contract/src/admin.ts` | `admin.stats`・`admin.lookup`・`admin.setPlan`・`admin.actions`（1 節の形）。`couple.get` に `isAdmin` |
| `apps/api/src/lib/admin-emails.ts` | `parseAdminEmails`（カンマ区切り・小文字化・trim）・`isAdminEmail` |
| `apps/api/src/middleware/auth-context.ts` | **`resolveIsAdmin(context)` の 1 箇所**（認証済み + メールが `ADMIN_EMAILS` に含まれる。ゲスト false） |
| `apps/api/src/procedures/base.ts` | `adminProcedure`（`resolveIsAdmin` でなければ FORBIDDEN）。`admin.*` の 4 つ全部に `.use()` |
| `apps/api/src/procedures/admin.ts`（新規） | `computeStats`（5 つを `db.batch` の 6 文で。デモを除く。今日 = JST 0:00 から、7 日平均 = 今日を含まない直近 7 日 ÷ 7。paid は `couple_plans` を読んで `resolvePlan`）・`loadStats`（1 分キャッシュ。`billing.prices` と同じ作法）・`lookup`（完全一致。数とプランの行だけ）・`setPlan`（`source='stripe'` は CONFLICT。upsert + `admin_actions` + Worker のログ 1 行）・`actions`（新しい順。最大 50） |
| `apps/api/src/index.ts`・`context.ts` | `ADMIN_EMAILS` を `parseAdminEmails` で `context.adminEmails` に（optional。無ければ運営はいない） |
| `apps/app/app/(tabs)/admin.tsx`（新規） | `/app/admin`（`href: null`）。見出し + 運営のメール / 全体の数 5 つ / メールで探す → 利用者の箱・ペアの箱・「プレミアムにする」／「無料に戻す」（`source='stripe'` なら「Stripe で管理（Portal）」）→ 確認のシート（`danger` 無し）/ 直近の操作。運営でなければ「この画面は見られません」 |
| `apps/app/app/(tabs)/profile.tsx`・`_layout.tsx` | `isAdmin` のときだけ一番下に「運営 ›」 |
| `.github/workflows/ci.yml`・`deploy.yml` | CI の `.dev.vars` に `ADMIN_EMAILS=ci-admin@example.com`（ダミー） |

## テスト

| # | 何を | どこで | 結果 |
|---|---|---|---|
| T1 | 含まれないメールの認証済み・ゲスト・`ADMIN_EMAILS` 無し → 4 つとも FORBIDDEN。含まれるメール（`ADMIN_EMAILS` 側は大文字・前後の空白、`user.email` 側も大文字・空白）→ 通る。`parseAdminEmails`/`isAdminEmail` | `apps/api/test/admin.test.ts` | 緑 |
| T2 | `statsWindows` の JST の境目（0:00 ちょうど・1 秒前）。`computeStats`: 今日 1 ペア・週の中 1・週の外 1・デモ 1（除く）・paid（今日 1・週 1・期限切れ・デモ）・投稿（削除済みは除く）・画像（投稿 + アルバム）で 5 つの `total/today/avg7d` の差分が正しい。1 分キャッシュ | 同上 | 緑 |
| T3 | `lookup` の返す形をキーで固定（`user`: email/createdAt/posts/postImages、`couple`: 10 個）。本文・名前・`https://` が JSON に無い | 同上 | 緑 |
| T4 | free → paid（`source='manual'`・`expires_at NULL`）・paid → free（`updated_at` が今 = 047 の猶予の起点で `lockAt` あり）・`admin_actions` に 1 行ずつ（新しい順・`detail` の前後）・`limit` 50 まで。`source='stripe'` は CONFLICT で行も記録も変わらない。無いペアは NOT_FOUND | 同上 | 緑 |
| T5 | `couple.get.isAdmin`: 運営 true・他 false・ゲスト false | 同上 | 緑 |
| T6 | 別ペアの数を混ぜない（A の投稿 2・画像 6・アルバム 1 と B の 4・9 が分かれる。相手から探しても同じペア） | 同上 | 緑 |
| T7 | 画面: 運営でなければ「この画面は見られません」で `admin.*` を呼ばない。全体の数 5 つ・探す（trim）→ 箱 → 「プレミアムにする」→ 確認の文言 → 「変更」→ `setPlan` → プラン表示・通知・直近の操作。`stripe` はボタン無し。見つからない・未所属。マイページの「運営 ›」の有無と `/admin` | `apps/app/test/admin-screen.test.tsx` `profile-screen.test.tsx` | 緑 |
| T8 | `admin_actions` の列・FK 無し・索引（`schema-integrity.test.ts`。**`packages/db` ではなく `apps/api`**: マイグレーションの実体を見るテストはここにある）。記録のあとにペア・利用者・運営の行を消しても記録は残り、`adminEmail` は退会なら null。`me.delete` の全表の網（`me.test.ts`）は `admin_actions` を「残す」側に登録 | `apps/api` | 緑 |

`authorization.test.ts` の許可リストに `admin.*` を足し、**`admin.*` は `adminProcedure` を必ず経由する**検査も足した。
`pnpm lint`・`pnpm type-check`・`pnpm test`（api 749・app 588・db 32・date 67・ui 16）すべて緑。`pnpm db:generate` は差分なし。

## 画面（`artifacts/057/stage1/`。390×844・両モード。`scripts/capture.mjs`）

| ファイル | 何 |
|---|---|
| `{pink,white}-profile-admin-link.png` | マイページの「運営 ›」 |
| `{pink,white}-admin-stats.png` | 全体の数 5 つ（数・今日・7 日平均） |
| `{pink,white}-admin-lookup.png` | 探した結果（利用者の箱・ペアの箱・ボタン） |
| `{pink,white}-admin-lookup-stripe.png` | `source='stripe'` のペア（ボタン無し・「Stripe で管理（Portal）」） |
| `{pink,white}-admin-confirm.png` | 確認のシート |
| `{pink,white}-admin-actions.png` | 切り替え後（プランの表示が変わり、直近の操作に 1 行） |
| `capture.json` | 各画面の文言 |

ローカルの運営は 045 の撮影用ペア（`shot-me@example.com`。`.dev.vars` の `ADMIN_EMAILS`）。探したのは同じペアの相手。

## B が決めたこと

- `admin_actions.id` は ULID（同じ秒の 2 件でも「新しい順」が崩れない）
- `lookup` のメールは trim だけ（大文字小文字はそのまま完全一致。Google のメールは小文字）
- 利用者数は `user` からデモペアの利用者を除く（`couple_members` 経由）。paid の「今日の増加」は `updated_at`（0節 #5 の近似）
- 画面の切り替え後は探し直して今の行を出す（`lookup` を再実行）。通知「プレミアムにしました」「無料に戻しました」
- 運営でない人が `/app/admin` を開いた場合の 1 行「この画面は見られません」+「マイページへ」（定義に無い。URL を知っていても `admin.*` は FORBIDDEN）

## A へ（起票）

- `docs/architecture.md` 4節（`admin_actions`）・5節（`admin.*`・`couple.get.isAdmin`）は A
- 4節 T8 の「どこで」は `packages/db` とあるが、マイグレーションの実体を見るテストは `apps/api/test/schema-integrity.test.ts`（045・048 と同じ）

## 人間の手番（3 節）

- **マージ前**: `wrangler secret put ADMIN_EMAILS`（自分のメール。B は書かない）
- デプロイ後: `/app/admin` で自分を探し、free → paid（今の本番は paid なので free に戻して 30 秒以内に paid に）→ `admin_actions` に残るのを見る

## 停止条件の確認

- `computeStats` は `db.batch` の 6 文（テストでは数十ミリ秒）。キャッシュは 1 分のまま
- 数以外を出したいとは思わなかった
