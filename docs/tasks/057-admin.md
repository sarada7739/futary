# 057: 運営の画面（数と、プランの切り替え）

## 目的

**人間の指示（2026-09-16）。運営（人間）が、全体の数と、メールで探した個人・ペアの数を見て、ペアのプランを手で切り替えられる画面。**
今は `wrangler d1 execute` の SQL でやっている（045 の 0節 #8）。

**線を 1 本引く: 運営の画面は、ペアの中身（投稿の本文・写真・名前・記念日）に触れない。数と、プランの 1 行だけ。**
他ペアのデータに触れる経路を作らない、という芯（CLAUDE.md・`security-requirements.md` 3節）は保つ。
運営の権限が盗まれても、起きる最悪は「誰かのプランが変わる」で、中身は漏れない。

## 0. 決めたこと（A）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | 誰が運営か | **`ADMIN_EMAILS`**（`wrangler secret`。カンマ区切りのメール。ローカルは `.dev.vars`）。認証済みの利用者のメールが含まれていれば `ctx.isAdmin = true`。**判定は認可ミドルウェアの 1 箇所**（`ctx.coupleId` と同じ作法） | コードにメールを書かない。運営を足すのは secret の更新だけ |
| 2 | 運営の手続き | **`admin.*`** の名前空間。**全部 `ctx.isAdmin` でなければ `FORBIDDEN`**（存在を教えない形に寄せるなら `NOT_FOUND` でもよいが、運営以外が名前を知っても害が無いので `FORBIDDEN`）。ゲストは当然 `FORBIDDEN` | 認可を手続きごとに書かず、`admin` ルーターの入口で 1 度 |
| 3 | 場所 | **`/app/admin`**（`(tabs)` の外。`href: null`。タブに出さない）。マイページの一番下に、`isAdmin` のときだけ「運営 ›」の 1 行 | 運営以外には入口が見えない。URL を知っていても `admin.*` が `FORBIDDEN` |
| 4 | 全体の数 | **ペア数・利用者数・paid のペア数・投稿数・画像数**の 5 つ。それぞれに **今日の増加（JST 0:00 から）** と **過去 7 日の 1 日平均**（今日を含まない直近 7 日の増加 ÷ 7。小数 1 桁） | 今の勢いと平均。片方だと読み違える |
| 5 | 数え方 | ペア数 = `couples`（`is_demo = 0`）。利用者数 = `user`。paid = `resolvePlan` が paid のペア（`couple_plans` を全件読んで判定。行数は少ない）。投稿数 = `posts`（`deleted_at IS NULL`）。画像数 = `post_images`（親が未削除）+ `album_photos`。**増加は `created_at`**（`post_images` は `posts.created_at`・利用者は `user.createdAt`・paid は `couple_plans.updated_at` で「paid になった／更新された」の近似） | 「今ある数」で揃える。消したものは数えない |
| 6 | デモペア | **全体の数から除く**（`is_demo = 1` とその利用者・投稿・写真）。運営のペアは含める | デモは利用者ではない |
| 7 | メールで探す | **完全一致で 1 人**。返すのは: 利用者（メール・登録日・投稿数・投稿の写真の数）・ペア（有無・作成日・人数・プラン・出どころ・期限・`stripe_customer_id` の有無・投稿数・画像数〈投稿 + アルバム〉・アルバム数）。**名前・本文・写真・記念日は返さない** | 数と、プランの行だけ。個人の画像数は投稿の写真だけ（`album_photos` に誰が入れたかの列が無い。列は足さない） |
| 8 | 切り替え | **paid にする ／ free に戻す**。`couple_plans` に `source='manual'` の行を upsert（paid: `expires_at = NULL`。free: `plan='free'`、`updated_at` を今に。047 の猶予の起点） | 今の SQL と同じ行 |
| 9 | Stripe のペア | **触れない。**行の `source='stripe'` なら、ボタンを出さず「Stripe で管理（Portal）」の 1 行。運営は Stripe のダッシュボードで | 手で書くと Webhook と食い違う（048 の「manual の行は Webhook が書かない」の裏返し） |
| 10 | 記録 | **新しい表 `admin_actions`**（`id`・`admin_user_id`・`action`（`plan.set`）・`couple_id`・`detail`（JSON: 前後のプラン）・`created_at`）。**全部の切り替えを書く。消す手続きは作らない**。画面の下に直近 20 件 | 誰が・いつ・何をしたか。手で戻せる |
| 11 | 数の重さ | 全体の数は **1 分キャッシュ**（Worker のメモリ。`billing.prices` と同じ作法）。**Cron・集計表は持たない** | 利用者が数千までは COUNT で足りる。重くなってから |
| 12 | やらないこと | ペアの一覧・検索の部分一致・中身の閲覧・投稿の削除・退会・凍結・招待コードの操作・メール送信 | 線の外。必要になる問題（通報・不正）がまだ起きていない |
| 13 | レート制限 | `admin.*` は既存の認証済みの制限のまま。追加しない | 運営 1 人 |
| 14 | リリース履歴 | 入れない | 利用者に見えない |
| 15 | ログ | `admin.setPlan` の実行を Worker のログにも 1 行（`admin_actions` の id と `couple_id` の先頭だけ。メールは書かない。`security-requirements.md` 8節） | D1 が壊れても痕跡が残る |

