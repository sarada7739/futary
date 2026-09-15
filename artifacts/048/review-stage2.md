# 048 段階2（PR #378）— R の判定

futary-R で 3da2e7e を checkout して実行した。`.dev.vars` は CI と同じダミー（STRIPE の 2 つも）。**api 687・app 551・date 67・db 32・ui 16 全部緑**。`tsc --noEmit` 緑・`eslint .` 緑。CI pass。`stripe@22.6.2` の integrity は npm と一致。lockfile に増えた package は `stripe` だけ（expo-router の snapshot の鍵が付け直されているが版は同じ）。`worklog.md` は追記のみ。触ったものは戻した。

**判定: 差し戻し。必須修正 1。**

## 必須修正

### 1. 行に付いた購読と違う購読の snapshot の扱い（0節 #9 の後半が無い）

定義 0節 #9: 「Webhook で 2 本目の購読が来たら**古い方を Stripe で解約**（`subscriptions.cancel`）してログ」。`stripe-webhook.ts`・`lib/billing.ts` にこの処理は無く、テストも無い（`grep cancel` で当たらない）。`createCheckoutSession` の CONFLICT は「同時に 2 人が押す」を防げない（両方 free の時点で通る）ので、定義はこの後半で受けている。

同じ根で、**古い購読の event が遅れて届くと、新しい paid の行を free に落とす**。使い捨てのテストで再現した（削除済み）:
```
sub_2（active, 期限 NOW+100）を apply → paid / sub_2
sub_1（canceled, 期限 NOW-5）を apply → **free / sub_1**   ← 払っているのに free
```
起きる経路: sub_1 の `customer.subscription.deleted` を 500 で落として Stripe が再送待ち（数時間〜3 日）の間に利用者が sub_2 を申し込む。`local-loop.txt` の #9（再申し込み）は同じ customer に 2 本目の購読を作る形なので、この経路は本番で成立する。「どの event でも Stripe に読み直すので順序に依存しない」は **同じ購読の中**でしか成り立たない。

直し方は A の判断。私の案（`applySubscriptionSnapshot` の 1 箇所で済む）:
- 既存の行の `stripe_subscription_id` が有って snapshot の `id` と違うとき:
  - snapshot が paid（active/trialing/past_due）→ 2 本目。**行の購読が Stripe でまだ生きていれば `cancelSubscription`（0節 #9）してログ**、新しい方を書く
  - snapshot が paid でない → 行の購読とは別のものが終わっただけ。**書かない**（`skipped_other_subscription` をログ）。行の購読の状態は行の購読自身の event で来る
- テスト: (a) 2 本目 active → 古い方が `canceled` に呼ばれ、行は新しい方 (b) 古い方の canceled が遅れて来ても行は paid のまま (c) 行の購読自身の canceled は free になる（今の P2）
（`applySubscriptionSnapshot` が gateway を呼ぶ形になる。嫌なら Webhook 側で `latestSubscriptionOf(customerId)` を常に真とする案もあるが、2 本目の解約は結局要る）

## 壊して確かめたこと（`billing.test.ts` 31 本）

| 壊し方 | 赤 |
|---|---|
| manual の行も上書き | 1 本（P3） |
| `past_due` を free に | 2 本（P2） |
| free になるとき `expires_at` を消す | 1 本（P2） |
| 署名を確かめない | 2 本（P1） |
| paid でも Checkout を作る | 1 本（P4） |
| customer の行を先に保存しない | 3 本（P4） |
| 退会で解約しない | 2 本（P8） |
| **本物の gateway の `customers.create` の metadata に名前を足す** | **緑**（記録 1） |

## 読んで確かめたこと

