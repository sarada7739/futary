# 044: AIまとめに名前を出す（LLM には渡さない） — 実装の報告

2026-09-14 / セッションB。タスク定義（`docs/tasks/044-ai-summary-names.md`）の 0〜3節に従って実装した。
人間の実機（本番で 1 回作り直して名前で呼ばれる）はデプロイ後。回数の歯止めはそのまま（その期間 3 回・月 10 回）。

## 作ったもの

- `apps/api/src/lib/ai.ts`
  - `SYSTEM_PROMPT` に「まとめの中で投稿者に触れるときは、必ず `{{A}}` `{{B}}` とだけ書いてください（A、Aさん、彼、彼女などにしない）。」を足した
  - `substituteNames(body, names)` を 1 関数として置いた。`/\{\{(A|B)\}\}/g` を **1 回の走査**で、**関数の置き換え**で表示名にする。完全一致の印だけ。`{{AB}}`・`{A}`・素の A は触らない
    - 置き換えを 2 回続ける形（`replaceAll` × 2）にしなかった理由: A の表示名が `{{B}}` だと 2 回目に拾われて B の名前になる。文字列で返す形にしなかった理由: 名前の `$&` `$1` が置き換え文字列の特別な意味で解釈される。どちらもテストで固定した
  - `DEFAULT_MODELS.openai` を `gpt-5.6-luna` に。コメントは「→ luna（2026-09-14。人間の指示）」だけ足し、無料枠の文は触っていない（分からないことを書かない）
  - 関数の置き場を手続きのファイルではなく `lib/ai.ts` にした理由: `{{A}}` `{{B}}` という印の約束は `SYSTEM_PROMPT` が決めている。書く側と読む側を同じファイルに置き、テストからも直接呼べる
- `apps/api/src/procedures/ai-summary.ts`
  - `loadMembers(db, coupleId)`: `couple_members` に `user` を LEFT JOIN して `user_id`・`slot`・`ai_opt_in`・`name` を読む。**表示名は `user.name`**（019 の 1 箇所。`me.get`・`post.list` の `authorName`・`stats.get` のメンバー名と同じ出所）。`generate` は同意の判定・A/B の記号・表示名の 3 つをこの 1 回の読みで済ませる（以前の `couple_members` だけの SELECT を置き換えた）。`get` は行があるときだけ読む
  - `namesBySlot(members)`: slot 1 → A、slot 2 → B。居なければ「相手」
  - `get` と `generate` の応答の `body` を `substituteNames` に通す。**DB への UPDATE は `result.body` のまま**（印のまま保存）
  - 表示名は LLM への入力（`entries`）に入れていない。`labelByUserId` は今までどおり slot 由来の記号だけ

触っていないもの: `releases.ts`（人間の指示で載せない）・contract（`body` は string のまま）・画面側・保存済みのまとめ。

## 停止条件の確認（本物の API に 3 回）

`artifacts/044/scripts/trial-luna.mjs`（本番のコード `buildPrompt`・`buildProviderRequest` をそのまま使い、`.dev.vars` の鍵で OpenAI を 3 回呼ぶ。鍵は出力しない）。結果は `artifacts/044/trial-luna.log`。

| 回 | status | 応答の model | `{{A}}` | `{{B}}` | 素の A/B（Aさん・Aは 等） | reasoning tokens |
|---|---|---|---|---|---|---|
| 1 | 200 | gpt-5.6-luna | 1 | 2 | 0 | 72 |
| 2 | 200 | gpt-5.6-luna | 1 | 1 | 0 | 58 |
| 3 | 200 | gpt-5.6-luna | 1 | 1 | 0 | 79 |

- **luna は API で受け付けられる**（`max_completion_tokens` のまま 200）。→ terra に戻す必要なし
- **3 回とも `{{A}}` `{{B}}` に従った**（従わなかった回 0）。→ A に知らせる停止条件に当たらない
- 入力に入れた「Aランチの店」は、出力では「ランチの店」「食事」と言い換えられ、素の A は残らなかった。残った場合でも置き換えは印だけなので壊れない（テスト「{{AB}}・{A}・素の A・Aさん・Aランチは触らない」）
- reasoning tokens が 58〜79 出た（terra では 0 だった。`MAX_OUTPUT_TOKENS` 1024 のコメントの実測値）。出力約 230 文字 + reasoning 80 で 1024 には遠い。上限は変えていない

### 応答の例（1 回目。表示名は架空の「はな」「たろう」で置き換えた例）

保存される形（`ai_summaries.body`）:

> {{A}}は朝、公園でランニングをし、咲き始めた桜に春の訪れを感じました。{{B}}は仕事帰りにケーキを買い、ふたりで美味しく味わいました。週末には映画を観に行く約束をし、当日は思いのほか感動的な作品に涙するひとときに。雨の日には{{B}}が家でカレーを作り、少し辛さを感じながらも、ふたりでゆっくり過ごしました。映画の帰りにはランチの店にも立ち寄り、楽しい時間を重ねました。

`aiSummary.get` / `generate` が返す形:

> はなは朝、公園でランニングをし、咲き始めた桜に春の訪れを感じました。たろうは仕事帰りにケーキを買い、ふたりで美味しく味わいました。週末には映画を観に行く約束をし、当日は思いのほか感動的な作品に涙するひとときに。雨の日にはたろうが家でカレーを作り、少し辛さを感じながらも、ふたりでゆっくり過ごしました。映画の帰りにはランチの店にも立ち寄り、楽しい時間を重ねました。

## テスト（T1〜T5）

| # | テスト | 場所 |
|---|---|---|
| T1 | 既存「入力に投稿本文以外が入らない」に、送信本文（system 含む）に `必ず {{A}} {{B}} とだけ書いてください` があること・相手のメールも無いことを足した。`ai.test.ts` でも openai・anthropic の両方の system に指示があることを確認 | `test/ai-summary.test.ts`・`test/ai.test.ts` |
| T2 | `generate` 後に `ai_summaries.body` を直接 SELECT → `{{A}}` `{{B}}` のまま。owner の名前が入っていない | `test/ai-summary.test.ts` |
| T3 | `generate` の応答: 4 箇所の印が全部表示名に、`{{AB}}`・`{A}`・「Aさん」・「Aランチ」・「B級」は不変。`get` の応答も同じで、相手が呼んでも A/B の対応は slot で固定。表示名を `me.update` で変えると作り直さずに次の `get` から新しい名前。古い形（素の A/B）はそのまま。関数単体: 連鎖しない・`$&` `$1` を文字のまま | `test/ai-summary.test.ts`・`test/ai.test.ts` |
| T4 | 1 人のペアで `get` → `{{B}}` が「相手」（`generate` は 1 人では FORBIDDEN なので行を直接 INSERT） | `test/ai-summary.test.ts` |
| T5 | `buildProviderRequest` の `body.model` が `gpt-5.6-luna`。既存の `generate` のテストの期待値も luna に | `test/ai.test.ts`・`test/ai-summary.test.ts` |

## 検証

- `pnpm test`: api 604・app 451・ui 16・date 66・db 31、全部緑
- `pnpm type-check`: 緑
- `pnpm lint`: 緑

## B が決めたこと（A に知らせる）

- `substituteNames` の置き場は `lib/ai.ts`（上記の理由）。タスク定義 1節は手続きのファイルに書いてあった。手続き側は呼ぶだけ
- `user` の行が無い（起こらない想定）ときの A の名前も「相手」に寄せた（`namesBySlot`）。空にはしない
- 1 人のペアの `get` で相手の名前を引くために、`get` でもメンバーを読む（行があるときだけ。1 クエリ増）
