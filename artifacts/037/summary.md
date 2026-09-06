# 037: AIまとめ 実装まとめ

## 実装したもの

### データモデル
- `couple_members.ai_opt_in`（個人ごとの同意。ADD COLUMN。実測してから
  書いた。実際にローカルD1へ適用し、`PRAGMA table_info`で確認済み）
- `ai_summaries`（`couple_id, period_kind, period_key`の複合主キー。
  `period_kind`は`'month' | 'week'`、`period_key`は`YYYY-MM`または
  `YYYY-Www`。名前付きCHECK2つ）

途中で`month`列だけの設計から、人間の「週間も欲しい」という要望を受けて
`period_kind`/`period_key`に作り直した（Aの判断。まだ本番に出ていない
段階だったため、新しいマイグレーションを足すのではなく既存のものを
直接書き換えた。ローカルD1もリセットして最初から通ることを確認済み）。

### `packages/date`
ISO 8601週（月曜始まり・JST）の計算を追加した（`isoWeekKey`・
`currentWeekJst`・`jstWeekRangeMs`）。年またぎ（12月末が翌年の週1になる・
1月頭が前年の週になる）をWikipediaのISO 8601記事に載っている検証済みの
実例（2005-01-01=2004-W53、2018-12-31=2019-W01）でテストを固定した。

### `apps/api/src/lib/ai.ts`
プロバイダの窓口。手続き側はopenai/anthropicのどちらを使っているか見ない。

- `resolveAiConfig`: `AI_PROVIDER`が指すプロバイダのキーが無ければ落ちる
  （fail-closed）。ただしBETTER_AUTH_SECRETと違い、この機能を実際に使う
  瞬間（`aiSummary.generate`が呼ばれたとき）にチェックする設計にした
  （r2-signed-url.tsのclientForと同じ形。無関係な全機能を止める理由が
  無いと判断した。設計判断としてコードに理由を書いた）
- `buildProviderRequest`: プロバイダごとのHTTPリクエストを組み立てる
  純粋関数（fetchはしない）。openai/anthropicで宛先URL・認証ヘッダ・
  モデル名が変わることをテストで確認した
- `buildPrompt`: 投稿ごとに「A:」「B:」という匿名の記号を付けて連結する。
  合計8000文字を超えたら古い方（配列の先頭）から落とす。1件だけで
  超える場合は新しい方から8000文字だけ残す
- `generateSummary`: 実際にプロバイダのAPIを呼ぶ唯一の窓口

**投稿者の記号（A/B）について**: 当初「本文だけを送る」実装だったが、
人間から「AIがこの発言はどのユーザーのものか認識できたほうがいい」との
指摘を受けて追加した。`couple_members.slot`（1/2）から機械的に決まる
記号で、実名・メールアドレス・IDは一切外部へ渡らない。Aが確認し、
ADR-013に追記済み。

### `apps/api/src/procedures/ai-summary.ts`
- `aiSummary.get`: 生成済みの内容を読むだけ。未来・進行中（今月・今週）の
  期間はINVALID_INPUT
- `aiSummary.generate`: 以下の順でチェックしてから生成する
  1. 未来・進行中の期間 → INVALID_INPUT
  2. 2人とも`ai_opt_in`でなければ → FORBIDDEN（1人のペアも自動的にここで弾かれる）
  3. その期間の生成回数が3回以上 → LIMIT_REACHED
  4. **今の暦月**の生成回数合計が10回以上 → LIMIT_REACHED
  5. 投稿が3件未満 → INVALID_INPUT
  6. ここで初めて`generateSummary`を呼ぶ（費用が発生する箇所）

**暦月合計の数え方について（設計判断）**: `ai_summaries`は期間ごとに1行
しか持たず、生成のたびの個別ログは無い。「今の暦月に何回使ったか」を
正確に数える表が無いため、「`updated_at`が今の暦月に入っている行の
`generated_count`の合計」で近似した。ある期間を先月と今月の両方で
生成し直した場合、その行の`generated_count`（全期間の累積）がまるごと
今月分に数えられ、実際より多く数える方向にしかずれない（少なく数えて
歯止めをすり抜けることは無い。安全側の近似）。テストで実際に「期間ごとの
枠が余っていても、暦月の合計10回で11回目が止まる」ことを確認した。

### `me.get` / `me.setAiOptIn`
- `me.get`にaiOptIn/partnerAiOptInを追加（ペア未所属なら両方false）
- `me.setAiOptIn`は自分の分だけ変更（user_idを引数に取らない。
  writeProcedureでcoupleId/userIdを解決するため、ペア未所属だと
  NEEDS_ONBOARDING）

### `me.delete`
`ai_summaries`の削除文をbatchに追加（4回目。027 wishes・029 moods・
031 post_imagesに続く）。032の「残ってよい行以外は0件」の機械的走査に
自動で映ることを確認した（走査ロジックを一切変更せず、テストデータを
追加しただけで検出された）。

### 画面
- `apps/app/app/(tabs)/ai-summary.tsx`: 月/週の切り替え・前後移動・
  同意状態に応じた表示分岐（未同意・相手未同意・未生成・生成済み・
  使い切り）・3状態（読み込み中/エラー/本体）
