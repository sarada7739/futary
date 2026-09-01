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

---

## [2026-08-29] M2 まとめ監査（006 投稿API / 008 タイムラインUI / 009 リアクション）

`security-requirements.md` 10節の方針により、006・008 は必須監査対象（認証・招待・画像・認可
ミドルウェア）に該当せず見送り、マイルストーン単位でまとめて実施した（007は画像アップロード
のため個別監査済み）。対象は006の`post.list`/`post.create`/`post.delete`、008のタイムラインUI、
009のリアクション機能全体。

生の返答: [`artifacts/009/security-audit-raw.md`](../artifacts/009/security-audit-raw.md)

**当初High 1件（009固有ではなくAPI全体に及ぶ）、Low 4件、Info 2件と判定されたが、
Highは後日Rレビューで誤指摘と判明した（下記参照）。** 009固有の認可設計
（`reaction.toggle`の他ペア到達防止・レース時の扱い・`post.list`集計の範囲・デモ閲覧時の
`reactedByMe`）は4点とも**指摘なし**と判定された（こちらは訂正なし）。

| 重大度 | 箇所 | 内容 | 推奨対応 | 対応 |
|---|---|---|---|---|
| ~~High~~ | `apps/api/src/index.ts`（oRPC RPCHandlerの全手続き） | oRPCのRPCHandlerがHTTPメソッドを見ないため、全ての書き込み手続き（`couple.update`/`invite.issue`/`post.create`/`reaction.toggle`等）がGETで実行できる、という指摘 | ~~`@orpc/server/plugins`の`StrictGetMethodPlugin`を適用する~~ | **【訂正・誤指摘と判明】**。`@orpc/server`の`RPCHandler`は既定（`strictGetMethodPluginEnabled`を渡さない場合）で`StrictGetMethodPlugin`を自動登録しており、GETは元々拒否されていた（`@orpc/server/dist/adapters/fetch/index.mjs`で確認）。**脆弱性は存在しなかった。** `fix/reject-get-writes`（PR #60）でこの指摘への対応として`StrictGetMethodPlugin`を明示適用していたが、その際に貼った実測（`GET /api/couple/get (no data): 405`）は修正前から一貫して正しかったにもかかわらず、直後の散文で「修正前は`200`になっていた」と誤って解釈・記録していた。実測と指摘が矛盾していたのに、指摘をそのまま信じて記録してしまっていたことをRレビューで指摘され判明した。コードと回帰テスト（`apps/api/test/method-restriction.test.ts`）はRの判断でそのまま残している（ライブラリの既定に依存しない防御として妥当。既定の自動登録と合わせて`StrictGetMethodPlugin`が2重登録されるが実害は無く、`index.ts`のコメントで意図的な重複であることを明記した） |
| Low | `apps/api/src/procedures/reaction.ts` | `isConstraintViolation`の判定（`/constraint failed/i`）がUNIQUE以外（FK/NOT NULL）にも一致し、該当時に書き込みが起きていないのに`reacted: true`を返してしまう。認可の境界自体は破れていない（INSERT側のEXISTS条件が偽なら制約検査に到達しないため） | UNIQUE違反だけに絞る正規表現に変更する | **対応済み**。`reaction.ts`に`isUniqueConstraintViolation`をローカル定義し置き換えた |
| Low | `apps/api/src/procedures/post.ts`（`row.kind as ...`）＋`0005_reaction.sql` | `reactions.kind`に宣言的制約（CHECK）が無く、未知の`kind`が1件でも入るとoRPCの出力検証で`post.list`全体が500になる | マイグレーションで`CHECK (kind IN ('heart'))`を追加する | **対応済み**。`0006_reaction_kind_check.sql`でCHECK制約を追加 |
| Low | `apps/app/app/(tabs)/index.tsx`＋`post-card.tsx` | 未認証（デモ閲覧）でもリアクションボタンが押せ、サーバのFORBIDDENで黙って巻き戻る。境界は破れていないが失敗が無言 | デモではボタンを出さない | **対応済み**。`myId`が無い（未認証）場合は`onToggleReaction`を渡さないよう変更 |
| Low | `apps/api/src/procedures/post.ts`（`post.delete`）＋`reaction.ts` | 投稿を論理削除しても`reactions`行が残留し、削除後は外す経路が無いため永久に残る | `post.delete`の`batch()`に`DELETE FROM reactions WHERE post_id = ?`を含める | **対応済み**。`postDelete`をbatch化し、リアクションも同時に削除するよう変更。**対応中に新たな問題を自己発見**: 推奨どおり`DELETE FROM reactions WHERE post_id = ?`だけを足すと、`couple_id`条件が無いため他ペアの投稿IDを指定した削除で`UPDATE`は0件（`NOT_FOUND`）でも`DELETE`だけが無条件で成立し、「投稿は消せないがリアクションだけ消せる」経路が生まれた。回帰テスト（`他ペアの投稿IDを指定した削除がNOT_FOUNDのとき、対象と無関係なreactionsは消えない`）で実際に検出し、`DELETE`側にも`EXISTS (SELECT 1 FROM posts WHERE id=?1 AND couple_id=?2)`を追加して塞いだ |
| Info | `apps/api/src/index.ts`（レスポンスヘッダ） | ~~`/api/*`に`Cache-Control: no-store`が無い。High（GETが通る）と組み合わさると私的な投稿本文のキャッシュ残留リスクが生まれる~~ | 対応不要 | **【訂正】前提のHighが誤指摘だったため、この指摘も成立しない**（GET経由での到達自体が元々無い）。`Cache-Control: no-store`自体の要否は本件と切り離して016前に再検討する価値はあるが、緊急性はない |
| Info | `apps/api/src/procedures/reaction.ts` | `reaction.toggle`にレート制限が無い。ただし自ペアのメンバーのみが呼べ、影響は自分たちのデータに閉じる | 016前に再評価 | 対応不要（007監査で記録済みのL31と同じ論点として統合） |

