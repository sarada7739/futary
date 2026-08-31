# 016 全体セキュリティ監査（生の返答）

security-auditor エージェントへの依頼: リポジトリ全体（タスク単位の差分ではなく）を対象に、
`docs/security-requirements.md` 9節の想定脅威T1〜T8それぞれの対策を実装から確認し、
あわせてOWASP Top 10ベースの横断監査を行う。

---

### [2026-08-31] 監査対象: futary リポジトリ全体（016 リリース前・全体セキュリティ監査）

対象: `apps/api/src/**`（全手続き・認可ミドルウェア・auth・index）、`apps/app/lib/**`、`packages/contract/src/**`、`packages/db/src/schema/**`、`packages/db/seed/demo.ts`、`apps/api/wrangler.toml`、`scripts/build-public.mjs`、`.github/workflows/**`、`.gitignore`、`pnpm-workspace.yaml`。
すべて実際にファイルを読んで確認。ライブラリ既定に依存する箇所（Better Auth の Cookie 属性、oRPC のエラー整形）は `node_modules` の実装まで読んで裏を取っている。

---

## 1. 想定脅威 T1〜T8 の確認

| # | 脅威 | 判定 |
|---|---|---|
| T1 | 他ペアへの水平権限昇格 | 対策あり |
| T2 | 招待コードの総当たり | 対策あり |
| T3 | 画像URLの流出・推測 | 対策不十分（コード側は充足。バケット設定がリポジトリで検証不能） |
| T4 | デモ経路からの本番データ漏洩 | 対策あり |
| T5 | デモ経路からの書き込み | 対策あり |
| T6 | 秘密情報のリポジトリ混入 | 対策あり（ただし履歴全体走査が未実施・デプロイ経路に検査なし） |
| T7 | 依存ライブラリの既知脆弱性 | 対策あり（ただし無視リスト再評価が未完・デプロイ経路に検査なし） |
| T8 | セッション奪取 | 対策あり（テストによる固定が無い） |

### T1: 他ペアのデータへの水平権限昇格 — 対策あり

単一の防御線が実在することを確認した。`apps/api/src/middleware/auth-context.ts:32-53` の
`resolveCoupleContext` が `couple_id` を確定させる唯一の場所。`apps/api/src/procedures/base.ts`
の `readProcedure`/`writeProcedure`/`authedProcedure` がこれを強制する。

手続きの引数に `coupleId` が現れないことを契約側で確認した。`packages/contract/src` 全10ファイルを
`coupleId` で grep した結果、入力スキーマに `coupleId` を持つ手続きは1件も無い。

全クエリの `couple_id` スコープをSQL単位で確認（post/reaction/event/couple/stats/memoryの
全手続き）。「SELECTしてからUPDATE」の2段階は1箇所も無く、条件は書き込み文のWHEREに直接埋め込まれている。

`security-requirements.md` 3節のテスト表8項目が全て `authorization.test.ts` に実在し、加えて
router を再帰走査して許可リスト以外の全手続きが3基底のいずれかを経由していることを機械的に
検証するテスト（775-809行）がある。procedures配下で直接パラメータの`coupleId`を信頼している
手続きは1件も無いことを、全35箇所のSQLを追跡して確認した。

### T2: 招待コードの総当たり — 対策あり

有効期限24時間・同時1件・二本立てレート制限（user_id 10回/時、ip_address 50回/時、単一のINSERT
文で閾値判定と記録を原子化）が実在。乱数は`crypto.getRandomValues`で暗号論的、文字集合32文字は
256の約数でモジュロバイアスが無い。使用済みコードの再利用不可・失敗理由の一本化（NOT_FOUNDへ収束）・
成功時は非カウントも確認した。

### T3: 画像URLの流出・推測 — 対策不十分（コード側は充足、バケット設定がリポジトリで検証不能）

コード側（署名付きURL有効期限・鍵のサーバ生成・ULID・サイズ/Content-Type事後検証・削除時の
孤児処理・fail-closed）は要件を満たしている。ただしR2バケットが非公開であることを示す成果物、
およびCORSルールのファイルがリポジトリに存在せず、コードレビューでは検証できない。

### T4: デモ経路からの本番データ漏洩 — 対策あり

`auth-context.ts:36-43`が値の一致だけでなく`is_demo=1`まで確認しており、`security-requirements.md`
3節が警告していた穴（項目5だけでは`AND is_demo=1`を外しても1件も落ちない）は塞がっている。
テスト項目5・6が両方実在。デモデータが合成であること（固定ID・予約ドメイン・架空の名前・
email_verified=0）も確認した。

### T5: デモ経路からの書き込み — 対策あり

`base.ts`の`writeProcedure`がミドルウェアで一律拒否。UI側の制御に依存していない
（`guest-mode.ts`にその旨明記）。router走査テストが網羅性を保証し、GET経由の状態変更も
`StrictGetMethodPlugin`とテストで塞がれている。

### T6: 秘密情報のリポジトリ混入 — 対策あり（2つの穴あり）

`.gitignore`・`.dev.vars.example`・CIのgitleaksは適切。リポジトリ全体を走査し実値の混入は
0件。ただし履歴全体のgitleaksが未実施（gitleaks-actionは差分のみ）、デプロイ経路に検査が無い。

### T7: 依存ライブラリの既知脆弱性 — 対策あり（統制の可視性に問題）

