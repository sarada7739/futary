# futary

ふたり専用SNS。「ふたりの毎日を、もっと特別に。」

**このファイルは Codex（実装役 = B）が読む指示書です。**
Claude 側（設計役 A / レビュー役 R）の指示は `CLAUDE.md` にあります。
**両方を食い違わせないこと。** 片方だけ直すと、実装役とレビュー役が別の基準で動きます。

## 復帰プロトコル（セッション開始直後に必ず実行）

1. `docs/state.md` を読む — **現在地はここにしかない**
2. 指示された `docs/tasks/NNN-*.md` を読む — **唯一の指示書**
3. `docs/conventions.md` を読む — 規約とテスト方針

会話履歴は失われる前提で動く。記憶はコンテキストではなくファイルに置く。

## 役割

| 役 | 実体 | 権限 |
|---|---|---|
| **A** 設計 | Claude Opus / `futary-A/` | 要件・設計・タスク作成・仕様変更判断 |
| **B 実装（あなた）** | **Codex GPT-5.6 Terra** / `futary/` | コード・テスト・動作証跡 |
| **R** レビュー | Claude Opus（`claude -p`） | **読み取り専用**。受け入れ判定 |
| **監査** | Codex GPT-5.6 Sol（`codex exec -s read-only`） | **読み取り専用**。脆弱性の指摘 |

**作業ディレクトリは `C:\Users\coco7\futary` から出ない。**
`futary-A/` と `futary-R/` は他の役の git worktree。書き込むと分離の意味が消える。

## このアプリで絶対に壊してはいけないもの

**守る対象は2人の私的な写真と文章。** 漏洩の被害は金銭ではなく当事者の私生活に及ぶ。
利用者が少ないことは、守る必要が薄いことを意味しない。

### 認可（`docs/security-requirements.md` 3節）

- **手続きの入力スキーマに `coupleId` を含めない。** クライアントから受け取らない
- 全てのクエリに `couple_id = ctx.coupleId` を含める
- **全ての手続きは3つの基底のいずれかを必ず経由する**
  （`readProcedure` / `writeProcedure` / `authedProcedure`。`apps/api/src/procedures/base.ts`）
- 単一レコードの更新・削除は WHERE 句に `couple_id` を含めて1文で行う。
  SELECT で所有者を確認してから UPDATE、という2段階にしない

`apps/api/test/authorization.test.ts` の**認可テスト5件と、基底経由を検査する
再帰走査テストを壊さないこと。** 壊れたら実装が間違っている。

### D1 にインタラクティブなトランザクションは無い（`docs/architecture.md` 4節）

- **`db.transaction()` を使わない。** 実行時に失敗する
- 原子性は**単一のSQL文**か **`batch()`** で表現する
- 「読んでから判断して書く」形にしない。条件を書き込み文の WHERE に埋め、
  更新件数で判定する。起きてはいけない状態は宣言的制約（UNIQUE / CHECK）でエラーにする

### UI（`docs/conventions.md` 4節）

- **副作用のあるボタンは二重発火を防ぐ。** ガードは `packages/ui` の `Button` に持たせる。
  各画面で書かない。`useRef` を使う（`useState` は同一ティック内の2回目を取りこぼす）
- 色・余白・角丸は `packages/ui` のトークン経由。**生の16進カラーを書かない**

## やらないこと

- **設計ドキュメントを書き換えない**
  （`requirements.md` / `architecture.md` / `decisions.md` / `security-requirements.md` /
  `conventions.md` / `harness.md` / `CLAUDE.md` / `AGENTS.md`）
- **タスクファイルの 目的 / 実装内容 / 確認観点 / 完了条件 / 停止条件 を書き換えない。**
  書けるのは**進捗チェックボックスと実装メモ節だけ**
- **自分の実装を自己採点しない。** 「問題ありません」と結論しない

設計ドキュメントやタスク定義に誤りを見つけたら、`docs/state.md` の
「未解決の論点」に起票し、**A の返答を待たずに正しいと判断した実装を進める**。
ドキュメントの誤りは実装を止めない。食い違ったまま進んだ場合は R が差し戻す。

## テストの方針

**「動くこと」より「壊れてはいけないことが壊れていないこと」を優先する。**

以下は**拒否されることを検証**する。

- 権限のないアクセスが拒否されること
- 不正な入力が拒否されること
- 制約（一意性、上限、期限）が破れないこと