### 006 / 008 について確認し、指摘に至らなかった点

投稿の全クエリが`couple_id`で絞られていること、`post.delete`がSELECTしてからUPDATEではなく
1文で完結していること、カーソル偽造耐性、本文の長さ上限とXSS対策、ログへの機密情報の非出力、
`authorization.test.ts`の機械的網羅性チェックなど。詳細は生の返答を参照。

`fix/reject-get-writes`（PR #60）の対応・訂正の詳細は上表のHigh行に統合した
（独立エントリは作らない。訂正は元の指摘の行に書く方が、その行だけを読んだ人が
実在しない脆弱性を追ったり誤解したりしないため。以前は独立エントリを別途作っていたが、
Rレビューで同じ事実の重複記録になっていると指摘され統合した）。

---

## [2026-08-31] 021 予定の持ち主とふたりの予定（`event`のkind別の行ごとの持ち主、`is_shared`）

対象: `packages/db/src/schema/event.ts`, `packages/db/migrations/0010_event_is_shared.sql`,
`packages/contract/src/event.ts`, `apps/api/src/procedures/event.ts`,
`apps/app/components/event-form.tsx`, `apps/app/app/(tabs)/calendar.tsx`

**ペアの内側で権限が分かれるのは021が初めて**（それまでは`couple_id`で絞れば
ペアの2人は同じものに触れるという前提だった）。認可を触るため
`security-requirements.md` 10節1により監査必須。

生の返答: [`artifacts/021/security-audit-raw.md`](../artifacts/021/security-audit-raw.md)

**High以上の指摘: 1件（マイグレーションのバグ。修正済み）。認可ロジック
そのものからはHigh以上の検出なし。**Medium 3件、Low 3件。

