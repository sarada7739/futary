# 現在地

> セッション開始直後・コンテキスト圧縮直後は、まずこのファイルを読む。
> ファイル変更を伴う作業の完了時は、必ずこのファイルを更新する。

**最終更新**: 2026-08-27 / セッションB（PR #9・#10 マージ後のdocs更新）

---

## 現在のフェーズ

**001・002完了。003（認証基盤）はRの受け入れを得て、PR #5をmainへsquash merge済み。**
ただし実際のGoogleログイン確認が未検証のため、003は「進行中タスク」に残している
（Rの指示。実ログイン確認は下記「次の一手」参照）。

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

## プロダクト概要

futary — ふたり専用SNS。「ふたりの毎日を、もっと特別に。」
詳細は `docs/requirements.md`。

## マイルストーン

| M | タスク | 内容 | 状態 |
|---|---|---|---|
| M1 | 001〜005 | 足回り・デザイン基盤・認証・ペア成立・認可 | 進行中（001・002 完了、003・004 マージ済み・実ログイン確認待ち） |
| M2 | 006〜009 | 投稿・画像・タイムライン・リアクション | 未着手 |
| M3 | 010〜013 | カレンダー・統計・思い出し | 未着手 |
| M4 | 014〜016 | ゲストデモ・LP・仕上げと公開 | 未着手 |

各マイルストーンの区切りで**人間が実際に触って**受け入れを判定する。

## 完了タスク

- 001-walking-skeleton（PR #1、レビュー往復2回）
- 002-design-tokens-and-ui（PR #3、レビュー往復2回）

## 進行中タスク

- 003-auth-google（PR #5、`main` へ squash merge 済み）: 実装・テスト・監査・
  レビュー（往復2回）まで完了。実際のGoogleアカウントでのログイン確認・
  D1レコード作成・Cookie属性実地確認だけが未検証（Google OAuthクライアント
  入手後に別途行う）。Rの指示により、その確認が終わるまで「完了タスク」に
  移動せず、M1の人間受け入れ判定の項目として残す
- 004-couple-and-invite（PR #9、`main` へ squash merge 済み）: 実装・テスト
  （52件緑）・security-auditor（2回）・Rレビューまで完了。オンボーディング画面の
  実機確認（実際のGoogleログイン）だけが未検証（003と同じ理由）。その確認が
  終わるまで「完了タスク」に移動せず、M1の人間受け入れ判定の項目として残す

## 環境

| 項目 | 状態 |
|---|---|
| 作業フォルダ | `C:\Users\coco7\futary` |
| リポジトリ | `sarada7739/futary`（**Private**。016 で Public に切り替える。ADR-011） |
| 既定ブランチ | `main` |
| gh CLI | 2.98.0 認証済み（スコープ: repo / workflow / gist / read:org） |
| Cloudflare | 設定済み。D1 `futary-db`（`database_id: 37d32e5d-80a9-4bc9-bae4-e7019bebd883`）、R2 `futary-images` |
| Google OAuth | **未設定**。人間に確認済み・「今は後回しでよい」。`.dev.vars` はダミー値で運用中（コミットしていない） |

## 次の一手

1. 人間が Google Cloud Console で OAuth クライアントを作成し、`.dev.vars` の
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を実際の値に差し替えたら、
   `docs/tasks/003-auth-google.md` の「保留: 実際のGoogleログイン確認」節にある
   4項目（ログイン成功・D1レコード作成・Cookie属性・ログアウト導線）と、
   004のオンボーディング画面（ペア作成→招待コード発行→別アカウントでの参加）を
   まとめて実機確認する
2. 上記が済んだら 003・004 を「完了タスク」に移動する
3. `docs/tasks/005-authorization-middleware.md` に着手（新しいセッションで、
   `/clear` してから）。005はM1の山場（認可ミドルウェアの導入）で、完了後は
   M1の区切りとして人間の受け入れ判定・Google OAuthクライアント作成・
   実ログイン確認（L14）をまとめて行う予定（Aより）

## 未解決の論点