- Webhook: Hono 直・`/api/*` の CORS の後・Better Auth と RPC の context の前に `app.post`。生ボディ → `constructEventAsync`（`createSubtleCryptoProvider`）→ 6 種以外は 200 で無視 → 購読 id（無ければ customer の最新）を Stripe に読み直し → upsert。失敗は例外（500）。ログは種類と couple_id の先頭 8 文字。旧ホストは 053 の 403（Stripe には nisoine.com だけ登録）
- `planFromStatus`・`expires_at` の COALESCE・manual の skip・`skipped_no_couple`。冪等（UPSERT）
- `createCheckoutSession`: `writeProcedure`・paid なら CONFLICT・customer を作ったら**先に** free/stripe で保存・URL は `BETTER_AUTH_URL` から・`metadata` は couple_id だけ。`managed_payments.enabled=false` は `local-loop.txt` #1→#2 で効いたことが見える
- `createPortalSession`: 自分のペアの行の customer だけ・無ければ NOT_FOUND
- `me.delete`（P8）: 購読があれば先に `cancelSubscription`（既に canceled なら何もしない）。失敗で退会を止める。Stripe 未設定で購読の行があれば止める
- `couple.get`: `planSource`（未知は null）・`planExpiresAt`・`planCancelAt`
- 0024: 3 列とも NULL 可・索引無し（P9）。`schema/couple.ts` と一致
- `/tokushoho`・`terms.html` 8 節（1〜11）: `check-text.py` を自分で走らせて草案との差は「解約後のデータ」の 2 箇所だけ（A 受け入れ済み）。「【」0。`premium.tsx`・`plan.ts`・2 ページに「トライアル」「無制限」無し
- 価格: `¥${amount.toLocaleString("ja-JP")}`（JPY は最小単位が円。¥4,200）。`?status=success` は `refetchInterval` 3 秒・30 秒で止める
- `wrangler.toml` の Price ID はサンドボックス（秘密ではない）。本番に替える手順は報告の表 #5

## 記録（判定に使わない）

1. P4「Stripe に渡す metadata に couple_id 以外の個人情報が無い」は**偽の gateway の入口**で見ている。本物の `createStripeGateway` が SDK に渡す引数は検査の外（gateway が境界なので設計どおり）。`local-loop.txt` の「名前またはメールアドレスが入力されていません」が実体の根拠。十分だが、位置は知っておく
2. **退会しても Stripe の customer は残る**（Checkout で利用者が入れたメールが customer に付く）。定義に無い。消すなら `me.delete` で `customers.del`（購読の解約の後）。プライバシーポリシー 6 節「退会で消える」との整合は A の判断
3. `premium.tsx` の「しばらくしてからお試しください」は「トライアル」の意味ではない（P7 の対象外）。記録だけ
4. `RpcContext.billing` optional・価格キャッシュは isolate ごと（B の報告どおり）。問題ない

## 私が確かめていないこと

- 本番の Webhook が届くこと（人間の手番 #4）・Portal の解約許可・本番の鍵への切り替え
- 画面（`premium-screen.test.tsx` 15・`profile-screen.test.tsx` 3 は緑を見た。スクリーンショットは無い）

## 追加コミット d1fdb23（必須修正 1）— R の判定

futary-R で d1fdb23 を checkout して実行した。api 692 緑・`tsc --noEmit` 緑・`eslint .` 緑。差分は `lib/billing.ts`（`applySubscriptionSnapshot` に gateway と log）・`stripe-webhook.ts`（引数）・P2b 5 本・証跡・worklog（追記のみ）。

**受け入れ。必須修正 1 は閉じた。**

- 段階1の判定で再現に使った使い捨てのテストを直した版で再実行: sub_2 active のあとに sub_1 canceled が遅れて来ても **paid / sub_2 のまま**（`skipped_other_subscription`。解約は呼ばない）。続けて sub_3 active が来ると **sub_2 を解約して差し替え**（`written_replaced_subscription`。0節 #9 の後半）。削除済み
- 壊して確かめた: 古い方を解約しない → 3 本赤、paid でなくても書く → 1 本赤、解約の失敗を握りつぶす → 1 本赤（P2b の (a)(b)(d) が拾う）
- 読んで: 2 本目の解約で Stripe が出す古い方の `customer.subscription.deleted` は、行が新しい方なので `skipped_other_subscription` で落ちる（自分の解約で自分を free にしない）。再申し込み（`local-loop.txt` #9 の形。行の購読が既に canceled）は本物の gateway の `cancelSubscription` が「既に canceled なら何もしない」ので no-op で差し替わる。購読の無い行（Checkout 直後の free/stripe）は `current` が null なのでそのまま書く（(e)）。manual の skip は先に見る（順序は変わっていない）

### 記録（判定に使わない）

- 再申し込みの差し替えでも log は「canceled sub_1」と出る（実際は既に canceled で no-op）。読む人が「ここで解約した」と誤読しうる。文言だけ。任意