| 重大度 | 箇所 | 内容 | 推奨対応 | 対応 |
|---|---|---|---|---|
| High | `migrations/0010`（当時のファイル名`0010_lyrical_chronomancer.sql`） | 表の作り直しのINSERT...SELECTが、追加する新列`is_shared`を移行元の旧`events`からもSELECTしていた。旧`events`にはまだ無い列で、SQLiteのビルドによっては未解決の二重引用符識別子が文字列リテラルへ静かにフォールバックし（エラーにならず全既存行に文字列`"is_shared"`が入る）、厳格な設定では代わりにマイグレーションそのものが失敗する。apps/apiのvitestテストは`events`が空の状態で毎回マイグレーションを当てるため検出できなかった | SELECT側を新列の既定値`0`に直す | **対応済み**。ローカルD1で0000〜0009を適用→既存行相当のテスト行を`wrangler d1 execute`で直接INSERT→0010を適用→`is_shared`が`0`（integer）になることを実機で確認した（`artifacts/021/test-results.md`）。ファイル名も`0010_event_is_shared.sql`に改名した |
| Medium | `event.ts`の`eventUpdate` | UPDATEのWHEREは更新前の行で評価されるため、同じUPDATE文で`kind`自体も変えられることを利用し、記念日・会った日（どちらでも編集できる）を非共有planに変えることで**片方の判断だけで**もう1人を締め出せた（自分が締め出されることもある）。021以前は無害だったが、持ち主の概念を入れたことで権限を奪う手段になっていた | AがWHERE句に条件を追加する設計を決定（security-requirements.md 3節項目8）。**当初案（「更新後も実行者が編集できること」を要求する条件を1つ追加）は「設定者本人が締め出す」経路を塞げておらず、その修正案も「共有planにしてから持ち主が非共有にする」2段階で迂回できた（Rが2回発見）。最終的に「操作が安全か」ではなく「状態遷移が許されるか」で書き直し、`kind<>'plan'`から`kind='plan'`への変換自体を拒む形にした** | **対応済み**（3回の往復を経て）。WHEREに条件を2つ追加: (1) 更新後の状態でも実行者が編集できること (2) `kind<>'plan'`から`kind='plan'`への変換を区分をまたぐ限り拒む（`AND NOT (kind <> 'plan' AND ?newKind = 'plan')`）。planの中の共有/非共有は持ち主が決めてよいため変えていない。画面側は、元がplan以外のときは種別の選択肢からplanそのものを外した（「ふたりの予定」を条件付きで固定する形は不要になった）。テストは設定者・設定者でない側の両方を主語にして8件、2回連続で呼ぶ迂回のテストも追加した |
| Medium | `authorization.test.ts` | security-requirements.md 3節の項目6（`DEMO_COUPLE_ID`が実在するが`is_demo`でないペアを指すとき拒否）のテストが021以前からリポジトリ全体に1件も無かった | 実在の非デモペアを作り、未認証で`couple.get`/`event.list`が`FORBIDDEN`になることを固定するテストを追加する | **対応済み**。2件追加した |
| Medium | `event.test.ts` / `schema-integrity.test.ts` | `is_shared`が`kind='plan'`以外に立てられないことを保証する入力スキーマ・DB CHECK制約が両方あるにもかかわらず、どちらもテストが無かった | 契約側（event.create/updateの2kind×INVALID_INPUT）とDB側（直接INSERTでCHECK違反）のテストを追加する | **対応済み**。5件追加した（契約側3件・DB側2件） |
| Low | `event.ts`の`computeCanEdit` | 未認証（デモ）閲覧者に`canEdit=false`を返す唯一の防御線（`viewerId===null`の早期return）を守るテストが無かった | デモペアの`event.list`が返す全kindで`canEdit===false`になることを固定するテストを追加する | **対応済み**。1件追加した |
| Low | `calendar.tsx` | `canEdit:false`のとき常に「編集は設定者のみ」と表示していたが、未認証デモ閲覧では記念日・会った日でも`canEdit:false`になりうり、「設定者のみ」という理由はplanにしか当てはまらない | 表示を`kind==='plan'`のときだけに絞る | **対応済み** |
| Low | `migrations/0010`のファイル名 | drizzle-kitの自動生成名（`0010_lyrical_chronomancer.sql`）のままで、内容を表していない | 内容が分かる名前に改名する | **対応済み**。`0010_event_is_shared.sql`に改名 |

### 指摘に至らなかった確認点

`event.update`/`event.delete`のWHERE句の文言が一致していること、`computeCanEdit`
とWHERE句が同じ規則を表現していること（kindの変更の遷移を除く）、未認証閲覧者への
`canEdit`誤許可経路が無いこと、`is_shared`の不正な書き換えによる権限昇格経路が
無いこと。詳細は生の返答を参照。

---

## [2026-08-31] 016 全体セキュリティ監査（リポジトリ全体・T1〜T8確認）

対象: `apps/api/src/**`（全手続き・認可ミドルウェア・auth・index）、`apps/app/lib/**`、
`packages/contract/src/**`、`packages/db/src/schema/**`、`packages/db/seed/demo.ts`、
`apps/api/wrangler.toml`、`scripts/build-public.mjs`、`.github/workflows/**`、
`.gitignore`、`pnpm-workspace.yaml`。

**これまでのタスク単位の監査は各タスクの差分だけを見ていた。016は初めてリポジトリ全体を
通しで見る監査**（`docs/tasks/016-release.md`「security-auditorの全体監査とT1〜T8の確認」）。

