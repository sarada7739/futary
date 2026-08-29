# セキュリティ監査記録

`docs/security-requirements.md` 10節の手順に従い、`artifacts/NNN/security-audit-raw.md`
（監査役の生の返答）をそのまま転記する。B が対応した結果は各エントリの末尾に追記する。

---

## [2026-08-27] 003 認証基盤（Google OAuth）

対象: `apps/api/src/{auth,index,router}.ts`, `wrangler.toml`, `packages/db/src/schema/auth.ts`,
`packages/db/migrations/0001_auth.sql`, `packages/contract/src/me.ts`,
`apps/app/lib/{auth-client,orpc,api-origin}.ts`,
`apps/app/app/{_layout.tsx,(auth)/sign-in.tsx,(tabs)/profile.tsx}`,
`.dev.vars.example`, `.github/workflows/ci.yml`

生の返答: [`artifacts/003/security-audit-raw.md`](../artifacts/003/security-audit-raw.md)

| 重大度 | 箇所 | 内容 | 推奨対応 | 対応 |
|---|---|---|---|---|
| High | `apps/api/wrangler.toml:19` | `BETTER_AUTH_URL` が http 固定の共通 `[vars]` にあり、本番デプロイ時に上書きし忘れるとセッションCookieの `Secure` 属性が落ちる | `[env.production.vars]` に実ドメインを置く。`useSecureCookies` を明示する | **対応済み**。`BETTER_AUTH_URL` を `[vars]` から削除し `.dev.vars` / `wrangler secret` 経由に変更。未設定なら `createAuth` が起動時エラーで落ちる（fail-closed）。`advanced.useSecureCookies` を `BETTER_AUTH_URL` のプロトコルから明示的に算出するよう変更 |
| High | `apps/api/src/auth.ts:16` | `secret` を検証せず渡しており、未設定時は公開済みのデフォルト鍵にフォールバックしうる（Workers では `NODE_ENV` 未設定のため本番判定が効かない） | `createAuth` の冒頭で fail-fast させる | **対応済み**。`assertValidSecret` で32文字未満・未設定を例外にした。CIにも影響したため `.github/workflows/ci.yml` にテスト用ダミー `.dev.vars` を生成するステップを追加し、fail-fast動作をローカルで実地確認した |
| Medium | `wrangler.toml:20` ＋ `index.ts:26-33` ＋ `auth.ts:24` | `TRUSTED_ORIGINS` が localhost 固定で本番にも載る。同一マシン上の他アプリから本番APIへ認証付きクロスオリジン要求が通る | 本番用は実オリジンのみ（同一オリジン配信なら空）にし、dev専用の値と分離する | **対応済み**。`BETTER_AUTH_URL` と同様 `.dev.vars` / `wrangler secret` 経由に変更。未設定ならCORSはすべて拒否（fail-closed） |
| Medium | `apps/app/app.json:5` ＋ `auth.ts:31` | ネイティブ復帰経路で `@better-auth/expo` がセッショントークンをURLクエリに載せる。`futary://` スキームはAndroidで衝突しうる | 検証済みディープリンクへの切り替え、または受容リスクとしてADR化 | **未対応（記録のみ）**。現状 `futary://` を `TRUSTED_ORIGINS` に含めていないため経路自体が無効（fail-closed）。ネイティブのGoogleログイン対応時に必ず再検討が必要。`docs/state.md` の未解決論点に記録した |
| Medium | `auth.ts:31` ＋ `index.ts:37` | `@better-auth/expo` の認可プロキシがWebからも到達可能でオープンリダイレクトの踏み台になりうる | ネイティブ未対応なら該当エンドポイントを塞ぐ | **対応済み**。`GET /api/auth/expo-authorization-proxy` を明示的に404にするルートを追加。ネイティブ対応時に解除する |
| Medium | `auth.ts:14-32`（rateLimit未設定） | Workersでは `NODE_ENV` 未設定のため既定でレート制限が無効。memory storageも実効性が薄い | `rateLimit: { enabled: true, storage: "database" }` を明示 | **一部対応**。`rateLimit: { enabled: true }` を明示（storageは既定のmemoryのまま）。database storageへの切替と`rateLimit`テーブルは招待コード機能（004以降）実装時にまとめて対応する。`docs/state.md` の未解決論点に記録した |
| Low | `.github/workflows/ci.yml:23-27` | CIに `pnpm audit` / gitleaks / Dependabot が無い | CIに追加する | **未対応（記録のみ）**。003スコープ外として `docs/state.md` の未解決論点に記録した |
| Low | `index.ts:42-62`（`app.onError`不在） | サーバ内部エラーにIDを振っておらず障害追跡ができない（クライアントへの漏洩は無いことは確認済み） | `app.onError` でUUID採番 | **未対応（記録のみ）**。003時点では手続きが `health`/`me` のみで実害が薄いため見送り。posts等の実装時に対応する |
| Low | 全レスポンス | セキュリティヘッダ（CSP等）が無い | Web配信タスクで対応 | **未対応（記録のみ）**。Web配信・LP実装タスクのスコープとして `docs/state.md` に記録した |
| Info | `@better-auth/expo` のOrigin上書き挙動 | ブラウザからは悪用不可と確認 | 対応不要 | 対応不要（監査結論のとおり） |
| Info | `router.ts:4-7` ／ `_layout.tsx:19-24` | `coupleId` 集約の認可ミドルウェアがまだ無い。003時点では実害なし | 005以降、手続き追加前に必ず導入 | 対応不要（005のタスクスコープ） |