- `apps/app/app/(tabs)/profile.tsx`: 同意のチェックをマイページに設置
  （画面の中に埋めない。タスク定義9節）
- `apps/app/app/(tabs)/index.tsx`: 「AIまとめ」パネルにonPressを追加
  （COMING SOONが外れる）

### デモシード
`packages/db/seed/demo.ts`に、先月・先週ぶんのまとめを1件ずつ追加した
（月・週の両方に置いたのは、画面の切り替えでどちらを見ても空にならない
ようにするため。タスク定義自体は「1件」とだけ書いているが、037で月・週
両方を作ったため両方に置く方が自然と判断した）。**実際に生成した文章では
ない**ことを本ディレクトリの`manual-check.md`に明記した。

## テスト

- `packages/date`: 61件（ISO週の年またぎ・52/53週の判定を含む）
- `packages/db`: 29件（マイグレーション整合性・シードの月/週両方の存在確認）
- `packages/contract` / `packages/db`: 型チェック緑
- `apps/api`: 454件（`ai-summary.test.ts`23件・`ai.test.ts`14件・
  `me.test.ts`の追加分含む）。**本物のAPIを一切叩かず**、`vi.stubGlobal`で
  グローバルの`fetch`を差し替えて確認した（下記「事故と訂正」参照）
- `apps/app`: 241件（`ai-summary-screen.test.tsx`12件・`profile-screen`/
  `home-screen`の追加分含む）
- 型チェック・lint、全パッケージで緑

## security-auditorの監査（High以上ゼロ。Medium2件・Low5件、全て対応）

| 重大度 | 内容 | 対応 |
|---|---|---|
| Medium | 費用の歯止めがcheck-then-actで並行リクエストにすり抜けられる | 期間ごとの歯止めを1文の条件付きUPSERT（`ON CONFLICT DO UPDATE ... WHERE generated_count < 3`＋`RETURNING`）による「先に予約してから呼ぶ」形に直した。失敗時は予約を巻き戻す。実際に6件の並行`generate`を投げて成功が3件ちょうどに収まることをテストで確認した |
| Medium | OpenAI側に出力トークンの上限が無い（Anthropicにはあった） | 両プロバイダに同じ`max_tokens`を入れて揃えた |
| Low | プロバイダ応答のJSONパース失敗がクライアントの不正入力として扱われる | `generateSummary`内で`try/catch`し、自前のErrorに詰め替えた（500・エラーIDありの経路に戻す） |
| Low | `AI_PROVIDER`に関わらず両方のキーがcontextに載る | `index.ts`側で使う方のキーだけを`aiEnv`に積むようにした |
| Low | テストのfetch差し替え忘れを止める仕組みが無い | `apps/api/test/apply-migrations.ts`で既定のfetchを「呼ばれたら例外」に固定した |
| Low | `periodKey`が形式だけで実在性を見ていない（2026-13・2025-W53等） | `packages/date`に`isoWeeksInYear`を追加し、contractのrefineで月は01-12・週はその年の週数までに制限した |
| Low | `aiSummary.generate`にデモペアの明示的な拒否が無い（`me.delete`と非対称） | `couples.is_demo`を確認する自前のガードを追加した |

詳細（該当行・推奨対応の原文）は監査エージェントの報告をそのまま
`docs/worklog.md`に転記していない（長大なため）が、対応は上表のとおり
全件実施し、それぞれにテストを追加した。

## 事故と訂正（正直に記録する）

最初、`vi.mock("../src/lib/ai", ...)`で`generateSummary`を差し替えようと
したが、`apps/api`のテストは`@cloudflare/vitest-plugin`（Miniflare/workerd
上でテストコード自体を実行する）を使っており、`vi.mock`によるESM
モジュールの差し替えが効かなかった。結果として**実際に
`https://api.openai.com`へ本物のリクエストが飛んだ**（テスト用の偽キー
のため401で失敗し、生成には成功していない＝費用は発生していないはずだが、
叩いてはいけないものを実際に叩いてしまった）。

`generateSummary`はグローバルの`fetch`を直接呼ぶ実装のため、
`vi.stubGlobal("fetch", ...)`でfetch自体を差し替える形に直した。テスト
コードとprocedure実行が同じグローバルスコープ（同じworkerdアイソレート）を
共有していることを利用する。以降のテスト実行では実際のfetchが本物の
ホストへ向かっていないことを`fetchMock`のURLで確認している。

## 完了条件との対応
- [x] ホームの「AIまとめ」パネルから入れる（COMING SOONが消える）
- [x] 2人とも同意したときだけ生成できる
- [x] `AI_PROVIDER`でOpenAIとAnthropicを切り替えられる（テストで確認。
      実際のAPIキーでの疎通は未確認。manual-check.md参照）
- [x] 歯止め（回数・長さ・件数）が全部効いている
- [x] 上記のテストが緑
- [ ] `security-auditor`の監査（実施中）
- [x] `artifacts/037/`に証跡と`manual-check.md`を保存