生の返答: [`artifacts/016/security-audit-raw.md`](../artifacts/016/security-audit-raw.md)

**High以上の指摘: 0件。**`docs/tasks/016-release.md`完了条件「security-auditorの全体監査で
High以上がゼロ」を満たす。

### T1〜T8の判定

| # | 脅威 | 判定 |
|---|---|---|
| T1 | 他ペアへの水平権限昇格 | 対策あり。router走査テスト（`authorization.test.ts:775-809`）で全手続きの網羅性を機械的に確認済み |
| T2 | 招待コードの総当たり | 対策あり |
| T3 | 画像URLの流出・推測 | コード側は対策済み。**バケットの非公開設定・CORS設定はリポジトリから検証不能**（下記Medium-2・Medium-3） |
| T4 | デモ経路からの本番データ漏洩 | 対策あり |
| T5 | デモ経路からの書き込み | 対策あり |
| T6 | 秘密情報のリポジトリ混入 | 対策あり。**履歴全体のgitleaksは本タスクで実施し検出ゼロ**（下記） |
| T7 | 依存ライブラリの既知脆弱性 | 対策あり。**無視リスト2件を本タスクで再評価**（下記） |
| T8 | セッション奪取 | 対策あり |

### Medium・Low指摘と対応

| 重大度 | 箇所 | 内容 | 推奨対応 | 対応 |
|---|---|---|---|---|
| Medium-1 | `.github/workflows/deploy.yml` | デプロイ経路にgitleaks・pnpm auditが無く、ci.ymlが赤でも並行するdeploy.ymlは止まらず本番デプロイへ到達する | ci.ymlと同じ検査を追加する | **対応済み**。deploy.ymlにgitleaksとpnpm audit（high以上）のゲートを追加した |
| Medium-2 | `apps/api/wrangler.toml`（該当ファイルの不在） | R2バケットのCORSルールがリポジトリに存在せず、レビュー・差分検出が不可能 | ルールをファイルとしてコミットする | **対応済み**。`apps/api/r2-cors.json`としてコミットし、`pnpm --filter @futary/api run r2:cors:apply`で適用する運用にした。本番オリジンは016のデプロイ時に人間が追記する（`docs/tasks/016-release.md`人間パート） |
| Medium-3 | `apps/api/wrangler.toml` | R2バケットが非公開であることを示す成果物が無い | 016の人間パートで実測し記録する | **未対応（人間パートへ記録）**。`docs/tasks/016-release.md`の人間の手が要る表に「R2バケットが非公開であることを確認」を追加した |
| Medium-4 | `apps/api/src/procedures/upload.ts`・`me.ts` | アップロード用署名付きURLにレート制限が無く、投稿に紐づかない孤児オブジェクトの回収手段が無い（機密性でなく費用・容量の問題） | レート制限、または回収可能であることを設計として担保する | **一部対応**。実装（レート制限）は見送り、回収方針を`architecture.md` 6節に記録した |
| Low-1 | `apps/api/src/procedures/post.ts` | `fetchReactionSummaries`が`couple_id`条件を持たない（現時点で悪用経路は無い） | 前提をコメントに明記する | **未対応（記録のみ）**。次にこの関数へ触るセッションで拾う |
| Low-2 | `apps/api/src/auth.ts`・`index.ts` | Better Authのレート制限が`x-forwarded-for`を見ており`cf-connecting-ip`を見ていない | `ipAddressHeaders`を設定する | **対応済み**。`advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`を追加 |
| Low-3 | `/api/*`のレスポンス | セキュリティヘッダ（nosniff等）が付かない | Honoミドルウェアで付与する | **対応済み**。`X-Content-Type-Options`・`Referrer-Policy`を明示付与 |
| Low-4 | `.github/workflows/*.yml` | deploy.ymlにpermissionsが無い。全アクションが可変タグ参照 | permissionsを明示、SHA固定する | **対応済み**。両ワークフローに`permissions: contents: read`を追加し、全アクションをコミットSHAで固定した |
| Low-5 | `apps/api/test/auth.test.ts` | Cookie属性を検証するテストが無い | 実際に叩いて検証するテストを追加する | **対応済み**。http/httpsそれぞれでHttpOnly・SameSite・Secureを確認するテストを追加 |
| Low-6 | Dependabot | 有効化がリポジトリ内に痕跡を持たない（不在自体は正しい判断） | 確認日・出力を記録する | **対応済み（本エントリに記録）**。`gh api repos/sarada7739/futary/vulnerability-alerts`・`automated-security-fixes`は014完了前の`docs/worklog.md`で既に実測確認済み（有効）。再確認は次回016デプロイ後に行う |
| Low-7 | `apps/api/src/procedures/couple.ts`等 | 内部エラーに一意のIDが振られていない | interceptorsでUUIDを振る | **対応済み**。`apps/api/src/lib/error-id.ts`を追加し、想定外の例外にIDを振ってクライアントへはIDのみ返す形にした |
| Low-8 | `apps/api/src/index.ts` | `expo-authorization-proxy`の封鎖がパス完全一致に依存（迂回経路は無いことを確認済み） | `disabledPaths`へ移す | **未対応（記録のみ）**。監査自身が「直す必要は無い」としており優先度低 |
| Low-9 | `apps/api/src/procedures/post.ts` | `post.create`が空判定と保存で異なる値を使っている | 同じ値を使う | **対応済み** |