### pnpm audit（静的ツール）

検出4件（High 2 / Moderate 2）。いずれも `drizzle-kit` / `expo-cli` / `metro` 経由の
開発時・ビルド時依存で、Cloudflare Workers の実行時コードパスには含まれない。
監査役もこの判断を妥当と確認済み。詳細は `artifacts/003/security-audit-raw.md` 参照。

gitleaks はこの環境に無く未実行。CIへの導入は上表Lowの未解決論点として記録。

---

## [2026-08-27] 004 ペア作成と招待コード（couple/invite、招待コード生成、オンボーディング画面）

対象: `apps/api/src/procedures/couple.ts`, `apps/api/src/lib/invite-code.ts`,
`apps/api/src/{context,index,router}.ts`, `packages/contract/src/{couple,invite}.ts`,
`packages/db/src/schema/couple.ts`, `packages/db/migrations/0002_couple.sql`,
`apps/app/app/(onboarding)/{index,create,invite,join}.tsx`, `apps/app/app/_layout.tsx`

生の返答（1回目・2回目とも）: [`artifacts/004/security-audit-raw.md`](../artifacts/004/security-audit-raw.md)

### 1回目監査

| 重大度 | 箇所 | 内容 | 推奨対応 | 対応 |
|---|---|---|---|---|
| High | `couple.ts`（レート制限キー） | レート制限のキーが完全なIPアドレスのみで、IPv6の/64ローテーションで無制限に回避できた。認証必須なのに `user.id` を使っていなかった | `user.id` をキーに追加する | **対応済み**。`invite_failures` に `user_id` を追加し、`user_id` と `ip_address` の**どちらか**が閾値を超えたら拒否する形に変更 |
| Medium | `couple.ts`（レート制限のcheck→insert） | `SELECT COUNT(*)` してから `INSERT` するまでが原子的でなく、並行リクエストで閾値を超えて通過できるTOCTOU | 判定と記録を単一SQL文にする | **対応済み**。`INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ? RETURNING id` の1文に統合。並行20本のテストでNOT_FOUND10件・RATE_LIMITED10件ちょうどになることを確認 |
| Medium | `(onboarding)/create.tsx` ／ `invite.tsx` | 招待コードをExpo Routerの画面遷移パラメータで運んでおり、Web版でURLのクエリ文字列に露出していた | ナビゲーションパラメータで運ばない | **対応済み**。TanStack Queryのキャッシュ経由で運ぶ形に変更 |
| Medium | `invite-code.ts` | 文字集合が実装コメント上「32文字」だが実際は31文字（`L`が抜けていた）で剰余バイアスがあった | 拒否サンプリングか文字集合を32文字に揃える | **対応済み**。文字集合に `L` を追加し32文字に修正 |
| Low | `couple.ts`（invite.acceptのエラー分岐） | FORBIDDEN/NOT_FOUNDの出し分けが招待コードの有効性オラクルになっていた | 単一のエラーコードに統一する | **対応済み**。失敗系を全て `NOT_FOUND` に統一 |
| Low | `couple.ts`（IP欠落時のフォールバック） | `"unknown"` の共有バケットに丸めて相互DoSの余地があった | `user.id` をキーにフォールバックする | **対応済み**（1回目はuser_id単独判定に分岐、2回目の指摘を受けて更に列自体もnullableに変更。下記参照） |
| Low | `packages/contract/src/invite.ts` | 招待コードの文字集合が入力スキーマで検証されていなかった | 正規表現で文字集合を検証する | **対応済み**。`/^[2-9A-HJ-NP-Z]{6}$/` を追加 |
| Low | `packages/contract/src/couple.ts` | 付き合った日に範囲チェック（未来日・極端に古い日付）が無かった | 下限・上限を追加する | **対応済み**。1900-01-01〜今日(JST)の範囲チェックを追加 |
| Low | `couple.ts`（内部エラー） | 内部エラーに一意なIDが振られていない | `app.onError` でID採番 | **未対応（記録のみ）**。003監査Lowの積み残しと同じ。posts等の実装時にまとめて対応する |
| Low | `couple.ts`（invite.issue） | `invite.issue` にレート制限が無く、満員のペアでもコードを発行できる。`invites`行の定期削除も無い | 発行にも上限を設ける・定期削除する | **未対応（記録のみ）**。2回目監査で「画面遷移だけで自動発行される」設計自体を修正したため実質的なリスクは大きく下がったと判断し、今回は見送り。将来のトラフィック増加時に再検討する |

