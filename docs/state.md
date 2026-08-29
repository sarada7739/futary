# 現在地

> セッション開始直後・コンテキスト圧縮直後は、まずこのファイルを読む。
> ファイル変更を伴う作業の完了時は、必ずこのファイルを更新する。

**最終更新**: 2026-08-29 / セッションB（L11（PR #51）をRレビュー往復1回・必須修正なしで受け入れ、mainへマージ。Rの記録2件をL48・L49に起票。次は009着手待ち——Aへ着手可否を確認中）

---

## 現在のフェーズ

**M1（001〜005）完了。2026-08-29、人間の明示的な受け入れ確認を得た。**
M2（006〜009: 投稿・画像・タイムライン・リアクション）着手済み。
006（投稿スキーマとAPI）はPR #33がRレビュー往復1回（必須修正なし）で受け入れられ、
mainへsquash merge済み。Rからの記録3件のうち旧L28・L30はAがPR #35で解決、
旧L29は`fix/write-procedure-narrow-member`（PR #37）としてBが対応しRの受け入れを得て
マージ済み。さらにAがRの先読み指摘2件（imageKeyをクライアントから受け取らない・
D1/R2の削除順序）をPR #38で反映済み。次は007（画像アップロード）着手。
以下は001〜006それぞれの実装経緯（過去の記録として残す）。

pnpm workspace / `packages/contract`（health.get）/ `apps/api`（Hono + oRPC + D1疎通）
/ `apps/app`（Expo Router + TanStack Query）/ CI を一通り繋いだ。
PR #1（ブランチ `task/001-walking-skeleton`）はレビュー往復2回でRの受け入れを得て、
squash mergeで `main` に取り込み済み（ブランチも削除済み）。
証跡は `artifacts/001/` を参照。

002は `packages/ui`（トークン + Text/Button/Card/Avatar/Screen）と
`apps/app/app/(tabs)/`（ボトムタブ5つ + FAB）を実装した。PR #3
（ブランチ `task/002-design-tokens-and-ui`）はレビュー往復2回でRの受け入れを得て、
squash mergeで `main` に取り込み済み（ブランチも削除済み）。
証跡は `artifacts/002/` を参照。

003はBetter Auth + Google OAuth + D1 + Expo SecureStoreを実装した。
`packages/db/src/schema/auth.ts`（user/session/account/verification）、
`apps/api/src/auth.ts`（Better Auth初期化）、`me.get`、ログイン画面
（`apps/app/app/(auth)/sign-in.tsx`）、`Stack.Protected` によるルーティングガード、
ログアウトを実装。security-auditor で High 2件検出→修正済み、Medium一部対応。
Rレビュー往復2回（R-17改: BETTER_AUTH_URL/TRUSTED_ORIGINSのホスト名検証、
R-18: fail-fast/CORS fail-closedのテスト追加）で受け入れを得て、PR #5
（ブランチ `task/003-auth-google`）を `main` へ squash merge 済み（ブランチも削除済み）。
詳細は `docs/security-report.md` と `artifacts/003/`。
**実際のGoogleアカウントでのログイン確認・Cookie属性の実地確認は未実施**
（人間の判断で「Google OAuthクライアント作成は今は後回し」となったため。
下記「次の一手」参照）。

PR #7・#8（`docs/conventions.md` のマージ戦略規定、D1にトランザクションが無い
前提への004/architecture.md修正）を規定の手順でsquash mergeし、`main`へ取り込み済み。

PR #16（worktreeのブランチ後片付け手順を`harness.md`に追加。squash mergeでは
`-d`ではなく`-D`が必要な理由も明記）・PR #17（005タスクファイルにあった
認可テストの5件目〈`DEMO_COUPLE_ID`未設定時のfail-closed〉を恒久側の
`security-requirements.md` 3節へ反映）を、人間からの指示によりレビュー結果
（いずれもコミット履歴上でRの指摘に対応済み）に従ってsquash mergeし、
`main`へ取り込み済み（ブランチも削除済み）。詳細は各PR本文参照。

004はペア作成と招待コードを実装した。`packages/db/src/schema/couple.ts`
（couples/couple_members/invites/invite_failures）、`apps/api/src/procedures/couple.ts`
（couple.create/get/update、invite.issue/accept）、招待コード生成
（`apps/api/src/lib/invite-code.ts`）、オンボーディング画面
（`apps/app/app/(onboarding)/`）を実装。D1にインタラクティブなトランザクションが
無い前提（architecture.md 4節）に従い、原子性は単一SQL文と`batch()`で表現した。
security-auditorを2回実行し、1回目でHigh 1件・Medium 3件・Low 5件、2回目
（1回目の修正確認）でMedium 1件・Low 2件を検出→全て修正済み（詳細は
`docs/security-report.md` と `artifacts/004/`）。テスト52件緑、型チェック・lint通過。
Rレビュー（PR未作成、`security-requirements.md`との齟齬〈L24〉の指摘）にも対応し、
PR #9を`main`へsquash merge済み（ブランチも削除済み）。
L24はAへエスカレーションし、Aが要件・タスクファイルを実装に合わせて修正した
PR #10も先にsquash merge済み。詳細は下記L24・L25参照。
**Google OAuthクライアント未設定のため、オンボーディング画面の実機確認は未実施**
（003のL14と同じ制約。下記「次の一手」参照）。