| # | 論点 | 影響 | 判断時期 |
|---|---|---|---|
| L1 | 公開ドメインを `*.workers.dev` にするか独自ドメインを取るか | LP の OGP・第一印象。転職アピールでは独自ドメインの方が印象が良い。003で `BETTER_AUTH_URL`/`TRUSTED_ORIGINS` を本番用に設定する際にも必要 | 015 の前 |
| ~~L2~~ | ~~ロゴのスクリプト体をどう用意するか~~ → **解決**（002） | | 解決済み |
| L3 | デモペアのシードデータに使う写真の入手先（フリー素材 / 生成画像） | 実在人物の写真は使わない前提 | 014 の前 |
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
| L14 | 003で実際のGoogleログインが未検証（クライアント未入手のため人間判断で保留） | 完了条件の一部（ログイン成功、D1レコード作成、Cookie属性実地確認）が未証明 | 人間がクライアントを設定し次第、`docs/tasks/003-auth-google.md` の保留節に従って追加確認 |
| ~~L15~~ | ~~`packages/ui` の `Button` に `secondary` バリアントを追加した（002は `primary`/`ghost` の2種）。`architecture.md` 未反映~~ → **解決**（PR #12）。7節に「ボタンのバリアント」節を新設し、primary/secondary/ghost の3種と用途を明記した | | 解決済み（PR #12） |
| L16 | ログイン画面の「ログイン」と「新しくはじめる」が同じ `handleGoogleSignIn` を呼ぶ。Google OAuthに新規/既存の区別が無い以上コードとしては正しいが、UIは別動作に見える（Rレビュー003 R-21で指摘） | 見た目と実際の挙動の齟齬 | 016の仕上げで文言・導線を再検討 |
| ~~L17~~ | ~~`conventions.md` 9節の見出しが過大表現~~ → **解決**。見出しを「違反が痕跡を残すようにする」に修正し、「検出できること・できないこと」の表を追加。自己申告であり意図的な詐称は見抜けないことを明記した | | 解決済み（Rの指摘） |
| L18 | A / R / B が単一の作業ツリーを共有している。A が独立したブランチ・PRを持てず、A の編集が B のコミットに混入する。B の `git reset --hard` 等で A の未コミット変更が失われる危険もある。003 で実際に混入が発生した | 帰属不能（L17 と L19 の根本原因）と作業ツリー混入が同時に起きる | git worktree による分離を M1 の区切りで検討。`harness.md` への追記も同時に行う |
| ~~L19~~ | ~~squash merge により `Session:` トレーラーが `main` で失われる（実例 `a2f6eb2`）~~ → **解決**。`conventions.md` 7節に「マージ戦略」節を新設。squash を維持したうえで、マージ時に `--body` でトレーラーを明示的に書き込む手順と、マージ後の確認コマンドを規定。あわせて「1 PR = 1 役」と、その例外を作らずに済ませる手順（判断はメッセージで運び、ドキュメントは A 単独の PR で運ぶ）を9節に追加 | | 解決済み（Rの指摘） |
| ~~L20~~ | ~~「1 PR = 1 役」と9節の例外「A の変更を独立したコミットに分けさせる」が両立しない~~ → **解決**。例外を廃止した。B が必要とするのは判断であってドキュメントのマージではないため、判断はメッセージで即時に運び、ドキュメントは A 単独の PR で並行して進める。ただし `/clear` した新セッションはメッセージを引き継がないため、着手前に main へマージすることを明記 | | 解決済み（Rの指摘） |
| L21 | `invite.issue` にレート制限が無く、満員のペアでもコードを発行できる。`invites`行の定期削除も無く単調増加する（004監査2回目 Low指摘） | 招待コードの母集団が無駄に膨らむ。ただし「画面遷移だけで無条件に発行される」設計上のバグ（004監査2回目 Medium指摘）を修正済みで、発行が明示操作に限られたため実害は小さい | トラフィックが増えてから再検討。急ぎではない |
| L22 | 001の歩くスケルトンで作られた `packages/db/migrations/0000_init.sql` がコメントのみで実行可能な文を持たず、`wrangler d1 migrations apply` が失敗する実在のバグがあった（004で発見） | → **解決（004）**。無害な `SELECT 1;` を1文追加した。**追記（Rの指摘R-24を受けて検証）**: 001の実装メモ（`docs/tasks/001-walking-skeleton.md` R-1対応）は「ローカルD1にも `0000_init.sql` として再適用済み」と記録しており、当時は成功していたはずだが、ファイル内容自体は001から004まで一切変更されていない（`git log -p --follow` で確認）。004実装中に、隔離した検証用ディレクトリで実際に `npx wrangler@4.126.0 d1 migrations apply DB --local` と `npx wrangler@4.124.0`（両方ともこのリポジトリが依存関係として持つバージョン）を素の状態で実行し、**どちらも同じ「internal error」で失敗する**ことを確認した。したがってこの004内での「本番のwranglerでも失敗する」という判断自体は裏付けが取れている。一方、001時点で何が違って成功したのかは、より古いwranglerバージョンでのビセクトが必要で、004の範囲では特定できなかった。エラーメッセージは `X [ERROR] internal error` と非常に目立つ形で出るため、001当時に本当に踏んでいれば見逃したとは考えにくく、当時の環境（wrangler/workerdのより古いバージョン、または`.wrangler/state`のD1エミュレータ実装差）で挙動が異なっていた可能性が高いと推測する | 解決済み（004）。原因の完全特定は持ち越し（急ぎではない） |
| L23 | `invite_failures` の掃除DELETEが `created_at` 単独インデックスを持たず全表走査になる（004監査2回目 Low指摘） | D1の行読み取り課金・遅延の増幅要因 | 要件6節の想定規模（2人×1日数投稿）では時期尚早。急ぎではない |
| ~~L24~~ | ~~`security-requirements.md` 4節が実装（user_id 10回/時間 + IP 50回/時間の二本立て）と食い違っていた~~ → **解決**（PR #10）。security-requirements.md 4節に「レート制限のキー」を新設し、user_id 10回/時間 + ip_address 50回/時間とその非対称の理由を明記。004 タスクファイル2箇所も揃えた | | 解決済み（PR #10） |
| ~~L25~~ | ~~IP が取得できない場合（ローカル開発等）に user_id 単独で判定する分岐が `security-requirements.md` 4節に書かれていない~~ → **解決**（PR #12）。4節に「IPが取得できない場合はuser_id単独で判定する。ip_addressにはNULLを入れ、固定の代用文字列を入れてはならない」を追記した | | 解決済み（PR #12） |

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
