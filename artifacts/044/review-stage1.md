# 044（PR #321）— R の判定

futary-R で b282f30 を checkout して実行した。`ai.test.ts`・`ai-summary.test.ts` 57 件・型チェック・lint 緑。b282f30 は `MAX_OUTPUT_TOKENS` のコメント 3 行だけで動きは変わらない。触ったものは戻した。

## T1〜T5 と、壊して確かめたこと

`ai.ts`・`ai-summary.ts` を 5 通り壊し、全部で対応するテストが赤になった:
| 壊し方 | 赤 |
|---|---|
| `substituteNames` を `replaceAll` × 2 の連鎖に | 「A の名前が {{B}} でも連鎖しない」「$& が文字のまま」の 2 本（B が見てほしいと言った点。テストが縛っている） |
| 印を素の `A`/`B` に緩める | 4 本（Aランチ・古い形・連鎖ほか） |
| `generate` が置き換えた本文を保存 | T2 |
| `get` で置き換えない | T3 の 2 本 + T4 |
| LLM に渡す本文に表示名を混ぜる | T1「入力に投稿本文以外が入らない」 |

## 読んで確かめたこと

- LLM に渡るのは system + 本文 + `A:`/`B:` の記号だけ。`names` は `substituteNames` にしか流れない（`generate` の `entries` は `label`・`body` のみ）
- `substituteNames` は `/\{\{(A|B)\}\}/g` の 1 回の走査・関数置換。`{{AB}}`・`{A}`・素の A は触らない。置き場が `lib/ai.ts` なのは妥当（純粋関数。手続きは呼ぶだけ）
- 表示名は `user.name`（NOT NULL）を `couple_members.slot` で引く。`post.list` の `authorName` と同じ出所。`user` 行が無い・slot 2 が無いときは「相手」（0節 #5。B の「A も相手に寄せる」は起こらない想定の保険で、空にしない方針と整合）
- `DEFAULT_MODELS.openai` = `gpt-5.6-luna`。`max_completion_tokens` はそのまま。停止条件（従わない／受け付けない）は本物の API に 3 回投げて越えている（`trial-luna.log`・`trial-luna-usage.log`。**鍵・Authorization を含まないことを grep で確認**。スクリプトは `.dev.vars` から読み、出力に出さない）
- `releases.ts` は触っていない（0節 #8）。契約の形は変わらない。保存済みのまとめは触らない

## 記録（判定に使わない）

- `get` でメンバーを 1 回読む（1 クエリ増）。行があるときだけ。実害無し
- luna の reasoning tokens（58〜86）は `max_completion_tokens` 1024 に食い込むが、B の実測（204 文字で 255）から 300 字でも収まる。上限は変えない判断で妥当

## 私が確かめていないこと

- 本番で 1 回作り直したときの見え方（人間の手番。回数の歯止めに注意）

---

9b1d097 で確定（R。b282f30 との差分は `lib/ai.ts` のコメント 3 行の差し替えだけ）
