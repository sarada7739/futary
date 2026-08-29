# 現在地

> セッション開始直後・コンテキスト圧縮直後は、まずこのファイルを読む。
> ファイル変更を伴う作業の完了時は、必ずこのファイルを更新する。

**最終更新**: 2026-08-29 / セッションB（006: 投稿スキーマとAPI 完了。PR #33 マージ済み）

---

## 現在のフェーズ

**M1（001〜005）完了。2026-08-29、人間の明示的な受け入れ確認を得た。**
M2（006〜009: 投稿・画像・タイムライン・リアクション）着手済み。
006（投稿スキーマとAPI）はPR #33がRレビュー往復1回（必須修正なし）で受け入れられ、
mainへsquash merge済み。次は007（画像圧縮・アップロード）。
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

## プロダクト概要

futary — ふたり専用SNS。「ふたりの毎日を、もっと特別に。」
詳細は `docs/requirements.md`。

## マイルストーン

| M | タスク | 内容 | 状態 |
|---|---|---|---|
| M1 | 001〜005 | 足回り・デザイン基盤・認証・ペア成立・認可 | **完了**（2026-08-29、人間の受け入れ確認済み） |
| M2 | 006〜009 | 投稿・画像・タイムライン・リアクション | 着手中（006完了） |
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

**M1（001〜005）完了。2026-08-29、人間の明示的な受け入れ確認を得た。**

## 進行中タスク

（現在なし。007着手前）

## 環境

| 項目 | 状態 |
|---|---|
| 作業フォルダ | `C:\Users\coco7\futary` |
| リポジトリ | `sarada7739/futary`（**Private**。016 で Public に切り替える。ADR-011） |
| 既定ブランチ | `main` |
| gh CLI | 2.98.0 認証済み（スコープ: repo / workflow / gist / read:org） |
| Cloudflare | 設定済み。D1 `futary-db`（`database_id: 37d32e5d-80a9-4bc9-bae4-e7019bebd883`）、R2 `futary-images` |
| Google OAuth | **設定済み**（2026-08-29）。`.dev.vars` に実際のクライアントID/シークレットが入っている（コミットしていない） |

## 次の一手

1. `docs/tasks/007-*.md`（画像圧縮・アップロード）を読み、実装に着手する
2. `Button`の二重発火防止（旧L26）・`apps/app`のテスト基盤導入（旧L27）は
   007で実装する方針が決定済み（`docs/tasks/007-image-upload.md`参照）
3. `docs/sample/風景/`（写真6枚）はまだ用途未定。投稿機能（007以降）で
   サンプルとして使うかどうかはAの判断待ち
4. L28（006タスクファイルの完了条件が古い基準のまま）・L30（投稿の本文/画像下限なし）
   はAの判断待ち。L29（writeProcedureの型絞り込み）はBが`fix/`で対応可能

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
| L11 | CI に `pnpm audit` / gitleaks / Dependabot が無い（003監査 Low指摘） | T6/T7 の対策が手動実行に依存 | 次のタスクで着手可能。急ぎではない |
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
| L28 | `docs/tasks/006-post-api.md` の完了条件が「005 の認可テスト**4件**」を指しているが、恒久基準（`security-requirements.md` 3節、PR #17で5件に更新済み）は**5件**。006の実装自体は5項目全てをposts に拡張済みで実害は無いが、タスクファイルの記述が古い基準を指したままになっている（006 R-1指摘）。007以降のタスクファイルにも同じ古い記述が残っていないか、あわせて確認が必要 | タスクファイルが古い基準を参照したまま残ると、次にこの部分だけを読んで実装するタスクで基準を1つ落とす可能性がある | Aの判断待ち（完了条件はAの領分。conventions.md 9節の手順） |
| L29 | `apps/api/src/procedures/base.ts` の `writeProcedure` の戻り値型 `CoupleContext` が union のままで、readonly を実行時に弾いた後も `userId` が型上 `string \| null` のまま絞り込まれない（006 R-2指摘）。`post.create`（`apps/api/src/procedures/post.ts`）で到達不能な `if (userId === null) throw ...` を書く回避策が必要になった | 007以降の全書き込み手続きで同じ回避コードが繰り返される見込み。設計ドキュメントの変更を伴わない型定義の修正（`Extract<CoupleContext, {mode: "member"}>` 等）で解消できるため、Aの判断を待たずBが`fix/`で対応可能と判断 | 増える前に対応する価値がある。次のタスク着手前を目安に`fix/`で対応 |
| L30 | 投稿の本文・画像がどちらも空の投稿を作成できてしまう（`post.create` に下限が無い）（006 R-3指摘） | 実害は薄いが、007で画像アップロードが実装される前に「本文か画像のどちらかは必須」を要件として決めておくと実装が綺麗になる | Aの判断待ち（要件の話。007着手前が望ましい） |

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