## 1. API（`admin.*`。全部 `ctx.isAdmin` 必須）

```
admin.stats        {} -> { couples, users, paidCouples, posts, images: { total, today, avg7d: number } … 5 つとも同じ形 }
admin.lookup       { email } -> { user: { email, createdAt, posts, postImages } | null,
                                  couple: { id, createdAt, members, plan: "free"|"paid", source: "manual"|"stripe"|null,
                                            expiresAt, hasStripeCustomer, posts, images, albums } | null }
admin.setPlan      { coupleId, plan: "free"|"paid" } -> { plan }   // source='stripe' の行があれば CONFLICT
admin.actions      { limit? } -> { items: [{ id, adminEmail, action, coupleId, detail, createdAt }] }（新しい順。最大 50）
```

- `couple.get` に **`isAdmin: boolean`** を足す（マイページの「運営 ›」の出し分け）。ゲストは false
- `admin.lookup` の `couple.id` は `setPlan` に渡すためだけ。画面には出さない（出しても害は無いが要らない）

## 2. 画面 `/app/admin`

上から:

1. 「運営」の見出し + 運営のメール
2. 全体の数: 5 つのカード（数・「今日 +N」・「7 日平均 +N.N/日」）
3. メールで探す: 入力 + 「探す」→ 利用者の箱とペアの箱（1 節の項目を 1 行ずつ）。ペアの箱の下に **「プレミアムにする」／「無料に戻す」**（`source='stripe'` なら「Stripe で管理」の 1 行）。押すと確認（「〇〇（メール）のペアをプレミアムにします」→「変更」）。**`danger` は当てない**（戻せる）
4. 直近の操作 20 件（日時・操作・ペアの先頭 8 文字・前 → 後）

見つからなければ「見つかりません」の 1 行。ピンク／ホワイト両方。

## 3. 人間の手番

| いつ | 何 |
|---|---|
| B の PR のマージ前 | `wrangler secret put ADMIN_EMAILS`（自分のメール）の許可 |
| デプロイ後 | `/app/admin` で自分を探し、自分のペアを free → paid に切り替えて `admin_actions` に残るのを見る（今の本番は paid なので、free に戻して 30 秒以内に paid に戻す。047 の猶予は 30 日なので鍵は掛からない） |

## 4. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | `ADMIN_EMAILS` に無いメールの認証済み利用者・ゲスト → `admin.*` 全部 `FORBIDDEN`。含まれるメール → 通る。大文字小文字・前後の空白の違いで漏れない（小文字化・trim して比べる） | `apps/api` |
| T2 | `admin.stats`: デモペアと運営のペアを作り、デモが数に入らない。今日の増加と 7 日平均が `created_at` から正しく出る（JST の日付の境目を固定して） | `apps/api` |
| T3 | `admin.lookup`: 見つかる／見つからない。返す形に本文・名前・写真の URL が無い（キーを列挙して固定） | `apps/api` |
| T4 | `admin.setPlan`: free → paid で `couple_plans` に `source='manual', plan='paid', expires_at NULL`。paid → free で `plan='free'` と `updated_at` が今。`admin_actions` に 1 行ずつ。`source='stripe'` の行があれば `CONFLICT` で行も記録も変わらない | `apps/api` |
| T5 | `couple.get` の `isAdmin`: 運営 true・他 false・ゲスト false | `apps/api` |
| T6 | 別ペアの数を混ぜない（`lookup` のペアの投稿数が、そのペアの分だけ） | `apps/api` |
| T7 | 画面: 運営でないとマイページに「運営 ›」が無い。運営なら出て `/app/admin` が開く。探す → 切り替え → 確認 → 直近の操作に出る。`source='stripe'` のペアはボタンが無い | `apps/app` |
| T8 | マイグレーション: `admin_actions` の作成。`architecture.md` 4節「表を足したら、消す手順にも足す」（退会の手順は**触らない**。`admin_actions` は退会しても残す。`couple_id` は消えたペアの id のまま） | `packages/db` |

## 完了条件

- T1〜T8。`pnpm -r test`・型チェック・lint
- 3 節の人間の確認
- スクリーンショット（両モード × 全体の数・探した結果・確認のシート）
- `docs/architecture.md` 4節（`admin_actions`）・5節（`admin.*`・`couple.get` の `isAdmin`）・8節（`ADMIN_EMAILS`）・`security-requirements.md` 3節（運営の認可）は **A が直す**。B は起票
- `state.md` / `worklog.md`

## 停止条件

- `admin.stats` の COUNT が D1 の 1 リクエストの時間に収まらない → 1 分キャッシュを 10 分に伸ばして `state.md` に書く。集計表は作らない（A に聞かない）
- 「数以外を出したい」と思った → 出さず A へ（線の話）
- レビュー往復 3 回 → A へ

## 順序

056 の後。iOS・メール認証の前（人間の指示）。