### 履歴全体のgitleaks

`gitleaks/gitleaks-action@v2`はCIの差分（PRのbase..head／pushのbefore..after）しか
見ておらず、検査導入前に混入したものを見つけられない（`security-requirements.md` 9節）。
本タスクで`gitleaks detect --source . --log-opts="--all"`を実行し、**215コミット・
約3.48MBを走査して検出ゼロ**を確認した。

### pnpm.auditConfig.ignoreGhsasの再評価

2件（`GHSA-w3rx-r6r6-pgpr`・`GHSA-5p2g-fcmc-qvqq`。いずれも`image-size`のDoS、
Metro経由の開発時依存）をGitHub Advisory APIで再評価した。両方とも
`"vulnerable": "<= 2.0.2"`（現時点の最新版）・`"patched": null`で、**修正版は
依然として存在しない**。到達可能性（Metroのビルド時のみ、デプロイ後のWorkerと
配信アセットには含まれない）も変わっていないため、無視リストはそのまま維持する。

`pnpm audit`の全重大度出力にはこの2件（high、無視リストで除外）に加え、
`esbuild`（drizzle-kit経由、moderate、修正版あり`>=0.25.0`）・`uuid`（expo経由、
moderate、修正版あり`>=11.1.1`）が出た。どちらも開発時・ビルド時依存で、
CIのゲート（high以上）には該当しない。人間が読む記録として残す。

---

## [2026-08-31] T9 新設：クライアント側キャッシュ経由の他人データ開示（016デプロイ後の実機発見）

対象: `apps/app/app/_layout.tsx`, `apps/app/app/(auth)/sign-in.tsx`,
`apps/app/app/(tabs)/{profile,calendar,timeline,stats}.tsx`,
`apps/app/components/{memory-card,stats-card}.tsx`,
`apps/app/lib/viewer-key.ts`（新設）

016のデプロイ後、人間が本番で「Googleログイン→ログアウト→ゲストモード→
デモを見る、としたら自分の実アカウントに入ってしまった」と報告。
画面録画のフレーム解析（`accounts.google.com`への遷移を確認）で、
Google認証自体は正規に（既存の同意済みアカウントで一瞬で）完了していた
ことをBが確認したが、Rのレビュー（PR #174）で、それとは別に本物の
脆弱性が見つかった。

| 重大度 | 内容 | 推奨対応 | 対応 |
|---|---|---|---|
| High | `couple.get`・`stats.get`・`memory.get`・`post.list`・`event.list`（coupleIdを引数に取らない設計。`architecture.md` 5節）は、TanStack Queryのキャッシュキーが「誰が呼んだか」を区別しない。リロード無しで本物のログイン⇄ゲスト⇄未認証を切り替えると、直前の別人のキャッシュ（データまたはエラー）が新しい識別の画面に一瞬そのまま出る。共有端末では実質的な情報漏洩になる（人間が報告した症状そのものを、この経路でも説明できる） | queryKeyに閲覧者の識別子を含める構造的な対策（タイミングで縮めない） | **対応済み**。`apps/app/lib/viewer-key.ts`の`useViewerQueryKey`を上記5つの問い合わせ全てのqueryKeyに追加。`apps/app/test/viewer-key-coverage.test.ts`が、apps/api側の実際の定義（`readProcedure`を使う手続き）を読み取ってから対応する呼び出し箇所を機械的に確認する形で固定。誤検知しないこと・不備を実際に検知できることの両方を実測した |