005は認可ミドルウェアを実装した。`apps/api/src/middleware/auth-context.ts`
の `resolveCoupleContext` が couple_id の解決を1箇所に集約する（認証済みは
`couple_members` から解決、未所属なら `NEEDS_ONBOARDING`。未認証は
`DEMO_COUPLE_ID` を `is_demo=1` のDB実データと突き合わせて解決し、
未設定・空文字・DB不一致なら `FORBIDDEN`。fail-closed）。
`apps/api/src/procedures/base.ts` に `readProcedure`/`writeProcedure`
（タスク定義の2種類）に加え `authedProcedure`（認証必須のみ・couple_id解決
なし）を追加し、couple配下の全5手続きが3基底のいずれかを必ず経由する
状態にした。security-auditorを2回実行し、Medium 2件（is_demo未検証、
couple.create/invite.acceptが基底を経由せず認可が2系統に割れていた）を
検出→修正・解消確認（High以上ゼロ）。Rレビュー往復2回
（router再帰走査による基底経由の機械的な検査を追加、assertionの強度を
「ミドルウェアが1つ以上」から「3基底のいずれかを含む」に強化）で受け入れを
得て、PR #19を`main`へsquash merge済み（ブランチも削除済み）。
詳細は `docs/security-report.md` と `artifacts/005/`。

006は投稿の永続化と取得を実装した。`packages/db/src/schema/post.ts`（`posts`テーブル。
`(couple_id, created_at)`複合インデックス）、`packages/contract/src/post.ts`
（`post.list`/`post.create`/`post.delete`）、`apps/api/src/procedures/post.ts`を実装。
`post.list`は`readProcedure`の上に載せ、`{createdAt, id}`をbase64エンコードした
不透明カーソルで1回20件固定のページングを行う（同一秒の投稿がページ境界を
またいでも重複・欠落しないことをテストで確認）。`post.create`/`post.delete`は
`writeProcedure`の上に載せ、画像情報は受け取って保存するだけ（アップロードは007）、
削除は`WHERE id=? AND couple_id=ctx.coupleId AND deleted_at IS NULL`の1文で論理削除する。
`security-requirements.md`3節の5項目チェックリストに投稿系3手続きを追加し
`authorization.test.ts`に反映。テスト90件（apps/api）緑、型チェック・lint通過。
security-auditorは起動していない（10節1の必須対象に該当せず、M2完了時にまとめる方針）。
詳細は`artifacts/006/test-results.md`と`docs/tasks/006-post-api.md`の実装メモ。
PR #33（ブランチ`task/006-post-api`）はRレビュー往復1回・必須修正なしで受け入れられ、
mainへsquash merge済み（ブランチも削除済み）。Rからの記録依頼3件は下記「未解決の論点」
L28〜L30を参照。

**2026-08-29、人間が実機でM1の残り確認項目をすべて実施した。**
実際のGoogleアカウントでのログイン成功（2アカウント）・D1への`user`/`account`
レコード作成・リロード後のログイン状態維持・Cookie属性（`HttpOnly`チェック済み・
`SameSite=Lax`。`Secure`はローカルhttp環境のため未チェックが正常）・
ログアウト→サインイン画面へ戻る導線・004のオンボーディング導線
（ペア作成→招待コード発行→別アカウントで参加）をすべて確認できた。
実機確認中に発見したバグ2件（callbackURLの相対パス問題、ボタン二重発火に
よるOAuth state競合）はPR #22で修正・マージ済み。詳細は
`artifacts/003/manual-check.md` と `docs/tasks/003-auth-google.md` の進捗節。

007は画像アップロード（R2）を実装した。`post.uploadUrl`（`imageId`をULIDでサーバ生成し、
R2の署名付きPUT URLを発行。有効期限5分）、`post.create`（画像はR2の実体確認
〈存在・サイズ8MB以内・Content-Type一致〉を経てから保存。本文か画像どちらか必須で
空投稿を拒否。旧L30）、`post.list`（署名付きGET URL・有効期限1時間を発行）、
`post.delete`（D1を先に更新しR2削除は失敗を握りつぶす。`image_key`は残す）を実装。
`packages/contract`の`post.create`は`imageKey`を廃止し`imageId`のみを受け取る形にした
（`coupleId`を含む鍵はクライアントから一切受け取らない）。R2の署名付きURL発行は
Workersバインディングでは不可能なため、S3互換APIをSigV4署名する`aws4fetch`を導入した
（`apps/api/src/lib/r2-signed-url.ts`）。`posts.image_key`にUNIQUE制約を追加
（`0004_post_image_key_unique.sql`）。`apps/app`にVitestベースのテスト基盤を初導入し
（React Native Testing Libraryは react-native 0.86 + React 19の組み合わせで動かず、
react-native-webエイリアス+jsdom+`@testing-library/react`に切り替えた。詳細は
タスクファイルの実装メモ）、`packages/ui`の`Button`に二重発火防止ガードを組み込んだ
（旧L26）。security-auditorを実行しHigh以上ゼロ。Medium 4件中3件・Low 1件中1件を
その場で対応済み（Content-Type検証の追加、imageIdのULID形式検証、他ペアimageIdの
テスト追加、Buttonの例外時ガード固着修正）。テストはapps/api 109件・apps/app 14件・
packages/ui 7件すべて緑、型チェック・lint通過。詳細は`docs/security-report.md`・
`artifacts/007/`・`docs/tasks/007-image-upload.md`の実装メモ。
**R2のS3互換API認証情報が`.dev.vars`に未設定のため、署名なしアクセスの拒否確認・
実際のアップロード実機確認は未実施**（003のGoogle OAuthクライアントと同じ制約。
下記「次の一手」参照）。PR #41はRレビュー往復1回・必須修正なしで受け入れられ、
mainへsquash merge済み（ブランチも削除済み）。**ただしRの指示により、実機確認
（署名なしアクセスの拒否）が済むまで007は「完了タスク」に移動しない**
（003・004と同じ扱い）。