### 2回目監査（1回目の修正確認 + 新規指摘）

1回目の8件は全て該当行を確認のうえ解消と判定された。加えて、Web版URL露出対策として
「画面表示のたびにこの画面自身がコードを発行する」形にした副作用として、以下が
新たに見つかった。

| 重大度 | 箇所 | 内容 | 推奨対応 | 対応 |
|---|---|---|---|---|
| Medium | `(onboarding)/invite.tsx` | マウント時（画面遷移・リロード・外部リンク経由のGET相当）に無条件で `invite.issue` を呼んでおり、既に相手に渡した有効なコードを黙って無効化してしまう。SameSite=Laxはトップレベル遷移にCookieを載せるため、`/invite` へのリンクを踏ませるだけでペアリングを繰り返し妨害できる | 発行をユーザーの明示的な操作に紐づける | **対応済み**。コード発行は `couple.create` 直後の一度きり（明示的な作成操作の一部）に限定し、`create.tsx` がキャッシュへ結果を格納。`invite.tsx` は自動発行をやめ、キャッシュが無い場合のみ「招待コードを発行する」ボタンで明示的に発行する形に変更 |
| Low | `couple.ts`（IP側のレート制限） | IP完全一致・user_idと同じ閾値のORのため、CGNAT配下で無関係な利用者が同じIPの枠を使い切ると正当な利用者が巻き込まれる | user側とIP側で閾値を分離する | **対応済み**。`user_id` は10回/時間のまま、`ip_address` は50回/時間に緩和し、両方を独立したAND条件で判定する形に変更 |
| Low | `couple.ts`（ip_addressへの"unknown"書き込み） | IP欠落時も列に固定文字列 `"unknown"` が実値として残り、将来IP単独で集計するコードを足すと共有バケット問題が復活する | 列をnullableにしてNULLを入れる | **対応済み**。`invite_failures.ip_address` をnullableにし、IP欠落時はNULLを書き込む形に変更 |
| Low | `couple.ts`（`invite_failures`の掃除） | 毎リクエストの掃除DELETEが `created_at` 単独インデックスを持たず全表走査になる | 単独インデックス追加か掃除頻度を下げる | **未対応（記録のみ）**。要件6節の想定規模（2人×1日数投稿）ではテーブルがレート制限自体で有界（数十行程度）のため、時期尚早な最適化と判断し見送り |
| Low | `couple.ts`（invite.issue、再掲） | `invite.issue` にレート制限が一切無い | 発行にも上限を設ける | **未対応（記録のみ）**。上記Mediumの修正（明示操作のみで発行）により実質的なリスクは大きく下がったと判断。将来再検討する |