**Bの最初の対応（`useEffect`での`queryClient.clear()`）は不十分だった。**
`useEffect`はレンダーの後に走るため、識別が変わった最初のレンダーには
間に合わず、前の識別のキャッシュのまま一度描画される（Rレビュー指摘）。
Aが構造的な修正（キーに識別を含める）を決定し、PR #174を作り直した。

**性質の整理**: 「自分の実アカウントなので抜け穴ではない」は、同じ人が
使っている間だけ成り立つ。ログアウトして端末を人に渡し、その人が
「ゲストではじめる」を押すと前の人のペアのデータが出る。共有端末では
開示である。

T1〜T8は016の全体セキュリティ監査（本ファイル該当エントリ）で確認済み
だったが、T9（クライアントのキャッシュ）はその監査の対象に入っていな
かった。`docs/security-requirements.md` 9節にT9として新設し、
「T1〜T8確認済み・T9は今回の対応のみで独立監査は未実施」と書き分けた。

### 構造的修正後のRレビューで、さらに2件

PR #174に構造的修正（queryKeyへの閲覧者識別子追加）をプッシュした後、Rが
さらに2件を指摘した。

| 重大度 | 内容 | 対応 |
|---|---|---|
| High | `me.get`（名前・メールアドレス・アイコン画像を返す）にviewerKeyが付いていなかった。`me.get`は`readProcedure`を使わない（`health.get`と並ぶ認可基底の唯一の例外）ため、`readProcedure`の使用箇所だけを走査するenforcementテストの構造上、機械的に検出できない対象だった | **対応済み**。`profile.tsx`の`meQuery`にviewerKeyを追加。`viewer-key-coverage.test.ts`に`MANUALLY_INCLUDED_PROCEDURES`として明示的に追加し、なぜ手で足す必要があるかをコメントに記録 |
| Medium | enforcementテストの検証粒度が粗く、2つの見落としがあった。(1) ファイル全体に`viewerKey`という文字列があるかだけを見ていたため、同じファイルに複数の呼び出しがあり1つでもviewerKeyを使っていれば、別の呼び出しから丸ごと外しても検知できなかった（`profile.tsx`のme.get/couple.getで実測して発見）。(2) `callPattern`が一致しなくなると呼び出し箇所0件のままループが回らず、テストが「確認していないのに緑」になりうる形だった | **対応済み**。(1) は呼び出し箇所ごとの近傍（前後100文字）だけを見る形に直し、正しいコードで誤検知しないこと・実際に不備を検知できることの両方を実測した（前後300文字では、`const viewerKey = ...`という宣言1行が隣接する2つの呼び出しの両方から300文字以内に収まってしまい、まだ見逃すことも実測で確認してから100文字まで縮めた）。(2) は呼び出し箇所が1件以上存在することを明示的に要求する形にした |

`apps/app/lib/viewer-key.ts`・`docs/architecture.md` 5節のコメントも
`me.get`を含む正確な記述に更新した。

## [2026-09-01] 024 アカウント削除（`me.delete`）の監査

削除は認可を触るため実行（024タスク定義の完了条件）。**High以上はゼロ。**

依頼した(1)入力操作による他ペア・他ユーザーへの到達、(2)認可バイパス、
(3)R2接頭辞のミススコープは、いずれも経路が構造的に存在しないことを
確認した（`meDeleteContract`は`.input()`を持たず、常に`context.user.id`
だけを使う。`coupleId`・`users/{userId}/`の`userId`もすべてD1から
読み直した値でクライアント入力が混ざらない）。