Rからの記録依頼1件: R2のS3互換API認証情報が未設定の状態で画像付き投稿が
1件でもあると、署名生成が例外を投げるため`post.list`全体が500になる
（画像だけ欠落させる設計にはしていない）。fail-closedとして筋は通っており
デプロイ時の設定漏れにも気づきやすいため対応不要と判断されたが、記録のみ
残す（L33参照）。

## プロダクト概要

futary — ふたり専用SNS。「ふたりの毎日を、もっと特別に。」
詳細は `docs/requirements.md`。

## マイルストーン

| M | タスク | 内容 | 状態 |
|---|---|---|---|
| M1 | 001〜005 | 足回り・デザイン基盤・認証・ペア成立・認可 | **完了**（2026-08-29、人間の受け入れ確認済み） |
| M2 | 006〜009 | 投稿・画像・タイムライン・リアクション | 着手中（006完了、007はmainへマージ済み・実機確認待ちのため完了タスク未移動） |
| M3 | 010〜013 | カレンダー・統計・思い出し | 未着手 |
| M4 | 014〜016 | ゲストデモ・LP・仕上げと公開 | 未着手 |

各マイルストーンの区切りで**人間が実際に触って**受け入れを判定する。

## 完了タスク

- 001-walking-skeleton（PR #1、レビュー往復2回）
- 002-design-tokens-and-ui（PR #3、レビュー往復2回）
- 003-auth-google（PR #5、実機確認2026-08-29完了。人間の受け入れ確認済み）
- 004-couple-and-invite（PR #9、実機確認2026-08-29完了。人間の受け入れ確認済み）
- 005-authorization-middleware（PR #19、Rレビュー往復2回。人間の受け入れ確認済み）
- 006-post-api（PR #33、Rレビュー往復1回・必須修正なしで受け入れ。mainへsquash merge済み、ブランチも削除済み）
- 007-image-upload（PR #41、Rレビュー往復1回・必須修正なしで受け入れ。実機確認
  2026-08-29完了〈署名なし拒否・期限切れ失効・削除反映・Content-Type往復〉。
  Rの最終確認済み。`env.BUCKET`バインディング経由の確認のみL34へ持ち越し）

**M1（001〜005）完了。2026-08-29、人間の明示的な受け入れ確認を得た。**

## 進行中タスク

- 008-timeline-ui（PR #47、Rレビュー往復1回・必須修正なしで受け入れ。mainへ
  squash merge済み、ブランチも削除済み。**「完了タスク」へはまだ移動しない**
  ——`artifacts/008/`のスクリーンショットが未取得のため。L38参照。
  009完了時のM2受け入れ判定でまとめて回収する）
- 009-reactions（次に着手する。着手可否をAに確認中——Aは当初「Rが008を
  まだ見ていない」ことを理由に保留を指示していたが、実際には008・L11とも
  Rの受け入れ・マージが完了済みのため、状況をAへ再連絡した）

## 環境

| 項目 | 状態 |
|---|---|
| 作業フォルダ | `C:\Users\coco7\futary` |
| リポジトリ | `sarada7739/futary`（**Private**。016 で Public に切り替える。ADR-011） |
| 既定ブランチ | `main` |
| gh CLI | 2.98.0 認証済み（スコープ: repo / workflow / gist / read:org） |
| Cloudflare | 設定済み。D1 `futary-db`（`database_id: 37d32e5d-80a9-4bc9-bae4-e7019bebd883`）、R2 `futary-images`。**`workers.dev`サブドメイン未登録**（L34） |
| R2 APIトークン | **設定済み**（2026-08-29）。`.dev.vars`の`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`に実際の値が入っている（コミットしていない） |
| Google OAuth | **設定済み**（2026-08-29）。`.dev.vars` に実際のクライアントID/シークレットが入っている（コミットしていない） |

## 次の一手

1. `fix/ci-security-checks`（L11）は完了。**きれいな`main`の上で**009
   （リアクション）に着手する（008とファイルが重なるため、Rの008受け入れを
   待ってから開始する方針をA・Rと合意済み）。Rから申し送り: リアクションは
   まず`heart`の1種のみ（判断はRが引き取る）。`reaction.toggle`は`postId`を
   受け取るため、006の`post.delete`と同じ形（`couple_id = ctx.coupleId`を
   WHEREに含めた1文）で他ペアの投稿への到達を防ぐこと
2. **人間の対応が必要**: 008・009の完了後、M2受け入れ判定で実機確認を行う。
   008の`artifacts/008/`スクリーンショット（L38）をこのタイミングでまとめて撮る
