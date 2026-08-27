# 現在地

> セッション開始直後・コンテキスト圧縮直後は、まずこのファイルを読む。
> ファイル変更を伴う作業の完了時は、必ずこのファイルを更新する。

**最終更新**: 2026-08-27 / セッションB

---

## 現在のフェーズ

**001・002完了。003（認証基盤）は実装・テスト・監査まで完了し、Rのレビュー待ち。**
ただし実際のGoogleログイン確認は保留中（下記参照）。

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

003は `task/003-auth-google` ブランチで実装。Better Auth + Google OAuth + D1 + Expo SecureStore。
`packages/db/src/schema/auth.ts`（user/session/account/verification）、
`apps/api/src/auth.ts`（Better Auth初期化）、`me.get`、ログイン画面
（`apps/app/app/(auth)/sign-in.tsx`）、`Stack.Protected` によるルーティングガード、
ログアウトを実装。security-auditor で High 2件検出→修正済み、Medium一部対応。
詳細は `docs/security-report.md` と `artifacts/003/`。
**実際のGoogleアカウントでのログイン確認・Cookie属性の実地確認は未実施**
（人間の判断で「Google OAuthクライアント作成は今は後回し」となったため。
下記「次の一手」参照）。

## プロダクト概要

futary — ふたり専用SNS。「ふたりの毎日を、もっと特別に。」
詳細は `docs/requirements.md`。

## マイルストーン

| M | タスク | 内容 | 状態 |
|---|---|---|---|
| M1 | 001〜005 | 足回り・デザイン基盤・認証・ペア成立・認可 | 進行中（001・002 完了、003 レビュー待ち） |
| M2 | 006〜009 | 投稿・画像・タイムライン・リアクション | 未着手 |
| M3 | 010〜013 | カレンダー・統計・思い出し | 未着手 |
| M4 | 014〜016 | ゲストデモ・LP・仕上げと公開 | 未着手 |

各マイルストーンの区切りで**人間が実際に触って**受け入れを判定する。

## 完了タスク

- 001-walking-skeleton（PR #1、レビュー往復2回）
- 002-design-tokens-and-ui（PR #3、レビュー往復2回）

## 進行中タスク

- 003-auth-google（`task/003-auth-google` ブランチ、PR #5）: 実装・テスト・監査完了。
  Rレビュー1回目で条件付き受け入れ（必須2件: R-17 ドキュメントと実装の不一致、
  R-18 High修正のテスト不足）→ 対応し再レビュー待ち。実ログイン確認は
  Google OAuth クライアント入手後に別途行う（Rの指示により、その確認が終わるまで
  「完了タスク」には移動しない）

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

1. R が `task/003-auth-google` をレビューする（コード・テスト・監査結果が対象。
   実ログイン確認は対象外であることをRにも伝える）
2. 人間が Google Cloud Console で OAuth クライアントを作成し、`.dev.vars` の
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を実際の値に差し替えたら、
   `docs/tasks/003-auth-google.md` の「保留: 実際のGoogleログイン確認」節にある
   4項目（ログイン成功・D1レコード作成・Cookie属性・ログアウト導線）を追加確認する
3. 003完了後、`docs/tasks/004-*` の有無を確認して次のタスクに着手

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
| L8 | `packages/ui` の `shadow.fab` が `architecture.md` 7節に無い新規トークン | ドキュメントとのズレ | A が更新するタイミングで |
| L9 | ネイティブの Google ログイン未対応。`futary://` を `TRUSTED_ORIGINS` に含めていないため経路自体が無効（fail-closed）。`@better-auth/expo` はセッショントークンをURLクエリに載せる実装で、Androidはカスタムスキームの衝突リスクがある（003監査 Medium指摘） | ネイティブ対応（実機ログイン）を始める前に、検証済みディープリンク（Universal Links/App Links）への切替か、リスク受容のADR化が必要 | ネイティブ対応タスクの前 |
| L10 | Better Auth の `rateLimit` が `enabled: true` のみでstorageが既定のmemoryのまま。Workersのmemoryストレージはアイソレートごとで実効性が薄い（003監査 Medium指摘） | 招待コードのIP単位レート制限（要件4節）の土台がまだ無い | 招待機能タスク（004以降）で `storage: "database"` + `rateLimit` テーブルとあわせて対応 |
| L11 | CI に `pnpm audit` / gitleaks / Dependabot が無い（003監査 Low指摘） | T6/T7 の対策が手動実行に依存 | 次のタスクで着手可能。急ぎではない |
| L12 | `apps/api/src/index.ts` に `app.onError` が無く、サーバ内部エラーに一意なIDが振られていない（003監査 Low指摘）。クライアントへの漏洩は無いことは確認済み | 障害追跡ができない | posts等、複雑な処理が増えるタスクで対応 |
| L13 | セキュリティヘッダ（CSP等）が未設定（003監査 Low指摘） | 要件7節未達 | Web配信・LP実装タスクで対応 |
| L14 | 003で実際のGoogleログインが未検証（クライアント未入手のため人間判断で保留） | 完了条件の一部（ログイン成功、D1レコード作成、Cookie属性実地確認）が未証明 | 人間がクライアントを設定し次第、`docs/tasks/003-auth-google.md` の保留節に従って追加確認 |
| L15 | `packages/ui` の `Button` に `secondary` バリアントを追加した（002は `primary`/`ghost` の2種）。`architecture.md` 未反映（Rレビュー003 R-20で指摘。L8と同じ扱い） | ドキュメントとのズレ | A が更新するタイミングで |
| L16 | ログイン画面の「ログイン」と「新しくはじめる」が同じ `handleGoogleSignIn` を呼ぶ。Google OAuthに新規/既存の区別が無い以上コードとしては正しいが、UIは別動作に見える（Rレビュー003 R-21で指摘） | 見た目と実際の挙動の齟齬 | 016の仕上げで文言・導線を再検討 |
| L17 | `conventions.md` 9節の見出しが「所有権ルールを**検証可能にする**」となっているが、`Session:` 行は自己申告であり、検出できるのは事故と失念のみ。意図的な詐称は見抜けない。**ドキュメントが実在しない強度の統制を主張している**（`architecture.md` の `http` 検証と同じ失敗。Rが指摘） | 読んだ人が統制を過大評価する | 「違反が痕跡を残すようにする」に修正。M1 の区切りで A が対応 |
| L18 | A / R / B が単一の作業ツリーを共有している。A が独立したブランチ・PRを持てず、A の編集が B のコミットに混入する。B の `git reset --hard` 等で A の未コミット変更が失われる危険もある。003 で実際に混入が発生した | 帰属不能（L17の根本原因）と作業ツリー混入が同時に起きる | git worktree による分離を M1 の区切りで検討。`harness.md` への追記も同時に行う |

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