再監査後は追加のHigh/Mediumの指摘は無く、3回目の監査は実施していない
（Low・Info項目のみ残存。上表の「未対応（記録のみ）」参照）。

---

## [2026-08-28] 005 認可ミドルウェア（couple_id 解決の集約、readProcedure/writeProcedure/authedProcedure）

対象: `apps/api/src/{context,index}.ts`, `apps/api/wrangler.toml`,
`apps/api/src/middleware/auth-context.ts`, `apps/api/src/procedures/{base,couple}.ts`,
`apps/api/test/{authorization,couple,invite}.test.ts`

生の返答（1回目・2回目とも）: [`artifacts/005/security-audit-raw.md`](../artifacts/005/security-audit-raw.md)

### 1回目監査

**High以上の指摘: ゼロ**（完了条件を満たす）。Medium 2件、Low 2件。

| 重大度 | 箇所 | 内容 | 推奨対応 | 対応 |
|---|---|---|---|---|
| Medium | `auth-context.ts`（未認証分岐） | `DEMO_COUPLE_ID` の値をそのまま信用しており `is_demo` を検証していない。ADR-010/T4が定める「デモペアは `is_demo` で識別」が実装に存在せず、014でIDを貼り間違えると未認証の全世界に実在ペアが公開される形になり得る。005時点は空文字のため実害なしだが、014でこのまま値を設定するとHigh相当に昇格すると評価された | `SELECT id FROM couples WHERE id = ? AND is_demo = 1` を実行し、0件ならFORBIDDEN | **対応済み**。未認証分岐でis_demo=1を検証するSELECTを追加し、0件ならFORBIDDEN。`coupleId`もenvの値ではなくDBが返した値を使うよう変更（信頼の起点をenvからDBの実データに移した）。再監査で解消を確認 |
| Medium | `procedures/couple.ts`（couple.create/invite.accept） | 認可が2系統に割れている。この2手続きはreadProcedure/writeProcedureを経由せず手書きの`if (!context.user) throw errors.FORBIDDEN()`に依存しており、「手続きごとに認可を書くと書き忘れる」という005が防ごうとしたリスクの構造自体が残っていた | 認証必須のみを課す第3の基底`authedProcedure`を追加し、この2手続きに適用する | **対応済み**。`base.ts`に`authedProcedure`（couple_id解決はせず、OutContextを`{user: NonNullable<...>}`にして未null絞り込みを型で保証）を追加し、couple.create/invite.acceptに適用。手書きのnullチェックは削除。couple配下の全5手続きが3基底のいずれかを経由する状態になった。再監査で解消を確認 |
| Low | `test/authorization.test.ts`（項目2） | 「書き込み系の手続きが全てFORBIDDEN」の検証が手続きの手動列挙に依存しており、新しい書き込み手続きの追加漏れを検出できない | routerを再帰走査して write系を自動列挙する形にする | **未対応（記録のみ）**。005のスコープとしては大掛かりと判断し見送った。新しい書き込み手続きを追加する際にテストを追記すべき旨をコメントで明記。006で書き込み手続きが増えた時点で走査テスト化を再検討する |
| Low | `procedures/couple.ts`（`throw new Error(...)`） | `DEMO_COUPLE_ID`が存在しないcoupleを指す設定ミス時に素の`Error`を投げており、クライアントへの漏洩はないが原因追跡が困難だった | is_demo検証を入れれば経路自体が消える | **対応済み**。Medium1の対応（is_demo検証）でこの分岐自体が到達不能になった |

