# 016: 仕上げと公開 検証結果（デプロイ前パート）

`docs/tasks/016-release.md`の「デプロイ前にできる」をすべて実施した。
「人間の手が要る」「デプロイ後にしかできない」は対象外（`docs/state.md`参照）。

## 本番デプロイ後の実機確認（人間パート完了後）

人間がRequired reviewers設定・Cloudflare/Google/R2の各種設定・PR #172の
マージと承認・本番D1/R2へのデモシード投入を完了させた後、Bが本番URL
（`https://futary-api.sarada7739.workers.dev`）へブラウザで実際にアクセスし、
以下を確認した。

**デプロイ直後に発生し、解決した2件の不具合**（どちらも設定ミスであり
コードの不具合ではない）:
1. `couple.get`が500（プレーンテキストの`Internal Server Error`）を返す。
   oRPC側（`withErrorId`）のJSONレスポンスではなくHonoの既定エラーだったため、
   Better Authの初期化（`createAuth`のfail-closedなassertion）より手前で
   例外が起きていると判断し、`BETTER_AUTH_SECRET`・`BETTER_AUTH_URL`の
   Cloudflare Worker側シークレットの設定を確認・修正してもらったところ解消し、
   403（デモ未整備による正しい拒否）に変わった
2. 「ログイン」を押すとGoogle側で`エラー 400: redirect_uri_mismatch`。
   Google Cloud Consoleの承認済みリダイレクトURIに本番URLの
   `/api/auth/callback/google`が未登録だったため。登録後、正式なGoogle
   ログイン画面（`accounts.google.com`）まで正しく遷移することを確認した
   （実際の認証情報でのログイン完了は人間が別途実施）

**デモシード投入後の実機確認**（`pnpm --filter @futary/db run seed:remote`。
193クエリ・662行書き込み、画像6件をR2へアップロード。全て成功）:
未認証のまま本番URLの`/app/`を開き「ゲストではじめる」を押し、以下を
ブラウザで直接確認した。

| 画面 | 確認内容 |
|---|---|
| ホーム | デモバナー・ゆい/れんのアバター（R2署名付きURL経由）・「付き合って561日目」・「会った日数：94日」・機能パネル8枚が正しく表示 |
| タイムライン | 投稿一覧・R2署名付きURL経由の画像（紅葉の写真）が正しく表示 |
| カレンダー | 会った日のマーカーが正しい日付に表示 |
| 思い出 | 「1ヶ月前の今日」・R2署名付きURL経由の画像が正しく表示 |
| 統計 | 記念日「付き合って561日目」・会った日数94日・投稿数43件・写真の枚数4枚（シード投入時のログと一致） |

R2署名付きURL経由の画像がタイムライン・思い出の両方で表示されたことから、
R2 CORS設定・R2バケットの署名付きURL発行の両方が本番で正しく機能している
ことも合わせて確認できた。

**未実施（記録）**: モバイル幅でのスクリーンショット取得を試みたが、
Browser paneのモバイルビューポートエミュレーション下でクリック操作が
毎回タイムアウトする現象が発生し（画面の表示自体は正常。原因未特定）、
実際のPNGファイルとして`artifacts/016/`へ保存することはできなかった。
デスクトップ相当の幅では上記の通り全画面を実際に操作して確認済みであり、
横スクロールの発生等の見た目の破綻も無いことは目視で確認している。
「本番のスクリーンショットを画像ファイルとして保存する」という完了条件の
字義どおりの達成はできていない点を正直に記録する。

## PR #172 Rレビュー対応（R-1〜R-3）

- **R-1（本番D1へのマイグレーション適用に、許可も事前確認も無い）**: 2点対応した。
  (1) `0013_event_repeat_yearly_check.sql`の先頭コメントが要求する人間向けの
  事前確認（CHECK制約に違反する既存行が無いかを数える）を
  `scripts/check-remote-migration-preconditions.mjs`として自動化し、
  `db:migrate:remote`の直前に実行するようdeploy.ymlに追加した。違反行がある
  ままだと__new_eventsが残骸として残り以降の全pushが同じ場所で失敗し続ける
  （#170レビューで実測済み）ことへの対策。(2) `architecture.md`6節の
  「適用には人間の許可を取る」を自動デプロイ後も維持するため、"production"
  GitHub EnvironmentへのRequired reviewers設定が必要だが、これはGitHubの
  リポジトリ設定でありコードでは設定できないため、
  `docs/tasks/016-release.md`の人間パートへ追加した。設定されるまで
  deploy.ymlは無条件に本番へデプロイすることをコメントに明記した
