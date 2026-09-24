# 063 追補: テストの題名から経緯を消す

`docs/tasks/063-prune-comments-and-tests.md` 0節 #4（題名も対象）。`describe`・`it` の文字列から経緯・誰が言ったか（「R の必須修正1」「security-auditor 指摘」「M2まとめ監査」「旧版の穴」「PR #177回帰」「R-1/R-3:」「段階3」等）を消し、何を確かめるかだけにした。中身は変えていない。

## 変えたもの

13 ファイル・25 行。差分の行は全部 `it(`・`describe(` の行（`git diff -U0` で `it`・`describe` で始まらない変更行が 0）。

| ファイル | 行数 |
|---|---|
| `apps/api/test/link-preview.test.ts` | 3 |
| `apps/api/test/post.test.ts` | 3 |
| `apps/api/test/reaction.test.ts` | 2 |
| `apps/api/test/authorization.test.ts` | 1 |
| `apps/app/test/viewer-key-coverage.test.ts` | 3 |
| `apps/app/test/wheel-column.test.tsx` | 3 |
| `apps/app/test/white-stage2.test.tsx` | 2 |
| `apps/app/test/ui-token-import.test.ts` | 2 |
| `apps/app/test/glass-tab-bar.test.tsx` | 2 |
| `apps/app/test/album-detail-screen.test.tsx`・`album-zip.test.ts`・`appearance.test.tsx`・`root-navigator-guest-resolves.test.tsx` | 各 1 |

## 残したもの

- タスク番号・決定番号の参照（`（047 T8）`・`（L67）`・`（L59: 画面の最大幅制約）`・`（038）`）: 0節 #3 の「1 つまで」の範囲
- 仕様の言葉としての「旧」: `canonical-host`・`cors` の「旧ホスト」「旧オリジン」（今もリダイレクトする相手）、`release-seen` の「旧い版」（端末に残った版）
- 仕様の数字の根拠: link-preview の「5 秒では楽天が常に画像無しになる」、share-photos の「段階0で安定すれば 50」

## テストの本数と結果

`pnpm -r test`: ui 23・date 68・db 32・app 630・api 780 = **1,533**（前後で同じ・全部緑）。type-check・lint 緑。