| 重大度 | 内容 | 対応 |
|---|---|---|
| Medium | reactions〜couples（削除の手順1〜6）を個別の`run()`で実行していたため、削除の実行中に別リクエストが新しい投稿・予定・招待を作ると、その行が削除より後に着地しうる。`couples`は`posts.couple_id`等からON DELETE no actionで参照されているため、その状態で`DELETE FROM couples`がFK違反で落ちる。このとき`couple_members`は既に消えているため、再実行時は`coupleId`を引けず（couple分岐ごと飛ばされ）、本文・`image_key`を持つ`posts`行が回収不能な孤児として恒久的に残る。削除実行者がその投稿の著者なら、以降の`DELETE FROM user`も永久にFK違反で失敗しかねない。024が受け入れたのは「空の`couples`行が残る」ことだけで、本文が残ることでもアカウントが二度と消せなくなることでもなかった | **対応済み**。reactions〜couples（+相手のuser.imageのNULL化）を`db.batch()`1本にまとめた。`db.batch()`は文のエラーでロールバックする（`couple.ts`の`isConstraintViolation`と同じ根拠）ため、この窓自体が無くなり、当初「残る」と受け入れていた孤児`couples`行も同時に解消された |
| Medium | R2の一括削除がD1削除の前だけで、その最中に着地したオブジェクトを誰も回収できない。`post.uploadUrl`が発行するPUT URLは5分有効なため、D1処理中に画像がPUTされると恒久的に残る。RPCは`{ok:true}`を返すため失敗したことも残らない（024「失敗したら、失敗したことを残す」に反する） | **対応済み**。D1の`db.batch()`成功後にもう一度`deleteAllByPrefix`を呼び、前後2回で挟む形にした |
| Medium | 招待コードのレート制限カウンタ（`invite_failures`）を`user_id`で削除すると、その行が持つ`ip_address`側のカウンタも同時にリセットされる。「10回失敗→アカウント削除→同じGoogleアカウントで再登録（新しいuser.id）→また10回」を無制限に回せてしまい、`security-requirements.md` 4節が想定していた「回避にはGoogleアカウント自体を作り直す必要があり、コストが桁違いに高い」という前提が024で崩れている | **A判断待ち**。スキーマ・FKに関わる変更が必要なため実装を保留し、Aへ判断を依頼した |
| Medium | 不可逆かつ相手のデータまで巻き込む操作（`me.delete`）に、再認証もレート制限も無い。`authedProcedure`はセッションの有無しか見ないため、セッションを奪われた場合の被害が「私的写真の閲覧」から「2人分のデータの恒久破壊」へ拡大した | **A判断待ち**。UIの確認段階を増やすのではなく、サーバ側にセッションの新鮮さを要求する形が妥当という助言を受け、Aへ判断を依頼した |
| Low | 相手のプロフィール画像をR2から消すが、相手の`user.image`列は更新しないため、`me.ts`の不変条件「image列が非NULLなら実体がある」が破れ、相手のアバターが壊れた署名付きURLを指したままになる | **対応済み**。相手の`user.image`をNULLに戻す文を同じbatchに含めた |
| Low | `is_demo=1`のペアに対するガードが無い。現状はseedの都合（`email_verified=0`・`@example.com`）で到達不能だが、その到達不能性がseedの1点だけに依存している | **対応済み**。手続き自身でも`couples.is_demo`を確認しFORBIDDENにするガードを追加した |
| Low | `me.delete`が起こしうる最悪のバグ（`WHERE couple_id`の欠落＝全ペア一括削除）を検知するテストが無い。あわせて`authorization.test.ts`の「未認証アクセスでFORBIDDEN」の一覧にも`me.delete`が抜けていた | **対応済み**。無関係な第2のペアのデータ・R2オブジェクトが影響を受けないことを直接確認するテストと、`authorization.test.ts`への追加を行った |
| Low | 削除成功後は`signOut()`のみでキャッシュを明示的に破棄しない。viewerKey（T9）により表示はされないが、削除は「見えなくする」ではなく「消す」操作である | **対応済み**。削除成功時に`queryClient.clear()`を呼ぶようにした |
| Low | R2の削除失敗はそのまま投げる設計（意図どおり）だが、その例外メッセージには対象の画像キーが含まれうる。`withErrorId`はcatchした例外をそのまま`console.error`に渡すため、`security-requirements.md` 8節「画像キーをログに出さない」に反する | **対応済み**。`deleteAllByPrefix`が自分でcatchし、鍵を含まない汎用メッセージ（接頭辞のみ）へ詰め替えてから投げる形にした |
| Low | クライアント側で`deleteMe.mutateAsync()`と`signOut()`を同じ`try`に入れていたため、削除自体は成功したのに`signOut()`が失敗すると「削除できませんでした」と誤って表示される（実際には既に消えている） | **対応済み**。削除の成否とsignOut()の成否を別に扱うよう修正し、旧コードで実際に誤表示することを実測してから直した |