### 2回目監査（1回目の修正確認）

Medium 2件とも解消、新たな問題なしと判定された。`is_demo`検証が正しくDBの実データを起点にしていること、`authedProcedure`のcontext積み直しが`mergeCurrentContext`の仕様と整合していること、couple配下5手続き全てが3基底のいずれかを経由することを確認済み。Low（テスト網羅の人手依存）のみ残存。

### 5項目（`security-requirements.md` 3節）との突き合わせ

1回目監査時点では項目3（デモペアのデータのみ）が「部分的」（is_demo未検証のため）と評価されたが、Medium1の対応により解消。他4項目は1回目から充足と評価されている。

---

## [2026-08-29] 実機ログイン確認バグ修正（callbackURL絶対URL化 / signIn.social再入防止）

対象: `apps/app/app/(auth)/sign-in.tsx`

生の返答: [`artifacts/fix-oauth-callback/security-audit-raw.md`](../artifacts/fix-oauth-callback/security-audit-raw.md)

**High以上の指摘: ゼロ**（オープンリダイレクトは成立しないことをBetter Authのサーバ側検証コードを読んで確認済み）。Low 4件。

| 重大度 | 箇所 | 内容 | 推奨対応 | 対応 |
|---|---|---|---|---|
| Low | `auth.ts`（TRUSTED_ORIGINSの検証） | `TRUSTED_ORIGINS`がCORS許可リストに加えてOAuthログイン後リダイレクト先の許可リストも兼ねるようになったが、ワイルドカード（`*.pages.dev`等）を弾いていない。現状悪用不能だが、将来CORSを緩めた際に認証リダイレクト面が静かに広がる構造だった | `parseTrustedOrigins`でワイルドカードを拒否する | **対応済み**。`assertAllowedUrl`にホスト名の`*`/`?`拒否チェックを追加し、テストも追加 |
| Low | `sign-in.tsx`（再入ガードの解除タイミング） | `signIn.social`のPromiseはredirect開始直後にresolveするため、`.finally`で即座にフラグを戻すと遷移完了までの間にもう一度クリックされる余地が残る | 成功時はフラグを戻さずラッチする | **対応済み**。`result.error`が無い場合（成功）はフラグを戻さず、失敗時のみ戻す形に変更 |
| Low | `sign-in.tsx`（モジュールスコープのガード） | ガード状態がUIに反映されず、Promiseがsettleしない場合フラグが残り続けアプリ再起動までログイン不能になりうる | `useState` + `Button`の`disabled`に置き換える | **対応済み**。useState化し、両ボタンの`disabled`と連動させた |
| Low | `sign-in.tsx`（`void`で戻り値を捨てている） | 失敗が完全に無言で、利用者が異常に気づけない | 汎用の失敗メッセージを表示する | **未対応（記録のみ）**。専用のエラー表示UIコンポーネントが現状無く、今回のスコープを超えると判断。将来のUI実装タスクで対応する |

補足: `@better-auth/expo`が`NODE_ENV === "development"`で`trustedOrigins`に`exp://`を注入する挙動を確認したが、Workerに`NODE_ENV`は設定されておらず現状無効。将来もWorkerの変数に`NODE_ENV`を足さないこと（記録のみ）。

---

## [2026-08-29] 007 画像アップロード（R2署名付きURL、post.uploadUrl/post.create/post.delete/post.list、Button二重発火ガード）

対象: `apps/api/src/lib/{r2-signed-url,ulid}.ts`, `apps/api/src/procedures/{post,upload,couple}.ts`,
`apps/api/src/{context,index,router}.ts`, `packages/contract/src/post.ts`,
`packages/db/src/schema/post.ts`, `packages/db/migrations/0004_post_image_key_unique.sql`,
`apps/app/lib/image.ts`, `packages/ui/src/components/button.tsx`,
`apps/api/.dev.vars.example`, `.github/workflows/ci.yml`

