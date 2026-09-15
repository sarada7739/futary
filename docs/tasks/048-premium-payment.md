# 048: プレミアム（ZIP で持ち出し + 決済）

## 目的

**人間の指示。プレミアムを売る。ZIP での持ち出しと決済を 1 つのタスクで。段階2（決済）は人間の合図（2026-09-15「ドメイン登録したから決済機能つけていい？」）で着手。**

- **段階1: アルバムの写真を ZIP で持ち出す**（046 の中身をここに畳んだ。Stripe の準備を待つ間に進められる）
- **段階2: Stripe で申し込み・解約。`couple_plans` に行を書く**
- 価格（人間の決定。2026-09-14）: **¥420/月・¥4,200/年（10 か月分）**。**「無制限」とは書かず「写真 5 万枚まで」**（1 アルバム 500 枚 × 100 件 = 5 万枚。今の物理上限そのもの。普通の使い方では届かない）
- **無料トライアルは作らない**（人間の指示）

## 0. 先に決めたこと（A）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | 決済の相手 | **Stripe**（Checkout + Billing Portal + Webhook） | カード情報を一切触らない。Workers から `fetch` で呼べる。日本の手数料 3.6% |
| 2 | 誰が払うか | **ペア単位。どちらか 1 人が払えば 2 人ともプレミアム** | プランはペアの持ち物（045）。相手が既に払っていれば「プレミアムです」と出して申し込ませない |
| 3 | 何を真実とするか | **Webhook だけが `couple_plans` を書く。**画面や Checkout の戻り先で書かない | 戻り先は改ざんできる。Webhook は署名で確かめる |
| 4 | `expires_at` | Stripe の **`current_period_end`**。更新のたびに Webhook で伸びる。解約は「期間の終わりまで有効」（Stripe の `cancel_at_period_end`）で、期限が来れば free（045 の判定そのまま） | 047 の猶予 30 日はこの期限のあとに乗る |
| 5 | 解約・カード変更 | **Stripe の Billing Portal に任せる**（マイページの「プランを管理」で飛ぶ） | 自前で作らない |
| 6 | 価格の置き場 | 月額・年額の **Price ID を `wrangler.toml` の `[vars]`**（秘密ではない）。**金額は Stripe が真実**。画面の「¥420」は `billing.prices` で Stripe から取って出す（コードに書かない） | 値段を変えるのが Stripe のダッシュボードだけで済む |
| 7 | 事業者の表示 | 利用規約・プライバシーポリシーは 052 で公開済み（`/terms` `/privacy`）。**「特定商取引法に基づく表記」を `/tokushoho` に足す**（草案 `docs/legal/tokushoho-draft.md`。人間が確認）。**利用規約 8 節（プレミアム）を足して HTML を 8〜11 に振り直す**（草案は済み） | 無いと売れない（法律。Stripe の審査でも見られる） |
| 8 | 領収書・請求書 | Stripe のメール（Checkout の設定）に任せる | 自前で作らない |
| 9 | 二重の申し込み | Checkout を作る前に `resolvePlan` が paid なら **`CONFLICT`**。Webhook で**行の購読 id と違う購読**の snapshot が来たら: paid なら 2 本目 → 行の購読が生きていれば Stripe で解約（`subscriptions.cancel`）してログし、新しい方を書く。paid でなければ別の購読が終わっただけ → **書かない**（古い購読の event が遅れて届いても新しい paid の行を落とさない。R の指摘） | 同時に 2 人が押す形はある。event の順序に依存しない |
| 10 | Stripe の本番・テスト | **テストモードで全部通してから本番の鍵に替える**。鍵は `wrangler secret`（`.dev.vars` はテスト用） | 秘密の扱いは今までどおり |
| 11 | リリース履歴 | **入れる**（段階1: 2.2.0「アルバムの写真をまとめて持ち出せます」、段階2: **3.1.0**「プレミアムプランを始めました」。3.0.0 は 051（改名））。文言は 4節 | 利用者に見える |