- **R-2（deploy.ymlの独立検証がci.ymlの部分集合になっている）**: ci.ymlに
  あってdeploy.ymlに無かった2つ（無視リストの陳腐化検出・drizzleスナップショット/
  スキーマのずれ検出）を追加し、ダミー`.dev.vars`の作り方もci.ymlと同じ
  ファイル方式に揃えた（env直渡しでは`@cloudflare/vitest-plugin`が読まない
  可能性があったため、この機会に修正）
- **R-3（014の受容理由を016が反証したまま残っている）**: `root-route.test.ts`・
  `_layout.tsx`の両方にあった「認証済み利用者がcouple.getで通信エラーを
  受けても再試行でじきに解消する」という記述を、実際は`retry: false`のため
  自動再試行が無く止まったままになることを踏まえて訂正した。
  `resolveRootRoute`の期待値（既知のギャップとして0個を許す）自体は
  変更していない

小さな指摘（1点、記録のみ）: `apps/api/src/lib/error-id.ts`の対象が
`/api/*`（oRPC手続き）のみで`/api/auth/*`（Better Auth）は対象外である旨を
コメントに明記した（付け忘れではなく意図的な範囲であることを示すため）。

## 3状態（読み込み中/空/エラー）の通し確認と補完

全13画面（`apps/app/app/`以下）をExploreエージェントで調査した。timeline.tsx・
calendar.tsx・stats.tsx・compose.tsx・onboarding配下は既に3状態を適切に扱っており、
以下4箇所に欠落を発見・修正した:

- **profile.tsx**: `me.get`/`couple.get`の`isLoading`/`isError`を一切参照しておらず、
  取得中・失敗時ともフォームが空欄のまま止まって見えた。ローディング表示・
  エラー表示（再試行ボタン付き）を追加した
- **memory-card.tsx**: 読み込み中・エラー・該当なしを全て`return null`にしていた。
  当時の設計判断時点（ホームの補助パネルの1つ）では他の要素が画面を埋めていたが、
  現在は`memory.tsx`（思い出タブ）がこのカードだけを描画する構成になっており、
  画面がほぼ空白のまま何も伝わらなかった。3状態それぞれに案内文を出す形に変更した
- **stats-card.tsx**: エラー時にカード自体を消していた。統計取得失敗が利用者に
  伝わらないため、エラー文と再試行ボタンを表示する形に変更した
- **_layout.tsx**: 認証済み利用者が`couple.get`でNEEDS_ONBOARDING以外のエラー
  （通信断等）を受けると、`Stack.Protected`の3つのguardが全てfalseになり
  空白画面のまま止まる経路があった（コードの既存コメントは「再試行でじきに
  解消する」としていたが、`retry: false`のためreact-queryの自動再試行も
  無く、実際には永久に止まる）。再試行UIを追加した。読み込み中の完全な
  空白表示にも最小限のテキストを追加した

修正した4画面はいずれもテストを追加・更新し、`pnpm -w test`で確認済み
（`apps/app`: 150件→152件）。`_layout.tsx`のRootNavigatorコンポーネント自体には
既存のテスト基盤が無く、新設は本タスクのスコープに対して過大と判断し追加していない。
ロジックの中核（`resolveRootRoute`純関数）は既存の網羅的テスト
（`root-route.test.ts`。32通りの状態空間を全数検査）でカバーされており、
今回の修正はレンダリング側（どのUIを出すか）の追加のみで、この純関数の
契約・戻り値は変更していない。

## エラー処理の統一

- **内部情報を出さない**: oRPCの既定動作（`toORPCError`）が、`ORPCError`でない
  例外を`"Internal server error"`という固定メッセージに変換し、スタックトレース・
  SQL文・ファイルパスはクライアントへのJSONに含まれないことを、`@orpc/client`の
  実装（`toORPCError`・`ORPCError.toJSON()`）を読んで確認済み（security-auditor
  全体監査でも同じ結論。詳細は`artifacts/016/security-audit-raw.md`）
- **エラーIDの付与**: 上記は「常に同じメッセージ」になるため、利用者からの
  問い合わせとサーバログを突き合わせる手段が無かった（security-auditor指摘
  Low-7）。`apps/api/src/lib/error-id.ts`の`withErrorId`をRPCHandlerの
  interceptorsに登録し、想定外の例外（procedureのバグ・DBエラー等）だけに
  UUIDを振り、フルの詳細はサーバログに、クライアントにはIDのみを返す形にした。
  ORPCErrorのインスタンス（procedureが意図的にthrowするFORBIDDEN等）と
  SyntaxError（リクエストボディのJSONパース失敗。既存のBAD_REQUEST変換経路を
  壊さないため）は素通しする。単体テスト3件・DBバインディングを壊して
  実際にHTTPレスポンスまでID付きで伝わることを確認する結合テスト1件を追加した
  （`apps/api/test/error-id.test.ts`）
- **エラーメッセージの日本語統一**: `apps/app`全体を走査し、利用者に見える
  エラー・空状態メッセージが英語のみになっている箇所が無いことを確認した