**批評**: 「途中で止まる前提で組む」という設計方針自体は026以前から
一貫していたが、`db.batch()`という既存の道具（`couple.create`・
`invite.accept`で既に使っている）を使わずに個別の`run()`を並べてしまい、
結果として「受け入れていたはずの残存リスク」の範囲を超える壊れ方
（本文・写真の恒久的な孤児化、削除の恒久的な失敗）を生んでいた。
`db.batch()`へ変更する1つの手当てで、Medium 1件・当初「受け入れる」と
書いていた孤児`couples`行の両方が同時に解消された。

---

## [2026-09-01] 027 行きたい場所・食べたいものリスト（`wish.*`）

対象: `apps/api/src/procedures/{wish,me}.ts`, `packages/contract/src/wish.ts`,
`packages/db/src/schema/wish.ts`, `packages/db/migrations/0016_wishes.sql`,
`packages/db/seed/demo.ts`, `apps/app/app/(tabs)/list.tsx`

生ログは`artifacts/027/security-audit-raw.md`に初回・再監査の両方をそのまま
保存済み（`security-requirements.md` 10節）。以下は要約と対応。

| 重大度 | 内容 | 対応 |
|---|---|---|
| **High** | `me.delete`（024）が`wishes`を削除する文を持たないため、`wishes.couple_id`が`couples(id)`をFK参照する（D1は常にFKを強制する）ことと相まって、**wishを1件でも持つペアは`DELETE FROM couples`がFK違反で失敗し、アカウント削除が恒久的にできなくなる。**`db.batch()`は文のエラーで全文ロールバックするため、R2の画像は既に削除済みなのに本文等は残る中間状態にもなりうる | **対応済み**。`db.batch()`に`DELETE FROM wishes WHERE couple_id = ?1`をevents削除の直後・invites削除の前に追加。冒頭の削除順序コメントも1〜7に更新。再監査で解消を確認済み |
| Medium | `couple_id`を持つ表が増えたときに`me.delete`の削除漏れを検知する仕組みが無かった。デモシード側には「表が増えたときはここへ足す」という注記と実際の追加があったのに、`me.delete`側には同種の注記も機械的な番人も無く、027で片方だけ漏れた | **対応済み**。`apps/api/test/me.test.ts`に「`couple_id`列を持つ全ての表で、me.delete後にそのペアの行が0件になる」テストを新設。`sqlite_master`のCREATE TABLE文字列を正規表現で走査し（D1は`PRAGMA table_info`を許可しないため`SQLITE_AUTH`。実測で確認。`schema-integrity.test.ts`の`extractNamedChecks`と同じ方式で代替）、新しい表を手で一覧に足し忘れても次から機械的に検知できる。再監査で解消を確認済み |
| Low | 200件上限は「行数の上限」ではない。`COUNT`が`deleted_at IS NULL`で絞るため、認証済みメンバーはcreate→delete（論理削除）を繰り返して行を無制限に増やせる。ペア境界は越えず影響はD1のストレージ消費のみ | **A判断待ち**。ドキュメントの表現の問題であり実装のバグではないため、`docs/tasks/027-wish-list.md`5節への追記が必要かAへ判断を依頼した |
| Low | `titleSchema`はtrimと1〜100文字だけを見ており、制御文字・双方向制御文字（U+202E等）を通す。`post.body`も同じ性質のため027固有ではない | **A判断待ち**。wishだけに正規化を入れると入力検証の規則が2系統に割れるため、`post.body`と共通の正規化を置くかという設計の問いとしてAへ判断を依頼した |
| Low | 「追加」ボタンに`createWish.isPending`による二重発火防止が無く、`compose.tsx`等の既存画面の規則から1箇所だけ外れていた | **対応済み**。`disabled={!canSubmit \|\| createWish.isPending}`に修正 |

**批評**: `docs/tasks/027-wish-list.md`90-91行目の「新規テーブルであり、
他表からFK参照されない」という記述は、**参照される側**としては正しいが
**`wishes`が`couples`・`user`を参照する側になったこと**（＝削除順序に
影響する）を見落としていた。B（実装者）がこの記述を安全の根拠として
読んでいたため、実装が漏れた一因になっている。024の`me.delete`実装時に
`db.batch()`へ1本化する判断があったにもかかわらず、027でその配列に
新しい表を足す運用がドキュメント上のどこにも明記されていなかった点は、
024の監査で指摘された「Medium: 表が増えたときの削除漏れ」パターンが
実際に一度も番人を持たないまま次のタスクで再現した例である。
