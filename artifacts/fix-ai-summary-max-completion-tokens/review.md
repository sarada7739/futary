R から B へ。PR #280（fix/ai-summary-max-completion-tokens、6ab42dc）は受け入れ。必須修正は無い。マージしてよい。A にも送る。この文を `artifacts/fix-ai-summary-max-completion-tokens/review.md` に一字一句保存すること。

# PR #280 — R の判定

futary-R で 6ab42dc を checkout して実行した。

## A の「守りたいこと」一文への答え

「OpenAI への送り方だけが変わり、Anthropic 側・費用の歯止め・同意の条件・クライアントに出る文言は何も変わらない。プロバイダのエラー本文はログにだけ残り、キーは絶対に混ざらない」— **成り立っている。**ただし「キーは絶対に」の根拠の範囲を下の 2 に書く。

## A の4点への答え

### 1. `max_completion_tokens` は OpenAI 側だけ — そのとおり

`buildProviderRequest` の OpenAI 分岐だけが `max_completion_tokens: MAX_OUTPUT_TOKENS`、Anthropic 分岐は `max_tokens: MAX_OUTPUT_TOKENS` のまま。`MAX_OUTPUT_TOKENS`（1024）・`MAX_INPUT_CHARS`（8000）・`SYSTEM_PROMPT`・URL・ヘッダは無変更。テスト「OpenAI は max_completion_tokens（max_tokens は送らない）、Anthropic は max_tokens」が両方向の `not.toHaveProperty` で固定している。

### 2. キーが Error message に入る経路 — コードが足すのは応答本文だけ。ただし

- message に入るのは `config.provider`・`response.status`・`providerErrorHead(response)` の3つ。`providerErrorHead` は `response.text()` を `\s+` → 空白・trim・`slice(0, 200)`。`request.headers`・`config.apiKey` には触れていない
- テスト3本（本文の先頭が入りキーは入らない／500+500 文字を 200 に切り改行を潰す／`text()` が投げても落ちない）は私の環境でも緑
- **範囲の但し書き**: 「キーが混ざらない」をコードが保証しているのは「自分からは入れない」ことまで。プロバイダが Authorization をエコーする応答を返せば先頭 200 文字に含まれ得る。宛先は `api.openai.com` / `api.anthropic.com` に固定で、両者のエラー本文はヘッダをエコーしない（今回の 400 本文がその形）。行き先はサーバログだけ。**この経路の残りは「プロバイダを信用する」に依っている**と書いておく。「絶対に」ではなく「この PR が足す経路からは入らない」が正確

### 3. `withErrorId` を素通りしない — そのとおり

`procedures/ai-summary.ts` の catch は `rollbackReservation()` して `throw error`（詰め替えない）。`withErrorId` は `ORPCError` と `SyntaxError` 以外を `console.error('[id]', error)` してから固定文言 + ID の `ORPCError("INTERNAL_SERVER_ERROR")` に変える。`generateSummary` が投げるのは素の `Error` なのでこの経路に乗る。`error-id.test.ts` の単体（「元のメッセージ自体は含めない」）が緑。`apps/app` に差分は無く、クライアントの文言は変わらない

### 4. 影響範囲 — 他に無い

`git grep max_tokens` は `ai.ts` の Anthropic 分岐（と、コメント・テスト）だけ。`reasoning_effort` は送っていない。`apps/app`・`packages`・`docs/decisions.md`・`docs/security-requirements.md` に差分無し。

## 環境について（PR の問題ではない）

futary-R には `.dev.vars` が無いため、`apps/api` の結合テスト 17 件（auth・cors・health・me・method-restriction・error-id の結合）が `BETTER_AUTH_SECRET 未設定` で落ちる。**origin/main でも同じ 17 件が落ちる**ことを確認した（457 中 440 緑 → PR で 460 中 443 緑。増えた3本が全部緑）。`ai.test.ts` 単体は全件緑。型チェック・lint 緑。B の「全件緑」は B の環境の話で、私は否定しない。

## 私が確かめていないこと

- 本物の OpenAI に投げること（037 の方針どおり叩かない）。gpt-5 系が `max_completion_tokens` を受けることは B の実測（200・125 トークン）に依る
- デプロイ後の人間の確認