## デプロイワークフロー

`.github/workflows/deploy.yml`を新規作成（ファイルのみ。走らせていない）。
`main`へのpushでリモートD1マイグレーション→デプロイを実行する構成。
security-auditor全体監査Medium-1指摘を受け、ci.ymlと同じgitleaks・
`pnpm audit --audit-level=high`のゲートも追加した（デプロイ経路がCIの
合否と独立して走るため、ci.ymlが赤でもdeploy.ymlは止まらず本番へ到達しうる
という指摘）。Low-4指摘を受け、`permissions: contents: read`を明示し、
全アクション（ci.yml側も含む）をコミットSHAで固定した。

## `pnpm audit` 全重大度・無視リストの再評価

`pnpm audit`（全重大度）: 4件（high 2件・moderate 2件）。high 2件は
`pnpm-workspace.yaml`の無視リスト（`image-size`のDoS、Metro経由の開発時依存）で
除外済み。GitHub Advisory APIで再評価し、両方とも修正版が依然存在しない
（`"patched": null`）ことを確認。到達可能性の評価も変わっていないため維持した。
moderate 2件（`esbuild`・`uuid`。いずれも開発時・ビルド時依存）は
`docs/security-report.md`に記録した。

## 履歴全体の gitleaks

この環境にgitleaksが無かったため、winget（`Gitleaks.Gitleaks`。公式配布元）で
導入した。`gitleaks detect --source . --log-opts="--all"`を実行し、
**215コミット・約3.48MBを走査して検出ゼロ**を確認した。

## security-auditor の全体監査と T1〜T8 の確認

`docs/security-requirements.md` 9節のT1〜T8それぞれについて、対策の実装箇所を
コードから確認するようsecurity-auditorへ依頼した。**High以上の指摘は0件。**
Medium 4件・Low 9件のうち、コードで直せるもの（Medium-1・Low-2・Low-3・Low-4・
Low-5・Low-7・Low-9）は対応済み、リポジトリ外の設定に依存するもの（Medium-2は
ファイル化で対応、Medium-3は人間パートへ追加、Medium-4は運用方針を記録、
Low-1・Low-6・Low-8は記録のみ）は`docs/security-report.md`に記録した。
生の返答は`artifacts/016/security-audit-raw.md`。

## README

`.dev.vars`のセットアップ手順（従来欠落していた）・技術構成と設計判断への
リンク・開発体制（Maker-Checker分離。`docs/harness.md`へのリンク）・公開URL欄
（デプロイ後に記載するプレースホルダ）を追加した。

## 未認証のデモ閲覧経路の E2E

`conventions.md` 6節の範囲（未認証のデモ閲覧経路のみ。認証を伴う導線は
自動化しない）でPlaywrightを導入した。`e2e/demo-guest.spec.ts`が
「デモを開く→閲覧できる（デモバナー・記念日カードの表示）→書き込みが
拒否される（`couple.update`を未認証のまま叩き403・FORBIDDENを確認）」を
検証する。`scripts/e2e-server.mjs`がローカルD1へのマイグレーション適用・
デモシード投入・`build:public`・`wrangler dev`起動を行い、本番と同じ
単一オリジン構成で検証する。実行結果: **1件成功**。

CIには組み込んでいない（PlaywrightのブラウザインストールがCIの実行時間・
コストを大きく増やすため）。`pnpm run test:e2e`で手元またはリリース前に
都度実行する運用とした。

## 全体テスト・lint・型チェック

`pnpm -w test`（apps/app 152件・apps/api 303件）・`eslint .`・
`pnpm -r type-check`（`e2e/`・`playwright.config.ts`を含む）全て通過。

## 完了条件チェック（デプロイ前パートのみ）

- [x] gitleaks と `pnpm audit` が緑（ローカル実行。CIでも同じゲートが走る）
- [x] gitleaks を履歴全体に対して実行し、検出ゼロである
- [x] `pnpm.auditConfig.ignoreGhsas` の全項目を再評価し、結果を記録した
- [x] security-auditor の全体監査で High 以上がゼロ
- [x] `docs/security-report.md` に監査結果が記録されている
- [x] README が完成している
- [x] 未認証のデモ閲覧経路の E2E が緑（自動）
- [ ] 本番URLでアプリとデモが動く（デプロイ後）
- [ ] 本番で画像付きの投稿ができる（デプロイ後）
- [ ] ログインを含む通しを人間が確認した（デプロイ後）
- [ ] リポジトリを Public に切り替えた（人間）
- [ ] `artifacts/016/` に本番のスクリーンショット・E2E結果・監査結果を保存
      （E2E結果・監査結果は本ファイルと`security-audit-raw.md`に保存済み。
      本番のスクリーンショットはデプロイ後にしか撮れない）
