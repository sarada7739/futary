# 063 段階2 — R の判定

futary-R で origin/task/063-stage2（98616bc）を checkout。変更 100 ファイルはすべて `apps/app/{app,components,lib}`・`packages/ui/src`・`apps/landing`・`artifacts/063`・`docs/{state,worklog}.md` の中。`worklog.md` は追記のみ（削除 0 行）。

**受け入れ。必須修正なし。**

## T2（コメント以外の変更が無い）: 段階1 と同じく R の別の方法で

- TS/TSX 93 ファイル: 構文木の葉（JSDoc を除く）の列が前後で全部一致。JSX のコメント `{/* */}` の数が変われば `{` `}` の葉が増減して拾える形で見ている（B の気づき 2 と同じ理由で、まとめていないことも確かめられた）
- LP（`index.html`・`style.css`・`tech.html` の 3 つが変更）: `build-public.mjs` の `stripHtmlComments`・`stripCssComments`（本番と同じ）で除き、空白を全部消して比べて 3 つとも一致
- 道具が読む注記の数: `viewer-key-coverage-ignore` 9 → 9・`eslint-disable` 1 → 1・`@ts-expect-error`・`@ts-ignore` 0 → 0

## 0節 #1（残すべき理由）

`apps/app`・`packages/ui/src` で、セキュリティ・プライバシーの語（couple_id・Cookie・キャッシュ・viewer・退会・localStorage・秘密 等）を含むコメントが代わりの文なしに丸ごと消えた塊は 0。

## CI（この PR の外）

`pnpm audit（無視リストの陳腐化検出）` が落ちている: `GHSA-w3rx-r6r6-pgpr`・`GHSA-5p2g-fcmc-qvqq` がもう audit 結果に現れない。**main 自身の CI（run 36046008426、19:07。#432 のマージ直後）も同じ理由で赤**。勧告データベースの側が変わったもので、#434 の差分とは関係ない。`pnpm-workspace.yaml` の無視リストを直せるのは A だけなので、R から A に伝えた。A の PR が main に入ったら #434 を rebase して CI → マージ。

## 記録（判定に使わない）

1. `viewer-key-coverage.test.ts` が免除 2 箇所を**行番号**で固定しているので、B が `timeline.tsx` の 76 行目より前の行数を保った（気づき 1）。コメントを縮めるたびに行数に縛られるのは段階3 で中身（前後の行の文字列など）での固定に替えるとよい
2. `weather-codes.ts`（生成物）に触らなかったのは正しい

## 私が確かめていないこと

- `pnpm -r test` の全件（B の 1,539 のまま・CI の test の段に頼る。CI は audit の段で止まっているので、A の修正後の CI で確かめる）