## 1. 段階0（人間の手番。段階2の前に済ませる）

| # | 何 | 備考 |
|---|---|---|
| 1 | Stripe のアカウント（個人事業でよい）。**テストモード**で商品「futary プレミアム」と価格 2 つ（月 ¥420・年 ¥4,200。JPY・recurring） | Price ID（`price_…`）2 つを B に渡す |
| 2 | **特商法の表記の草案を確認**（`docs/legal/tokushoho-draft.md`。所在地・電話は「請求があれば開示」の形。屋号や住所を書くならそのとき） | 利用規約 8 節・プライバシーポリシーは A が済ませた |
| 3 | Webhook の署名の秘密（`whsec_…`）と API の秘密鍵（`sk_test_…`） | `wrangler secret put` は B が人間の許可を取って。ローカルは `.dev.vars` |
| 4 | Billing Portal を Stripe の設定で有効にする（解約・カード変更を許可） | ダッシュボードの操作 |

**2 が無い間は段階2をデプロイしない**（テストモードで動かすまではよい）。

## 2. 段階1: ZIP で持ち出す

### 方式

| | |
|---|---|
| どこで組むか | **ブラウザ**（`fetch` → `fflate` の `zipSync`、無圧縮 `level: 0`）。Worker は通さない（無料枠の CPU 10ms で CRC32 を全バイトに掛けられない） |
| ライブラリ | **`fflate`** を `apps/app` に足す（依存 0・約 8KB）。Expo Web のバンドルで動くことを先に確かめる |
| 1 つの ZIP の上限 | **100 枚**。超えるアルバムは 100 枚ずつ複数（`…-1of3.zip`）。iPhone の Safari で 100 枚（30〜60MB）が落ちないかは人間の iPhone で。落ちるなら 50 |
| 前提 | R2 の CORS（GET・アプリのオリジン）は 042 で確認済み。CSP の `connect-src` も済み |
| 中のファイル名 | 041 の `filename`（`futary-YYYYMMDD-{imageId}.jpg`）。**全部のときはアルバムごとのフォルダ**（アルバム名を安全な文字にしたもの）に分け、1 アルバムのときは直下。**説明文は `captions.txt` に 1 行 1 枚**（`{ZIP 内のパス}<TAB>{説明文}`。空でも行はある。説明文の改行・TAB は空白に。UTF-8） |
| ZIP の名前 | `futary-{アルバム名を安全な文字に}-{YYYYMMDD}.zip`。全部は `futary-albums-{YYYYMMDD}-1of3.zip`。**安全な文字**: `/ \ : * ? " < > |` と制御文字・TAB・改行を `_` に。**`.` だけの名前（`.` `..`）は `album` に倒す**（`../` のパスを ZIP に入れない）。空になったら `album` |
| iPhone | 「ファイル」に落ちる。**それでよい**（持ち出しが目的。写真ライブラリは 042 の共有シート） |

### 画面

| 場所 | 何 |
|---|---|
| アルバム詳細のヘッダー `⋯`（新設。編集・選択の隣） | **「ZIP で保存」** |
| アルバム一覧のヘッダー `⋯`（新設） | **「すべての写真を ZIP で保存」**（作ったアルバム全部。タイムラインは含めない） |
| マイページ | プランの行の下に **「アルバムの写真をまとめて保存」**（一覧の `⋯` と同じ）。047 の猶予の案内から飛ぶ先 |

- 確認: 「38 枚を ZIP で保存します（約 15MB）」→「保存」。概算は枚数 × 400KB
- 進捗「12 / 38 枚を取得中…」。途中で閉じられる（`AbortController`）
- 取れなかった枚は飛ばして続け、最後に「2 枚は保存できませんでした」
- 100 枚超は「3 つのファイルに分けて保存します」と先に出し、1 つずつ順に `<a download>`
- ゲストも押せる。`photo.list`（`limit` 60）で集め、`photo.downloadUrl` を枚数ぶん呼ぶ

### テスト（段階1）

