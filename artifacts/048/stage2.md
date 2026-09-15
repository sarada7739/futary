# 048 段階2: 決済（Stripe） — 実装の報告

2026-09-15 / セッションB。タスク定義 `docs/tasks/048-premium-payment.md` 3節（A が 7cd0a74 で nisoine.com に合わせた版）。
人間の段階0: Stripe アカウント（サンドボックス）・商品「Nisoine プレミアム」・価格 2 つ（月 ¥420・年 ¥4,200。Price ID を B へ）。鍵は人間が `.dev.vars`（ローカル）に。本番の secret 2 つと Portal の有効化・Webhook の登録はマージ前の人間の手番（下）。

## 変えたもの

| 場所 | 何を |
|---|---|
| `packages/db` 0024 `couple_plans_stripe` | `stripe_customer_id`・`stripe_subscription_id`（text）・**`stripe_cancel_at`**（integer。定義に無い。下「B が決めたこと」） |
| `packages/contract/src/billing.ts`（新規） | `billing.prices`（入力無し。ゲストも）・`createCheckoutSession({ interval })`（CONFLICT）・`createPortalSession({})`（NOT_FOUND）。`BILLING_INTERVALS`・`PAID_ALBUM_PHOTO_LIMIT = 50_000`（文言用） |
| `couple.get` の出力 | `planSource`（manual / stripe / null）・`planExpiresAt`・**`planCancelAt`**（秒 / null）を足した（A 受け入れ） |
| `apps/api/src/lib/stripe.ts`（新規） | `StripeGateway`（SDK の窓口。手続きと Webhook はこれだけを見る。テストは偽物を context に）。`stripe` npm（22.6.2）を `createFetchHttpClient` で。Checkout は `managed_payments.enabled=false`（下）。`current_period_end` は items から（2025-03 以降の API）。`cancelAt` は `subscription.cancel_at`（Portal の「期間の終わりで解約」は今この形。`cancel_at_period_end` は false のまま。実測） |
| `apps/api/src/lib/billing.ts`（新規） | `planFromStatus`（active/trialing/past_due → paid、他 → free）・`applySubscriptionSnapshot`（UPSERT。manual は書かない。`expires_at` は `COALESCE` で残す）・`loadPrices`（1 時間キャッシュ） |
| `apps/api/src/procedures/billing.ts`（新規） | `createCheckoutSession`: paid なら CONFLICT。customer が無ければ作って**先に** free/stripe の行を保存。`success_url`/`cancel_url` は `BETTER_AUTH_URL` から。`createPortalSession`: 自分のペアの行の customer だけ |
| `apps/api/src/stripe-webhook.ts`（新規） | `POST /api/stripe/webhook`（Hono に直接。CORS・セッションの前）。生ボディで署名。6 種の event。**どれでも Stripe に読み直して upsert**。購読 id が無ければ customer の一番新しい購読。失敗は例外 → 500（Stripe が再送） |
| `apps/api/src/index.ts` | `Bindings` に `STRIPE_*` 4 つ。`buildBilling(env)`（鍵か Price ID か `BETTER_AUTH_URL` が無ければ undefined → billing.* は 500、他は無関係）。`RpcContext.billing?`（optional。16 のテストが context を手で組むため） |
| `me.delete` | 購読が付いていれば**先に解約**。失敗したら退会を止める（P8） |
| `apps/api/wrangler.toml` | `[vars]` に `STRIPE_PRICE_MONTHLY` / `_YEARLY`（サンドボックスの ID。本番の鍵に替えるとき本番の Price ID に） |
| `.github/workflows/ci.yml`・`deploy.yml`・`.dev.vars.example` | テスト用のダミーの `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` |
| `apps/app/app/(tabs)/premium.tsx` | 月額／年額・価格（Stripe から）・「プレミアムを始める →」（`window.location.assign`）・「いつでも解約できます・自動更新」・特商法/規約のリンク。paid: 「プレミアムです」+「プランを管理」（stripe のときだけ）+ 解約済みなら「（10月15日まで）」。ゲスト: 「ログインして始める」。`?status=success`: 3 秒ごと最大 30 秒 |
| `apps/app/app/(tabs)/profile.tsx` | 「プラン: プレミアム（10月15日に更新）」/ 解約済み「（10月15日まで）」+「プランを管理 ›」 |
| `apps/app/lib/plan.ts`・`components/legal-links.tsx`・`packages/date`（`formatJstMonthDayJa`） | 文言の補助。法務リンクに `/tokushoho` |
| `apps/app/lib/releases.ts` | 3.1.0「プレミアムプランを始めました」（`/premium`。日付は仮に 09-15。マージ日に直す） |
| `apps/landing/tokushoho.html`（新規）・`terms.html`・`index/privacy` のフッター・`sitemap.xml`・`build-public.mjs` | 特商法の表記。規約に 8 節を挿して 8〜11。**「解約後のデータ」は 047 まで「新しく追加できなくなります」**（A 受け入れ。`stage2/p7b-text.txt` で草案との差が その 2 箇所だけと確認） |

## 実測で見つけて直したこと