生の返答: [`artifacts/007/security-audit-raw.md`](../artifacts/007/security-audit-raw.md)

**High以上の指摘: ゼロ**（完了条件を満たす）。Medium 4件、Low 2件、Info 3件。

| 重大度 | 箇所 | 内容 | 推奨対応 | 対応 |
|---|---|---|---|---|
| Medium | `r2-signed-url.ts`（署名付きPUT URL） | presigned PUT URLに Content-Type が実は束縛されていなかった（aws4fetchはcontent-typeをUNSIGNABLE_HEADERSとして扱う）。コードのコメントが事実と異なっていた | `post.create`のR2実体確認時にContent-Typeも検証する。誤ったコメントを修正する | **対応済み**。`post.create`が`head.httpMetadata?.contentType`を検証し、不一致ならR2から削除して`INVALID_INPUT`（サイズ検証と同じ事後防御線に統一）。コメントも修正。テスト追加 |
| Medium | `packages/contract/src/post.ts`（imageId） | `imageId`に形式検証が無く、理論上パス区切り文字等が鍵の組み立てに混入する余地があった（現状は`bucket.head`の存在確認で実害には至らない） | ULID形式の正規表現で絞る | **対応済み**。`z.string().regex(/^[0-9A-HJKMNPQRSTVWXYZ]{26}$/)`を追加。テスト追加 |
| Medium | `upload.ts`/`r2-signed-url.ts`（8MB上限がpost.create時の事後チェックのみ） | presigned PUTにサイズ制約が無く、`post.uploadUrl`にレート制限も無いため、認証済みユーザーが巨大オブジェクトのアップロード＋未参照放置を反復してコスト/ストレージを消費させられる（機密性には影響しない） | uploadUrlへのレート制限、無参照オブジェクトの回収ジョブ | **未対応（記録のみ）**。MVPの完了条件外・設計判断の色が強いため、`docs/state.md`未解決の論点に起票してAへ引き継いだ |
| Medium | `post.test.ts`/`authorization.test.ts`（他ペアimageIdのテスト欠落） | 完了条件にある「他ペアのimageIdを送っても到達しない」ことの専用テストが無かった | ペアBの実体をペアAが指定してINVALID_INPUTになるテストを追加 | **対応済み**。`post.test.ts`に追加 |
| Low | `packages/ui/src/components/button.tsx` | 同期`onPress`が例外を投げるとガードが固着（ボタンが永久に無反応）。非同期側は`.finally`のみで reject が unhandled rejection になる | try/catchでガード解除してrethrow。`.then(reset, reset)`に変更 | **対応済み**。修正し回帰テスト2件追加 |
| Low | `docs/tasks/007-image-upload.md`（実装メモ） | R2バケット非公開・署名なしアクセス拒否・期限切れ失効が実機未検証 | R2 APIトークン発行後に確認し証跡を残す | **未対応**。R2 APIトークンが`.dev.vars`未設定のため（003のGoogle OAuthクライアントと同じ制約）。`docs/state.md`次の一手に記録 |
| Info | コメントの実態不一致（「鍵を渡さない」） | 返す署名付きURLのパスには鍵自体が含まれる。安全性は「鍵を入力として受け取らない」ことに依存 | コメント修正 | **対応済み**（apps/api側のみ。architecture.mdはA所有のためstate.md経由でAに申し送り） |
| Info | 既存D1データの鍵形式未検証 | 006の無検証な`imageKey`で作られた既存行の形が未検査 | デプロイ前にSELECTで確認 | 対応不要（未デプロイ前提） |
| Info | pnpm audit/gitleaks未実施 | 依存の脆弱性確認が今回の監査に含まれていない | 016でCI導入時に確認 | 対応不要（016スコープ、既存Low記録済み） |

対応後、apps/api 109件・apps/app 14件・packages/ui 7件のテストが全て緑。型チェック・lintも通過を確認済み。