| # | 何を | どこで |
|---|---|---|
| Z1 | ZIP の中身: 枚数・ファイル名・`captions.txt` の行数と対応（`unzipSync` で開く）。**無圧縮**: 縮む中身（同じバイトの繰り返し）でも ZIP の大きさ ≥ 中身の合計 | `apps/app` |
| Z1b | 題が `..`・`.`・TAB 入りのアルバムでも ZIP 内のパスに `../` が無く、`captions.txt` の区切りが壊れない | `apps/app` |
| Z2 | 101 枚 → 2 つ（100 + 1）。`-1of2` `-2of2` | `apps/app` |
| Z3 | 1 枚の `fetch` が失敗しても残りが入り、失敗数が出る | `apps/app` |
| Z4 | 途中で閉じると `fetch` が中断される | `apps/app` |
| Z5 | 全部のとき、タイムラインの写真が含まれない | `apps/app` |
| Z6 | `fflate` 以外の依存が増えていない | 目視 |

**段階1は単独で PR → R → マージ → デプロイ → 人間の iPhone・PC で 1 アルバムと全部**（100 枚が落ちるかも見る）。

## 3. 段階2: 決済

### データ

`couple_plans` に列を足す（マイグレーション）:

```sql
ALTER TABLE couple_plans ADD COLUMN stripe_customer_id     TEXT;   -- cus_…
ALTER TABLE couple_plans ADD COLUMN stripe_subscription_id TEXT;   -- sub_…。UNIQUE は張らない（同じ購読が 2 ペアに付く経路は無い）
```

`source = 'stripe'` の行を Webhook が書く。`manual` の行（運営のペア）は Webhook が触らない（`source` を見る）。
**`stripe_cancel_at INTEGER`** も持つ: Portal の「期間の終わりで解約」は今の Stripe では `subscription.cancel_at` で表され、`status` は `active` のまま・`cancel_at_period_end` は `false`。paid の判定は `expires_at` のまま（期限まで paid が正しい）。画面は `cancel_at` があれば「〇月〇日まで」、無ければ「〇月〇日に更新」。
**Checkout は `managed_payments.enabled = false` を明示する。**新しい Stripe アカウントは Managed Payments（Stripe が販売者として税務を代行）が既定でオンで、税コードの無い商品の Checkout を 400 で拒む。日本の個人が日本向けに税込で売るだけなので使わない。

### 契約

| 手続き | 種別 | 入力 | 出力 | 備考 |
|---|---|---|---|---|
| `billing.prices` | read | `{}` | `{ monthly: { amount, currency, priceId }, yearly: {...} }` | Stripe から取る（1 時間キャッシュ。Worker のメモリ）。ゲストも読める |
| `billing.createCheckoutSession` | write | `{ interval: "month" \| "year" }` | `{ url }` | 既に paid なら `CONFLICT`。`customer` はペアに 1 つ（`stripe_customer_id` が無ければ作って**先に `couple_plans` に `plan='free', source='stripe'` の行で保存**）。`metadata.couple_id`。`success_url` = `https://nisoine.com/app/premium?status=success`、`cancel_url` = `https://nisoine.com/app/premium`（`BETTER_AUTH_URL` から組む。直書きしない） |
| `billing.createPortalSession` | write | `{}` | `{ url }` | `stripe_customer_id` が無ければ `NOT_FOUND`。`return_url` = `https://nisoine.com/app/profile`（同上） |

- **どちらも `writeProcedure`**（ゲスト不可）。`couple_id` は ctx から。**Stripe に送るのは `couple_id` だけ**（名前・メールは送らない。領収書のメールは Checkout で利用者が入力する）

### Webhook `POST /api/stripe/webhook`