- **Stripe の新しいアカウントは Managed Payments（Stripe が販売者として税務を代行）が既定オン**で、商品に税コードが無い Checkout を 400 で拒む。Checkout の作成に `managed_payments: { enabled: false }` を明示（日本の個人が日本向けに税込で売るだけ。Stripe Tax も「手動」）。ダッシュボードの既定に頼らない
- **Portal の「期間の終わりで解約」は `cancel_at`（終了日時）で表され、`status` は `active` のまま・`cancel_at_period_end` は false**。paid の判定は変えず（期限まで paid が正しい）、画面の「〇月〇日に更新」が嘘になるので `stripe_cancel_at` を持って「〇月〇日まで」を出す
- `viewer-key-coverage`（T9）: 価格のクエリにも `viewerKey` を含めた（免除を増やさない）
- 認可の許可リスト: `billing.prices` は基底を経由しない（`health.get`・`me.get` と同じ理由）。`authorization.test.ts` に理由つきで足した

## B が決めたこと（A へ）

- `stripe_cancel_at` の列と `planCancelAt`（上）。定義に無い。「解約したのに『更新』と出る」を避けるため
- `RpcContext.billing` は optional（無ければ billing.* が 500。他の手続きは影響なし）
- 旧ホスト（`*.workers.dev`）への Webhook は 053 の 403 になる。Stripe には `https://nisoine.com/api/stripe/webhook` だけを登録する
- 価格の 1 時間キャッシュは isolate ごと。Price ID を差し替えたデプロイで自然に消える
- 3.1.0 の日付はマージ日に合わせて直す

## テスト

| # | どこ | 結果 |
|---|---|---|
| P1 | `apps/api/test/billing.test.ts` 7 件 | 署名違い・無し・改ざん → 400 で書かない。正しければ `retrieve` の状態で upsert、同じ event 2 回で同じ行。checkout/invoice の形からも辿る。購読 id 無しは customer の最新。見ない種類は 200 無視。読み直し失敗は例外（500）。`app.fetch` 経由の本物の gateway で 400 / 設定無しで 404 |
| P2 | 同 5 件 | active → paid/期限。canceled → free で期限は残る。past_due → paid。期限が取れなければ既存を保つ。**期間の終わりで解約 → paid のまま `stripe_cancel_at`、取り消しで NULL**。`couple.get` の 3 項目 |
| P3 | 同 3 件 | manual の paid/free は触らない（`skipped_manual`）。couple_id の無い customer は書かない |
| P4 | 同 5 件 | customer を先に保存。`metadata` に couple_id だけ（名前・メール無し）。year は年額の Price。paid（manual/stripe）は CONFLICT。期限切れ paid は通る。ゲスト FORBIDDEN・未所属 NEEDS_ONBOARDING。設定無しは 500 |
| P5 | 同 3 件 | customer 無し・manual は NOT_FOUND。自分のペアの customer で `return_url=/app/profile`。他ペアの customer には辿れない |
| P6 | `apps/app/test/premium-screen.test.tsx` 15 件 | free（価格・切り替え・Checkout へ・CONFLICT の文言・価格失敗）・paid（stripe: 管理 / manual: 無し / 解約済み: まで）・ゲスト・`?status=success`（3 秒後に paid → 「なりました」・30 秒で timeout・status 無し） |
| P7 | 同 | 「トライアル」「お試し」「無制限」無し。特商法・規約のリンク（プライバシーは出さない） |
| P7b | `canonical-host.test.ts` 2 件・`stage2/p7b-text.txt` | `/tokushoho` 200・価格の行・「【」無し。`terms.html` の見出し 1〜11・8 節。草案との文面の差は「解約後のデータ」2 箇所だけ |
| P8 | `billing.test.ts` 3 件 | 購読が生きていれば解約してから消す。解約失敗で退会を止める。購読無しは Stripe を呼ばない |
| P9 | `schema-integrity.test.ts` | 3 列（型・NULL 可・索引無し） |
| マイページ | `profile-screen.test.tsx` 3 件 | 「（10月15日に更新）」+ 管理 → Portal。「（10月15日まで）」。manual は表示だけ |
| 実機 | **`stage2/local-loop.txt`** | サンドボックスで一周: 申し込み → paid → Portal で解約（cancel_at）→ 「まで」→ 期限の代わりに即時解約 → free。年額の再申し込みも |

`pnpm lint`・`pnpm type-check`・`pnpm test` 緑（api 687・app 551・date 67・db 32・ui 16）。

## 人間の手番（マージ前。B から値を示す）

| # | 何 |
|---|---|
| 1 | Stripe「開発者」→「Webhook」でエンドポイント `https://nisoine.com/api/stripe/webhook` を作る。event は `checkout.session.completed`・`customer.subscription.created/updated/deleted`・`invoice.paid`・`invoice.payment_failed`。発行された `whsec_…` を `cd apps/api && npx wrangler secret put STRIPE_WEBHOOK_SECRET` |
| 2 | `cd apps/api && npx wrangler secret put STRIPE_SECRET_KEY`（**まずサンドボックスの `sk_test_`**。本番の鍵は特商法のページを公開してから） |
| 3 | 「設定」→「Billing」→「カスタマーポータル」で「サブスクリプションのキャンセル」を許可（ローカルでは既に解約できたので済んでいる可能性が高い） |
| 4 | デプロイ後: 本番の `https://nisoine.com/app/premium` でサンドボックスの鍵のまま 1 回申し込む → paid → Portal で解約（本番の Webhook が届くことの確認。ローカルでは B が代わりに届けた） |
| 5 | 本番の鍵に替えるとき: 本番モードで商品・価格を作り直し（サンドボックスと本番は別）、`wrangler.toml` の Price ID を差し替え（B の PR）、`STRIPE_SECRET_KEY`・`STRIPE_WEBHOOK_SECRET` を本番のものに、本番の Webhook エンドポイントも作る。Stripe の本人確認（銀行口座等）を済ませる |