3. **人間の対応が必要（任意・016の前までに）**: `workers.dev`サブドメインを
   Cloudflareダッシュボードで登録する。登録後、`env.BUCKET`バインディング経由の
   実クラウド確認ができるようになる（L34参照。急ぎではないが016では必須）
4. `docs/sample/風景/`（写真6枚）はまだ用途未定。投稿機能（007以降）で
   サンプルとして使うかどうかはAの判断待ち

## 未解決の論点

| # | 論点 | 影響 | 判断時期 |
|---|---|---|---|
| L1 | 公開ドメインを `*.workers.dev` にするか独自ドメインを取るか | LP の OGP・第一印象。転職アピールでは独自ドメインの方が印象が良い。003で `BETTER_AUTH_URL`/`TRUSTED_ORIGINS` を本番用に設定する際にも必要 | 015 の前 |
| ~~L2~~ | ~~ロゴのスクリプト体をどう用意するか~~ → **解決**（002） | | 解決済み |
| ~~L3~~ | ~~デモペアのシードデータに使う写真の入手先~~ → **解決**。人間が `docs/sample/プロフィール画像/`（人物2枚）と `docs/sample/透過素材/`（アイコン類4枚）を配置。**すべてAI生成画像で実在の人物ではない**ことを人間に確認済み。出自と用途の割り当ては `docs/sample/README.md` に記録した。014 では `packages/db/seed/README.md` からこれを参照する | | 解決済み |
| L4 | リアクションの種類を1種（ハート）にするか複数にするか | 009 の実装量。デザイン上はハート・コメント・共有・保存が並ぶ | 009 の中で B が1種で実装し、R が判断 |
| L5 | `apps/api/wrangler.toml` に D1 の `database_id` が平文でコミットされている | Private の間は問題ないが、016 で Public に切り替える際は要確認 | 016 の前 |
| ~~L6~~ | ~~CORS が localhost 固定~~ → **解決**（003）。`TRUSTED_ORIGINS` 環境変数化 + `.dev.vars`/`wrangler secret` 経由に変更 | | 解決済み（003） |
| L7 | `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` に `miniflare@...-alpha` 等が入っている | 安定版が出たら除外リストから外す | 随時（急ぎではない） |
| ~~L8~~ | ~~`packages/ui` の `shadow.fab` が `architecture.md` 7節に無い新規トークン~~ → **解決**（PR #12）。`shadow.fab` を7節の表に追記した | | 解決済み（PR #12） |
| L9 | ネイティブの Google ログイン未対応。`futary://` を `TRUSTED_ORIGINS` に含めていないため経路自体が無効（fail-closed）。`@better-auth/expo` はセッショントークンをURLクエリに載せる実装で、Androidはカスタムスキームの衝突リスクがある（003監査 Medium指摘） | ネイティブ対応（実機ログイン）を始める前に、検証済みディープリンク（Universal Links/App Links）への切替か、リスク受容のADR化が必要 | ネイティブ対応タスクの前 |
| ~~L10~~ | ~~Better Authの`rateLimit`がmemoryストレージのまま~~ → **解決（004）**。招待コード用には Better Auth の `rateLimit` を流用せず、`invite_failures` テーブル（user_id + IP + created_at）による専用の実装にした。Better Auth自体のOAuthエンドポイント向けrateLimitは003のまま未変更（別の課題として残る） | | 解決済み（004。Better Auth側のmemory storageは別課題） |
| ~~L11~~ | ~~CI に `pnpm audit` / gitleaks / Dependabot が無い（003監査 Low指摘）~~ → **解決**（`fix/ci-security-checks`）。gitleaks-action（検出1件で赤）、`pnpm audit --audit-level=high`（`pnpm-workspace.yaml` の `auditConfig.ignoreGhsas` で L39 の2件を無視）＋全重大度の出力専用ステップ（無視リストの影響は受けるが `(N ignored)` で件数は見える。詳細は `pnpm-workspace.yaml` のコメント参照）、Dependabot はリポジトリ設定でセキュリティ更新のみ有効化（`dependabot.yml` は作らない）。着手中に発見したhigh勧告未修正問題（旧L43。AのL39と重複のため統合済み）は無視リスト方式で解決 | | 解決済み（`fix/ci-security-checks`）。無視リストの再評価は016の前 |
| L12 | `apps/api/src/index.ts` に `app.onError` が無く、サーバ内部エラーに一意なIDが振られていない（003監査 Low指摘）。クライアントへの漏洩は無いことは確認済み | 障害追跡ができない | posts等、複雑な処理が増えるタスクで対応 |
| L13 | セキュリティヘッダ（CSP等）が未設定（003監査 Low指摘） | 要件7節未達 | Web配信・LP実装タスクで対応 |
| ~~L14~~ | ~~003で実際のGoogleログインが未検証（クライアント未入手のため人間判断で保留）~~ → **解決（2026-08-29）**。人間がクライアントを作成し、実機で全項目を確認した。実際のログイン成功（2アカウント）・D1への`user`/`account`レコード作成・リロード後のログイン状態維持・Cookie属性（`HttpOnly`/`SameSite=Lax`）・ログアウト導線・004のオンボーディング導線（ペア作成→招待コード発行→別アカウントで参加）を全て確認済み。実機確認中に発見したバグ2件はPR #22で修正済み。詳細は`artifacts/003/manual-check.md`の追記部分参照 | | 解決済み（2026-08-29） |
| ~~L15~~ | ~~`packages/ui` の `Button` に `secondary` バリアントを追加した（002は `primary`/`ghost` の2種）。`architecture.md` 未反映~~ → **解決**（PR #12）。7節に「ボタンのバリアント」節を新設し、primary/secondary/ghost の3種と用途を明記した | | 解決済み（PR #12） |
| L16 | ログイン画面の「ログイン」と「新しくはじめる」が同じ `handleGoogleSignIn` を呼ぶ。Google OAuthに新規/既存の区別が無い以上コードとしては正しいが、UIは別動作に見える（Rレビュー003 R-21で指摘） | 見た目と実際の挙動の齟齬 | 016の仕上げで文言・導線を再検討 |
| ~~L17~~ | ~~`conventions.md` 9節の見出しが過大表現~~ → **解決**。見出しを「違反が痕跡を残すようにする」に修正し、「検出できること・できないこと」の表を追加。自己申告であり意図的な詐称は見抜けないことを明記した | | 解決済み（Rの指摘） |
| ~~L18~~ | ~~A / R / B が単一の作業ツリーを共有している~~ → **解決**（PR #14）。git worktreeで役ごとに作業ディレクトリを分離した（`futary/`=B・`futary-A/`=A・`futary-R/`=R）。`main`はBの`futary/`が持つ。これによりconventions.md 9節の「Bに未コミットの作業がある間、Aは設計ドキュメントを変更しない」という制約が不要になり、Aはいつでも書ける | | 解決済み（PR #14） |
| ~~L19~~ | ~~squash merge により `Session:` トレーラーが `main` で失われる（実例 `a2f6eb2`）~~ → **解決**。`conventions.md` 7節に「マージ戦略」節を新設。squash を維持したうえで、マージ時に `--body` でトレーラーを明示的に書き込む手順と、マージ後の確認コマンドを規定。あわせて「1 PR = 1 役」と、その例外を作らずに済ませる手順（判断はメッセージで運び、ドキュメントは A 単独の PR で運ぶ）を9節に追加 | | 解決済み（Rの指摘） |
| ~~L20~~ | ~~「1 PR = 1 役」と9節の例外「A の変更を独立したコミットに分けさせる」が両立しない~~ → **解決**。例外を廃止した。B が必要とするのは判断であってドキュメントのマージではないため、判断はメッセージで即時に運び、ドキュメントは A 単独の PR で並行して進める。ただし `/clear` した新セッションはメッセージを引き継がないため、着手前に main へマージすることを明記 | | 解決済み（Rの指摘） |
| L21 | `invite.issue` にレート制限が無く、満員のペアでもコードを発行できる。`invites`行の定期削除も無く単調増加する（004監査2回目 Low指摘） | 招待コードの母集団が無駄に膨らむ。ただし「画面遷移だけで無条件に発行される」設計上のバグ（004監査2回目 Medium指摘）を修正済みで、発行が明示操作に限られたため実害は小さい | トラフィックが増えてから再検討。急ぎではない |
| L22 | 001の歩くスケルトンで作られた `packages/db/migrations/0000_init.sql` がコメントのみで実行可能な文を持たず、`wrangler d1 migrations apply` が失敗する実在のバグがあった（004で発見） | → **解決（004）**。無害な `SELECT 1;` を1文追加した。**追記（Rの指摘R-24を受けて検証）**: 001の実装メモ（`docs/tasks/001-walking-skeleton.md` R-1対応）は「ローカルD1にも `0000_init.sql` として再適用済み」と記録しており、当時は成功していたはずだが、ファイル内容自体は001から004まで一切変更されていない（`git log -p --follow` で確認）。004実装中に、隔離した検証用ディレクトリで実際に `npx wrangler@4.126.0 d1 migrations apply DB --local` と `npx wrangler@4.124.0`（両方ともこのリポジトリが依存関係として持つバージョン）を素の状態で実行し、**どちらも同じ「internal error」で失敗する**ことを確認した。したがってこの004内での「本番のwranglerでも失敗する」という判断自体は裏付けが取れている。一方、001時点で何が違って成功したのかは、より古いwranglerバージョンでのビセクトが必要で、004の範囲では特定できなかった。エラーメッセージは `X [ERROR] internal error` と非常に目立つ形で出るため、001当時に本当に踏んでいれば見逃したとは考えにくく、当時の環境（wrangler/workerdのより古いバージョン、または`.wrangler/state`のD1エミュレータ実装差）で挙動が異なっていた可能性が高いと推測する | 解決済み（004）。原因の完全特定は持ち越し（急ぎではない） |
| L23 | `invite_failures` の掃除DELETEが `created_at` 単独インデックスを持たず全表走査になる（004監査2回目 Low指摘） | D1の行読み取り課金・遅延の増幅要因 | 要件6節の想定規模（2人×1日数投稿）では時期尚早。急ぎではない |
| ~~L24~~ | ~~`security-requirements.md` 4節が実装（user_id 10回/時間 + IP 50回/時間の二本立て）と食い違っていた~~ → **解決**（PR #10）。security-requirements.md 4節に「レート制限のキー」を新設し、user_id 10回/時間 + ip_address 50回/時間とその非対称の理由を明記。004 タスクファイル2箇所も揃えた | | 解決済み（PR #10） |
| ~~L25~~ | ~~IP が取得できない場合（ローカル開発等）に user_id 単独で判定する分岐が `security-requirements.md` 4節に書かれていない~~ → **解決**（PR #12）。4節に「IPが取得できない場合はuser_id単独で判定する。ip_addressにはNULLを入れ、固定の代用文字列を入れてはならない」を追記した | | 解決済み（PR #12） |
| ~~L26~~ | ~~`packages/ui` の `Button` が環境によっては1クリックで `onPress` を2回発火させる。呼び出し側（画面ごと）にガードを書く運用では、005で潰した「手続きごとに認可を書くと書き忘れる」と同じ構造になる~~ → **解決**（PR #27）。`conventions.md` 4節に、ガードは`Button`コンポーネント自身が持つ（呼び出し側に書かせない）・`useRef`で持つ（`useState`は同一tick内の2回目を取りこぼす）・副作用のある操作に生の`Pressable`を直接使わない、を追記した。実装（`Button`への組み込み、004の既存ボタンへの適用）は007以降で行う | | 規約解決済み（PR #27）。実装は007以降 |
| ~~L27~~ | ~~`apps/app` にテスト基盤が一切無い。UIバグが実機確認でしか検証できず退行しても気づけない~~ → **解決**（PR #27）。新しいタスク番号は作らず、クライアント側ロジックが最初に出る007（画像圧縮）でVitest + React Native Testing Libraryを導入する方針に決定。最低2件（画像圧縮ユーティリティ、`Button`の二重押下でonPressが1回しか走らないこと）を書く。`docs/tasks/007-image-upload.md`に前提節・完了条件・進捗を追記済み。PlaywrightのE2Eは認証が重いため014のデモ経路（未認証）で導入する方針 | | 解決済み（PR #27） |
| ~~L28~~ | ~~`docs/tasks/006-post-api.md` の完了条件が「005 の認可テスト**4件**」を指しているが、恒久基準（`security-requirements.md` 3節、PR #17で5件に更新済み）は**5件**~~ → **解決**（PR #35）。全タスクファイルを走査した結果、件数を書いていたのは006だけだったと判明。006の記述を件数抜き（`security-requirements.md` 3節を指すだけ）に訂正し、`conventions.md` 9節に「件数・項目数は出典側にだけ置く。引用側に書かない」を規約として追加した | | 解決済み（PR #35） |
| ~~L29~~ | ~~`apps/api/src/procedures/base.ts` の `writeProcedure` の戻り値型 `CoupleContext` が union のままで、readonly を実行時に弾いた後も `userId` が型上 `string \| null` のまま絞り込まれない~~ → **解決**（PR #37）。`writeProcedure` の OutContext を `Extract<CoupleContext, {mode: "member"}>` に変更し、`post.create` にあった到達不能な `if (userId === null) throw ...` を削除した。AがB案（`fix/`対応）を支持し、Rの受け入れを得てmainへマージ済み | | 解決済み（PR #37） |
| ~~L30~~ | ~~投稿の本文・画像がどちらも空の投稿を作成できてしまう（`post.create` に下限が無い）~~ → **解決**（PR #35）。「本文か画像のどちらかは必須」を要件化（`requirements.md` 4節）。006の時点では画像が無く下限を置けなかったため、画像が入る007で弾く形に揃える（`architecture.md` 5節・`docs/tasks/007-image-upload.md`に実装項目を追加済み。空白のみの本文も空として扱い、両方空・空白のみの2ケースをテストする） | | 解決済み（PR #35。実装は007） |
| L31 | `post.uploadUrl`にレート制限が無く、`post.create`を呼ばずにR2へアップロードだけを繰り返すと無参照オブジェクトが際限なく作れる（007 security-auditor Medium指摘）。誰でも到達可能（`couple.create`は`authedProcedure`のみ）で、金銭コスト・ストレージ増大につながる。機密性には影響しない | 016前のコスト管理・運用面。放置するとR2の課金が投稿数に対して不自然に増える | 016の前、またはトラフィックが増えた時点で再検討。`invite.accept`のレート制限の仕組み（`invite_failures`と同型）を流用できる。無参照オブジェクトの定期回収ジョブも未実装（`architecture.md`6節でMVP外と明記済み） |
| ~~L32~~ | ~~007でR2のS3互換API認証情報（`R2_ACCOUNT_ID`等）が未設定のため、署名なしアクセスの拒否確認・実際のアップロード実機確認が未実施~~ → **解決（2026-08-29）**。人間がR2 APIトークンを発行し`.dev.vars`に設定した後、実クラウドR2に対して確認した。署名付きPUT成功→署名なしGETは`400`で拒否→署名付きGETは成功しサイズ一致→期限切れGETは`403`で拒否→削除後は`404`、という一連の流れを確認済み（`artifacts/007/manual-check.md`）。**Rレビュー指摘を受けて追加確認**: 署名付きPUT URLはContent-Typeを署名で強制できないため、`post.create`の`head.httpMetadata?.contentType`検証が機能するには「クライアントがヘッダを送る」「R2がそれを保持する」の両方が必要。`apps/app/lib/image.ts`と同じ形でPUTし、署名付きGETのレスポンスヘッダで`content-type: image/jpeg`が返ることを確認し、両方揃っていることを実証した（Rが「結果がimage/jpegならそのまま完了タスクへ移してよい」と判定）。`env.BUCKET`バインディング経由（`wrangler dev --remote`が必要）の確認のみL34へ持ち越し | 完了条件を実機で満たした | 解決済み（2026-08-29）。007は「完了タスク」に移動済み |
| L34 | このCloudflareアカウントは`workers.dev`サブドメインが未登録のため、`wrangler dev --remote`が実行できない（007の実機確認中に発覚）。新しい`experimental_remote`（バインディング単位のリモート接続）もwrangler 4.126.0/4.127.1では未対応の設定項目として無視され、Workerランタイムがクラッシュする | `env.BUCKET`等のWorkersバインディングを実クラウドに向けたローカル開発・確認が一切できない。**016（公開）では必ず必要になる**（Rの指摘。デプロイ時に初めて気づくと止まる）。007で未確認のまま残った`env.BUCKET`経由の実クラウド動作確認（`post.create`のhead確認・`post.delete`のR2削除）もここにぶら下げる | **016の前**。人間がCloudflareダッシュボード（`https://dash.cloudflare.com/d08a3c92a0ca2b448831a612221af692/workers/onboarding`）で`workers.dev`サブドメインを登録する。登録後、`.claude/launch.json`の`api-dev-remote`設定（007で追加済み）で`wrangler dev --remote`を試し、`env.BUCKET`経由の確認もまとめて行う |
| L33 | R2のS3互換API認証情報が未設定の状態で画像付き投稿が1件でもあると、`r2-signed-url.ts`の`clientFor`が署名鍵未設定で例外を投げるため`post.list`**全体**が500になる（画像だけ欠落させる設計にはしていない。007 Rレビュー記録依頼） | fail-closedとして筋は通っており、デプロイ時の設定漏れに気づきやすい利点もあるとRは評価。画像の無い投稿しか無い開発初期は顕在化しない | 対応不要と判断済み（記録のみ）。将来「画像だけ表示しない」形に緩めるかは、実際に運用で困った時に再検討 |
| L35 | 投稿カードに必要な投稿者名・アバターが投稿スキーマに無かった（006 は `authorId` のみ、`me.get` は自分の情報しか返さない）。008 着手時に B が発見 | → **解決（008 で対応）**。`post.list`/`post.create` のレスポンスに `authorName`/`authorImage` を追加する。`architecture.md` 5節に設計を追記した。LEFT JOIN・両方 null 許容・`authorImage` は Google の外部URL（CSP の `img-src` 許可が要る。L13 に紐づく）。**A が最初に書いた「`author_id` は外部キーを持たない」という理由付けは誤りで、B の実測で訂正済み**（FK は存在する。投稿者が引けない状態は現在到達不能）。LEFT JOIN と null 許容は維持するが、根拠を「将来 `ON DELETE` が変わったときの壊れ方が INNER JOIN の方が悪い」に置き換えた。到達不能な備えであることを明記し、達成不能だった完了条件（「`user` 行が無くても投稿が落ちない」テスト）は削除した | 解決済み（設計はA、実装は008。理由付けの訂正あり） |
| L36 | 008 の完了条件が「E2Eテスト（ログイン→投稿→一覧に現れる）」を要求していたが、007 で「Playwright は認証が重いので 014 の未認証デモ経路で導入する」と決めていた。008 は 007 より前に書かれており、決定が引用側に反映されていなかった。さらに `conventions.md` 6節は E2E が「ログイン→投稿→リアクション→デモ閲覧」を覆うと書いており、**実際には作らない保証を恒久ドキュメントが主張していた** | → **解決**。008 の完了条件を画面結合テスト（RNTL + oRPC モック）に置き換え、`conventions.md` 6節の E2E を「未認証のデモ閲覧経路のみ」に訂正。認証を伴う導線は人間の実機確認で担保すると明記した。モックはサーバとの契約を検証しないことも書いた | 解決済み |
| L37 | `posts.author_id` は `user(id)` への外部キーを `ON DELETE no action` で持つ（008 で B が実測確認。D1 が実際に強制し、`PRAGMA foreign_keys = OFF` も無視される）。このため**将来アカウント削除機能を作ると、投稿が1件でも残っているユーザーの削除が DB エラーで失敗する** | 削除フローの設計時に、投稿の扱い（連鎖削除・匿名化・`ON DELETE` の変更）を先に決める必要がある。想定より安全側に倒れているが、気づかないとリリース直前に詰まる | アカウント削除機能を設計するとき。MVP スコープ外なので急ぎではない |
| L38 | 008 の完了条件のうち `artifacts/008/` のスクリーンショット（一覧・空状態・投稿作成、スマホ幅とPC幅）が**未取得**。認証必須の画面のため人間の Google ログインが要り、依頼時点で人間が出先だった。コード側は完成・テスト全緑 | 008 の UI が人間の目で一度も確認されていない状態で `main` に載る。画面結合テストは oRPC クライアントをモックするため、サーバとの契約もレイアウトも検証していない（`conventions.md` 6節） | **009 完了時の M2 受け入れ判定でまとめて回収する**（`conventions.md` 8節の手順。前例は L14）。それまでレビューとマージは止めない |
| L39 | **`@better-auth/expo` が `apps/api`（デプロイされる Worker）の本番依存になっており、Expo のツールチェーン一式（`@expo/cli` → `react-native` → `metro`）を依存グラフに引き込んでいる。** これが `pnpm audit --prod` でも high 2件（`image-size`）が消えない直接の原因（L11 で実測確認。B が着手前に発見しAへ報告、対応方針はAが決定） | Worker の依存グラフが実際にバンドルされるものより大幅に広い。監査の精度が落ち、無視リストを持つ必要が生まれている | **016 の前。** サーバ側の Better Auth に `@better-auth/expo` が本当に必要か確認する。不要なら high 2件は消え、無視リストを空にできる。必要なら、なぜ必要かを記録する |
| L44 | FAB（`packages/ui/assets/fab-plus.png`）の円の色が画像に焼き込まれている（実測 `#F4858C`）。トークン `primary`（`#F5868D`）とは1/チャンネル差があり視認できないが、`primary` を変えても FAB は追従しない（008 Rレビュー R-26） | ピンクの円＋白の＋という多色画像のため `tintColor` が使えず妥当な判断だが、タブアイコン（`tintColor` で追従）との非対称が生まれた。002の「色をトークンに集約する」方針が部分的に巻き戻っている | 記録のみ。デザイントークンを変更するタスクが出たときに思い出すこと |
| L45 | `apps/api/src/procedures/post.ts` の `postCreate` が `context.user!`（非null表明）を使っている。`CoupleContext` の `mode:"member"` variant が `userId` しか持たず `user` オブジェクト自体を持たないための回避策で、PR #37 で `writeProcedure` の戻り値型を絞り込んだのと同型の問題（008 Rレビュー R-27） | 009・010 で投稿者情報が必要になるたびに同じ表明が繰り返される。member variant に `user` そのものを載せれば型で消せる | 急ぎではない（アサーション自体は健全）。`CoupleContext`/`base.ts` を触るタスクで合わせて検討 |
| L46 | `post.list` の署名付きGET URL（有効期限1時間）が期限切れのまま表示される事故は、`refetchInterval: 60秒` と TanStack Query の既定 `staleTime: 0` の組み合わせでたまたま防がれている。**意図して置いた保証ではない**（008 Rレビュー R-28） | 将来 `apps/app/lib/query.ts` の `staleTime` を伸ばす変更をすると、期限切れURLでの画像読み込み失敗が起きうる | 記録のみ。`lib/query.ts` に注意コメントを足すと親切（急ぎではない） |
| L47 | squash merge で生成される `main` 上のマージコミット自体（例: 008マージの `f7bcea2`）には `Session:` トレーラーが付かない。`conventions.md` 9節は「全てのコミットメッセージ」にこれを要求しており、gitが自動生成するマージコミットが対象に含まれるかが規約上未規定（008 Rレビュー R-29。Aへ要判断） | 「全コミットに要求」という文言と実態（マージコミットには付けようがない）が食い違ったまま。判定基準が曖昧だと次のマージでも同じ疑問が出る | Aへ判断依頼中。9節にマージコミットの扱いを明記すれば解決 |
| L48 | `gitleaks-action@v2` は `push`/`pull_request` イベントでは**その回のコミットだけ**を走査する。`fetch-depth: 0` は差分計算用で、全履歴の走査ではない。リポジトリ全体を見るのは `schedule`/`workflow_dispatch` のときだけ（L11 Rレビュー R-30） | 016完了条件の「gitleaksが緑」は差分走査が緑という意味でしかなく、「履歴のどこにも秘密が無い」ことは証明しない。003監査時にも同じ穴（`git log --all` の走査ができない）が指摘されていた | `security-requirements.md` 9節に既に「公開前に履歴全体を1度走査する」規定はあるが、実行方法（`workflow_dispatch`か`schedule`を1本足す）は未実装。016の前に対応 |
| L49 | Dependabotのセキュリティ更新のみ有効化（`vulnerability-alerts`・`automated-security-fixes`）はリポジトリ設定のAPI経由で行い、`dependabot.yml`を作らなかったため、**設定がリポジトリ内に痕跡を残さず、レビューやCIでは検証できない**（L11 Rレビュー R-31。実測: `gh api repos/{owner}/{repo}/vulnerability-alerts`→204、`gh api repos/{owner}/{repo}/automated-security-fixes`→`{"enabled":true,"paused":false}`で現在は有効と確認済み） | 誰かが無効化しても誰も気づけない | 016の確認手順に上記2つの`gh api`コマンドでの実測確認を追加する |

## 決まっていることの要約

| 項目 | 決定 |
|---|---|
| データモデル | 最初から複数ペア対応（couple 単位） |
| フロント | Expo Router + React Native Web 単一コードベース、LP は素のHTML別置き |
| 認証 | Google OAuth のみ |
| ペア参加 | 6桁の招待コード（有効期限24時間） |
| 画像 | 1投稿1枚。クライアント側で圧縮し R2 へ直アップロード |
| 通知 | 作らない。ポーリングで代替 |
| カレンダー | 記念日・予定・会った日を `events` 1テーブルに統合 |
| デモ | 未認証・閲覧専用。書き込みはサーバ側で全拒否 |
| 期間 | 2〜4週間で公開 |

判断の理由は `docs/decisions.md`。
