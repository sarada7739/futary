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
