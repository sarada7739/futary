# 現在地

> セッション開始直後・コンテキスト圧縮直後は、まずこのファイルを読む。
> ファイル変更を伴う作業の完了時は、必ずこのファイルを更新する。

**最終更新**: 2026-08-27 / セッションB

---

## 現在のフェーズ

**001（歩くスケルトン）完了。002（デザイントークンと共通UI）は実装完了、Rレビュー待ち。**

pnpm workspace / `packages/contract`（health.get）/ `apps/api`（Hono + oRPC + D1疎通）
/ `apps/app`（Expo Router + TanStack Query）/ CI を一通り繋いだ。
PR #1（ブランチ `task/001-walking-skeleton`）はレビュー往復2回でRの受け入れを得て、
squash mergeで `main` に取り込み済み（ブランチも削除済み）。
証跡は `artifacts/001/` を参照。

002は `packages/ui`（トークン + Text/Button/Card/Avatar/Screen）と
`apps/app/app/(tabs)/`（ボトムタブ5つ + FAB）を実装し、PR #3
（ブランチ `task/002-design-tokens-and-ui`）を作成済み。まだマージしていない。
証跡は `artifacts/002/` を参照。

## プロダクト概要

futary — ふたり専用SNS。「ふたりの毎日を、もっと特別に。」
詳細は `docs/requirements.md`。

## マイルストーン

| M | タスク | 内容 | 状態 |
|---|---|---|---|
| M1 | 001〜005 | 足回り・デザイン基盤・認証・ペア成立・認可 | 進行中（001 完了） |
| M2 | 006〜009 | 投稿・画像・タイムライン・リアクション | 未着手 |
| M3 | 010〜013 | カレンダー・統計・思い出し | 未着手 |
| M4 | 014〜016 | ゲストデモ・LP・仕上げと公開 | 未着手 |

各マイルストーンの区切りで**人間が実際に触って**受け入れを判定する。

## 完了タスク

- 001-walking-skeleton（PR #1、レビュー往復2回）

## 進行中タスク

- 002-design-tokens-and-ui（PR #3、Rレビュー待ち）

## 環境

| 項目 | 状態 |
|---|---|
| 作業フォルダ | `C:\Users\coco7\futary` |
| リポジトリ | `sarada7739/futary`（**Private**。016 で Public に切り替える。ADR-011） |
| 既定ブランチ | `main` |
| gh CLI | 2.98.0 認証済み（スコープ: repo / workflow / gist / read:org） |
| Cloudflare | 設定済み。D1 `futary-db`（`database_id: 37d32e5d-80a9-4bc9-bae4-e7019bebd883`）、R2 `futary-images` |
| Google OAuth | **未設定**（003 の前までに必要） |

## 次の一手

1. Google Cloud Console で OAuth クライアントを作成（人間の作業。003 の前までに）
2. セッションR が PR #3（`docs/tasks/002-design-tokens-and-ui.md`）をレビューする
3. 受け入れ後、人間が確認のうえ `main` へマージし、`docs/tasks/003-*` へ進む

## 未解決の論点

| # | 論点 | 影響 | 判断時期 |
|---|---|---|---|
| L1 | 公開ドメインを `*.workers.dev` にするか独自ドメインを取るか | LP の OGP・第一印象。転職アピールでは独自ドメインの方が印象が良い | 015 の前 |
| ~~L2~~ | ~~ロゴのスクリプト体をどう用意するか~~ → **解決**: `docs/sample/sample.png` からロゴ部分を彩度ベースで透過処理して `apps/app/assets/logo.png` として採用（002で対応、Rレビュー往復1回目で矩形版から透過版に修正済み） | 015 のLPアセットでも同じ画像を流用予定 | 解決済み（002） |
| L3 | デモペアのシードデータに使う写真の入手先（フリー素材 / 生成画像） | 実在人物の写真は使わない前提 | 014 の前 |
| L4 | リアクションの種類を1種（ハート）にするか複数にするか | 009 の実装量。デザイン上はハート・コメント・共有・保存が並ぶ | 009 の中で B が1種で実装し、R が判断 |
| L5 | `apps/api/wrangler.toml` に D1 の `database_id` が平文でコミットされている | Private の間は問題ないが、016 で Public に切り替える際は要確認（削除するか、そのままにするかの判断が必要） | 016 の前（Rの001レビューで指摘） |
| L6 | `apps/api/src/index.ts` の CORS が開発用の localhost 固定のまま。003 で `credentials: true` を足す時に見直しが必要 | 003で対応しないと認証情報付きリクエストの許可オリジンが緩いまま残る | 003 の中（Rの001レビューで指摘。003タスクファイルに注記済み） |
| L7 | `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` に `miniflare@...-alpha` が入っている | 安定版が出たら除外リストから外す | 随時（急ぎではない） |
| L8 | `packages/ui` の `shadow.fab`（FABの影）が `docs/architecture.md` 7節に無い新規トークン。002でBが追加したがドキュメントは未反映 | `architecture.md` のトークン一覧と実装がズレる。次にトークンを見直すタイミングで反映が必要 | A が `architecture.md` を更新するタイミングで（Rの002レビューR-13で指摘） |

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