- oRPC の外（Hono に直接）。**生のボディで署名を確かめる**（`stripe.webhooks.constructEventAsync` + `createSubtleCryptoProvider`）。署名が違えば 400。**それ以外の認証は無い**（Stripe から来る）
- 見る event: `checkout.session.completed`・`customer.subscription.created/updated/deleted`・`invoice.paid`・`invoice.payment_failed`
- **どの event でも、購読の今の状態を Stripe に読み直して（`subscriptions.retrieve`）`couple_plans` を upsert する**（event の中身を信じず、順序に依存しない。同じ event が 2 回来ても結果が同じ）。`couple_id` は `customer` の `metadata` から
  - `status` が `active` / `trialing` → `plan='paid', expires_at=current_period_end`
  - `past_due` → paid のまま（`expires_at` が来れば free。Stripe の再試行に任せる）
  - `canceled` / `unpaid` / `incomplete_expired` → `plan='free'`（`expires_at` は残す。047 の猶予の起点）
- **`source='manual'` の行は書かない**（運営の判断が Stripe に上書きされない）
- 失敗（D1 が落ちた等）は 500 を返して Stripe に再送させる。**成功したら 200**。ログは event の種類と `couple_id` の先頭だけ（`security-requirements.md` 8節）

### 環境

| 名前 | 置き場 |
|---|---|
| `STRIPE_SECRET_KEY` | `wrangler secret`（ローカルは `.dev.vars`。テストの鍵） |
| `STRIPE_WEBHOOK_SECRET` | 同上 |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` | `wrangler.toml` の `[vars]`（秘密ではない） |
| `stripe` npm | `apps/api` に足す。**`Stripe.createFetchHttpClient()` で Workers から呼ぶ**（Node の `https` を使わない） |

### 画面

- **`/premium`**（045 の画面に足す）: 月額／年額の切り替え・価格（`billing.prices`）・「できること」（**「写真 5 万枚まで」「アルバムはいくつでも」**の 2 行。他は書かない）・**「プレミアムを始める →」**（→ Checkout の `url` へ `window.location.assign`）・「いつでも解約できます・自動更新」・下に「特定商取引法に基づく表記」「利用規約」へのリンク（ランディングのページ）。**既に paid なら「プレミアムです」と「プランを管理」（Portal）**。ゲストは価格を見られるがボタンは「ログインして始める」
- **`?status=success` で戻ったとき**: 「反映しています…」を出して `couple.get` を 3 秒ごとに読み直す（最大 30 秒）。paid になったら「プレミアムになりました」。ならなければ「少し時間がかかることがあります。マイページで確かめてください」（Webhook が遅れることはある）
- **マイページ**: 「プラン: プレミアム（〇月〇日に更新）」+ 「プランを管理 ›」（Portal）。free は 045 のまま
- **045 の上限シート**: 「プレミアムプランを見る ›」の先が本物になる。文言は変えない
- ランディング（`apps/landing`）: **`/tokushoho` を足す**（`tokushoho-draft.md` から。052 と同じ作り）。**`terms.html` に 8 節を足して 8〜11 に振り直す**（`terms-draft.md` どおり）。フッターと `/premium` にリンク。`sitemap.xml` に `/tokushoho`

### テスト（段階2）

| # | 何を | どこで |
|---|---|---|
| P1 | Webhook: 署名が違えば 400 で何も書かない。正しければ `subscriptions.retrieve`（モック）の状態で upsert。同じ event を 2 回 → 結果が同じ | `apps/api` |
| P2 | `active` → paid/`expires_at`。`canceled` → free で `expires_at` が残る。`past_due` → paid のまま | `apps/api` |
| P3 | `source='manual'` の行は Webhook が触らない | `apps/api` |
| P4 | `createCheckoutSession`: paid なら `CONFLICT`。ゲストは不可。Stripe に渡す `metadata` に `couple_id` 以外の個人情報が無い | `apps/api` |
| P5 | `createPortalSession`: `stripe_customer_id` 無しは `NOT_FOUND`。他ペアの customer で作れない | `apps/api` |
| P6 | 画面: free で価格とボタン・paid で「プランを管理」・ゲストで「ログインして始める」・`?status=success` の読み直し | `apps/app` |
| P7 | `/premium` に「トライアル」「無制限」の文字が無い。「特定商取引法に基づく表記」「利用規約」へのリンクがある | `apps/app` |
| P7b | `/tokushoho` が 200。`terms.html` に「8. プレミアム」があり節番号が 8〜11 | `apps/api` |
| P8 | `me.delete`: Stripe の購読が生きていれば**先に解約してから**行を消す（退会で課金が続かない）。解約に失敗したら退会を止めて `INTERNAL`（課金だけ残る形を作らない）。**そのあと `customers.del`**（Checkout で入れたメールを Stripe に残さない。プライバシーポリシー 4 節）。`customers.del` の失敗は退会を止めない（ログだけ。請求書・決済の記録は Stripe が法令上の保存のため残す） | `apps/api` |
| P8b | Webhook: 行の購読 id と違う購読の `canceled` が来ても paid の行を落とさない。違う購読の `active` が来たら古い方を `cancel` して新しい方を書く | `apps/api` |
| P9 | マイグレーションの実体とファイル | `packages/db` |

**テストモードで人間が 1 回申し込む → paid になる → Portal で解約 → 期限で free**、まで通してから本番の鍵に替える（人間の手番）。

## 4. リリース履歴

| version | title | items | route |
|---|---|---|---|
| 2.2.0（段階1） | アルバムの写真をまとめて持ち出せます | アルバムの写真を ZIP でまとめて保存できます / 説明文も一緒に入ります | `/album` |
| 3.1.0（段階2） | プレミアムプランを始めました | 写真を 5 万枚まで保存できます / 月額と年額から選べます | `/premium` |

## 5. やらないもの

| | 扱い |
|---|---|
| カード情報を自分で扱う・自前の決済画面 | しない（Checkout） |
| 無料トライアル | **作らない**（人間の指示） |
| 「無制限」の文言 | 書かない。「5 万枚まで」 |
| 個人単位のプラン・家族プラン | しない |
| 返金の仕組み | しない（特商法の表記に「返金しない」を書く。個別対応は Stripe のダッシュボード） |
| Worker 側の ZIP・圧縮・タイムラインの ZIP | しない |
| アプリ内課金（App Store） | しない（Web のみ。iOS アプリ化のときに考える） |

## 確認観点

- 段階1: iPhone と PC で 1 アルバムと全部が ZIP で落ちる。100 枚が落ちる
- 段階2（テストモード）: 申し込み → paid → 31 枚目が入る → Portal で解約 → 期限で free
- 相手が払っていれば自分の画面もプレミアム。二重に申し込めない
- 退会で購読が解約される（Stripe のダッシュボードで確かめる）

## 完了条件

- 段階1: Z1〜Z6 緑・人間の実機・2.2.0
- 段階2: P1〜P9 緑・テストモードで一周・`/tokushoho` と規約 8 節・3.1.0・本番の鍵に替えて人間が 1 回申し込む（自分のペアは manual なので**別のテスト用ペア**か、manual の行を一度消してから）
- `state.md` / `worklog.md`

## 停止条件

- `fflate` がバンドルで動かない・50 枚でも iPhone で落ちる → A へ
- `stripe` npm が Workers で動かない（`createFetchHttpClient` でも） → A へ（生の `fetch` で Stripe API を叩く形は A が決める）
- Webhook の `couple_id` が `metadata` から取れない形（Stripe の仕様変更等）→ A へ
- 段階0の 2（特商法等の文面）が無い → 段階2を本番に出さない。テストモードまで

## 順序

**段階1（ZIP）は済み。段階2（決済）は 2026-09-15 に着手。**047（鍵）は段階2の後。042 の上限 50 は後回しのまま。

## 進捗

- 2026-09-14 段階1（ZIP）実装 #338（main 6e306b1）。R 受け入れ（`artifacts/048/review-stage1.md`）。R の記録 2 件（無圧縮のテスト・`..` と TAB の名前）は定義に足し、B が fix で直す。人間の実機（iPhone・PC。100 枚）待ち。段階2 は合図待ち