`pnpm audit --audit-level=high`ゲート・出力専用ステップ・陳腐化検出スクリプトの実装は妥当。
無視リスト2件（image-size、いずれも経路・理由・削除条件つき）。Dependabotはリポジトリ設定APIで
有効化済み（dependabot.yml不在は意図的で正しい判断）。ただし無視リストの再評価が未完・
デプロイ経路に検査が無い。

### T8: セッション奪取 — 対策あり（テストによる固定が無い）

Better Authの既定属性（HttpOnly/SameSite=Lax）と`auth.ts`の`useSecureCookies: isHttps`の
組み合わせで3属性すべて成立することをライブラリ実装まで追って確認。SecureStore・CSRF対策
（SameSite=Lax + StrictGetMethodPlugin + CORS許可リスト）も確認。ただしCookie属性を直接
検証するテストが1本も無かった。

---

## 2. OWASP Top 10 ベースの横断監査

### High
指摘なし。

### Medium

| # | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| Medium-1 | `.github/workflows/deploy.yml` | デプロイ経路にgitleaksとpnpm auditが無く、ci.ymlが赤でも並行するdeploy.ymlは止まらず本番デプロイへ到達する | deploy.ymlにgitleaksとpnpm audit(high以上)を追加する |
| Medium-2 | `apps/api/wrangler.toml`（該当ファイルの不在） | R2バケットのCORSルールがリポジトリに存在せず、レビュー・差分検出が不可能 | ルールをファイルとしてコミットし、ファイル経由でしか設定しない運用にする |
| Medium-3 | `apps/api/wrangler.toml` | R2バケットが非公開であることを示す成果物が無く、コードからは検証できない | 016の人間パートで`wrangler r2 bucket info`を実測し記録する |
| Medium-4 | `apps/api/src/procedures/upload.ts`・`me.ts` | アップロード用署名付きURL発行にレート制限が無く、投稿に紐づかない孤児オブジェクトを回収する手段が無い（機密性でなく費用・容量の問題） | レート制限、または回収可能であることを設計として担保する運用手順の整備 |

### Low

| # | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| Low-1 | `apps/api/src/procedures/post.ts` | `fetchReactionSummaries`が`couple_id`条件を持たない唯一のクエリ（現時点で悪用経路は無い。呼び出し元で絞り込み済み） | 前提をコメントに明記する |
| Low-2 | `apps/api/src/auth.ts`・`index.ts` | Better Authのレート制限が`x-forwarded-for`を見ており`cf-connecting-ip`を見ていない | `advanced.ipAddress.ipAddressHeaders`に`cf-connecting-ip`を設定する |
| Low-3 | `apps/api/wrangler.toml`・`scripts/build-public.mjs` | `/api/*`のレスポンスにセキュリティヘッダ（nosniff等）が付かない | Honoミドルウェアで明示的に付与する |
| Low-4 | `.github/workflows/*.yml` | deploy.ymlにpermissionsが無い。全アクションが可変タグ参照 | permissionsを明示、アクションをコミットSHAで固定する |
| Low-5 | `apps/api/test/auth.test.ts` | Cookie属性（HttpOnly/Secure/SameSite）を検証するテストが無い | 実際にCookieを発行するエンドポイントを叩き属性を直接検証するテストを追加する |
| Low-6 | `.github/`（dependabot.yml不在） | Dependabotの有効化がリポジトリ内に痕跡を持たない（dependabot.yml不在自体は正しい判断） | security-report.mdに確認日と出力を記録する |
| Low-7 | `apps/api/src/procedures/couple.ts`等 | 内部エラーに一意のIDが振られていない（クライアントへの漏洩は無いことを確認済み） | RPCHandlerのinterceptorsで未定義エラーにUUIDを振る |
| Low-8 | `apps/api/src/index.ts` | `expo-authorization-proxy`の封鎖がパス文字列の完全一致に依存している（迂回経路は無いことを確認済み） | Better Authの`disabledPaths`オプションへ移す（直す必要は無い） |
| Low-9 | `apps/api/src/procedures/post.ts` | `post.create`が空判定と保存で異なる値（trim前後）を使っている（セキュリティ上の問題ではない） | 判定と保存で同じ値を使う |

### 情報（指摘ではないが記録）

- `authedProcedure`は`mode==="readonly"`を見ていない。現在は「未認証⟺readonly」の等価性に依存しており、将来「認証済みのデモ閲覧モード」を作る場合は4手続きを同時に見直す必要がある
- 入力検証は全手続きでZodを通っている。SQLは全35箇所がプレースホルダで文字列連結は無い
- CSPは妥当（インラインscriptハッシュのみ、R2ホスト決め打ち、frame-ancestors/object-src/base-uri/form-action全て設定済み）
- `apps/api/src`に`console.*`は1件も無く、機密情報のログ出力は無い

## 3. 総括

High以上はゼロ。Medium 4件のうちMedium-1はコードで直せる。Medium-2/3/4はいずれも
「リポジトリの外にある設定を、リポジトリからは確認できない」という同じ形をしている。
Public化の前に済ませるべき順序: Low-4（アクションのSHAピンとpermissions）→Medium-1
（デプロイ経路の検査）→T6の履歴全体gitleaks→T7の無視リスト再評価→Medium-2/3の実測記録。