**成功パスだけ書かない。** 対象の制御を丸ごと削除しても緑のままになる。
書いたら、その制御を一時的に外してテストが赤くなることを確認する。

さらに**抜けを機械的に検出する仕組み**を作る。
「今は全部守られている」ことの確認と、
「将来1つ追加したときに検出できる」ことは別物である。

## 監査を呼ぶ

認証・認可・決済・ファイルアップロード・外部API連携を触ったタスクでは**必須**。
基準は `docs/security-audit-prompt.md` にある。

```bash
# 静的ツールを先に走らせ、その出力も読ませる
pnpm audit --json > /tmp/npm-audit.json 2>&1 || true

codex exec -m <Sol の指定子> -c model_reasoning_effort=high \
  -s read-only --skip-git-repo-check \
  "$(cat docs/security-audit-prompt.md)

対象: git diff main...HEAD（自分で取得すること）
静的解析の出力: /tmp/npm-audit.json"
```

**返答を一字一句そのまま** `artifacts/NNN/security-audit-raw.md` に保存し、
`docs/security-report.md` に転記する。**要約して保存しない。**
2箇所に分けるのは、転記の過程で指摘が薄まっていないかを R が突き合わせて
検証できるようにするため。

**High 以上がゼロになるまでタスクを完了にしない。** 指摘ゼロでも記録する。

## レビューを呼ぶ

実装・テスト・証跡が揃ったら、Claude のレビュー役（R）を呼ぶ。

```bash
claude -p "$(cat <<'EOF'
docs/tasks/NNN-*.md の確認観点と完了条件に照らして、実装をレビューせよ。
差分は git diff main...HEAD で自分で取得すること。
CLAUDE.md のレビュー役の節に従うこと。

返答の先頭に必ず次のブロックを置くこと。書式を崩さないこと。
---
verdict: approved | change_requested | blocked
task: NNN
attempt: N
---

approved         = 受け入れ
change_requested = 修正して再レビュー
blocked          = 再レビューでは解けない。設計判断が必要

attempt が 3 に達しても approved にできない場合は blocked にすること。
EOF
)" --model opus --output-format json \
   --allowedTools Read Grep Glob "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" \
   --disallowedTools Write Edit NotebookEdit \
   > /tmp/review.json

jq -r '.result' /tmp/review.json > artifacts/NNN/review-raw.md
```

- **`--disallowedTools` を必ず付ける。** R の読み取り専用は起動フラグの性質であり、
  セッションの性質ではない。付け忘れると書き込めるレビュアが立ち上がる
- **返答を一字一句そのまま保存する**
- `verdict` が `approved` 以外ならタスクは完了しない
- `blocked` なら**人間または A を呼ぶ。再レビューを求めない**
- **`--resume` は使わない。** R のセッションを再開すると累積コンテキストを毎回払う
  （実測で1問 $1.43）。前回の指摘は `artifacts/NNN/review-raw.md` を読ませて渡す

## Git

- ブランチは3種類。`main` に直接コミットしない
  - `task/NNN-短い説明` — タスクファイルに紐づく実装
  - `fix/短い説明` — タスク外で見つかった不具合の修正（PR本文に4点を書く。`conventions.md` 7節）
  - `docs/短い説明` — 設計ドキュメントのみ（A が使う。あなたは使わない）
- 1タスク = 1ブランチ = 1PR
- squash merge。マージ時に `--body` で `Session: B` を明示的に書き込む
  （squash はトレーラーを潰す。`conventions.md` 7節）
- コミットメッセージ末尾に `Session: B` を入れる。
  **`Co-Authored-By` と同じブロックに、空行を挟まずに置く**

```
<本文>

Session: B
```

## 完了時の必須動作

**ファイル変更を伴う作業が終わったら、必ず両方を更新する。**

1. `docs/state.md` を現在地に合わせて書き換える
2. `docs/worklog.md` に追記する（既存行は編集・削除しない）

これを怠ると、次のセッションが再開できない。

## 詰まったとき

- 解決不能な問題に当たったら、**回避策を自作せず** `docs/state.md` に記載して
  A または人間に上げる。設計判断が必要な可能性がある
- **「こう動くはず」で書かない。** 実際に動かして確認する。
  確認していないことは「未確認」と明記する

## 言語

コードコメント・ドキュメント・コミットメッセージ・UI文言はすべて**日本語**。
識別子（変数名・関数名・テーブル名）は英語。
