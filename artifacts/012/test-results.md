# 012: ペア統計カード — テスト結果

実行日: 2026-08-30 / セッションB

## `pnpm type-check`

全ワークスペースで通過（exit 0）。

## `pnpm lint`

`eslint .` エラーなし。

## `pnpm test`

```
packages/ui test:  Test Files  2 passed (2)
packages/ui test:       Tests  7 passed (7)
packages/date test:  Test Files  1 passed (1)
packages/date test:       Tests  44 passed (44)
apps/app test:  Test Files  9 passed (9)
apps/app test:       Tests  56 passed (56)
apps/api test:  Test Files  12 passed (12)
apps/api test:       Tests  176 passed (176)
```

apps/api は154件（011完了時点）→176件（+22）。内訳: `stats.test.ts`（新規13件）・
`couple.test.ts`（未来日境界3件追加）・`event.test.ts`（repeatYearly制約3件追加）・
`authorization.test.ts`（stats.get 2件追加）。apps/appは51件→56件（+5。
`stats-card.test.tsx`新規）。packages/date・packages/ui は無変更。

## 内訳（新規/変更ファイル）

- `packages/contract/src/stats.ts`（新規） — `stats.get`契約。`daysTogether`を
  判別可能なunion（`{status:"together",days}` / `{status:"upcoming",days}`）
  にした。`members`（`{userId,name,image}[]`）を追加
- `packages/contract/src/couple.ts`（変更） — `anniversaryDateSchema`の上限を
  「今日まで」から「1年後まで」に緩和（L66）
- `packages/contract/src/event.ts`（変更） — `eventInputSchema`に
  `kind==='anniversary' || !repeatYearly`の制約を追加（L67）
- `apps/api/src/procedures/stats.ts`（新規） — `stats.get`実装。
  `computeDaysTogether`をexportし、off-by-oneの境界を純粋関数として直接
  テストした
- `apps/app/components/stats-card.tsx`（新規） — 統計カードUI
- `apps/app/app/(tabs)/index.tsx`（変更） — `StatsCard`をホーム最上部に追加
- `apps/api/test/stats.test.ts`（新規、13件） — `computeDaysTogether`の
  off-by-one境界（today/yesterday/tomorrow/2日後/年またぎ）5件、
  `stats.get`の統合テスト8件（daysTogether・meetupCountの種別絞り込み・
  postCount/photoCountの削除済み除外・members 1件/2件）
- `apps/api/test/couple.test.ts`（変更、+3件） — 近い未来（30日後）・
  ちょうど1年後（境界）・1年後+1日（拒否）
- `apps/api/test/event.test.ts`（変更、+4件） — repeatYearly制約
  （create 3件・update 1件）
- `apps/api/test/authorization.test.ts`（変更、+2件） — stats.getの
  デモペア読み取り・NEEDS_ONBOARDING。基底経由チェックの実在数を16→17に更新
- `apps/app/test/stats-card.test.tsx`（新規、5件） — together/upcoming表示・
  会った日ゼロ・招待中表示・通信エラー時非表示
- `apps/app/test/home-timeline.test.tsx`（変更） — `stats.get`のモック追加
  （StatsCardがホーム画面に組み込まれたため、既存テストの回帰を防ぐ）

## 境界条件5件（タスク定義）との対応

| # | 条件 | テスト |
|---|---|---|
| 1 | 記念日が今日 | `computeDaysTogether`単体・`stats.get`統合の両方 |
| 2 | 記念日が昨日 | `computeDaysTogether`単体 |
| 3 | 記念日が未来の日付 | `computeDaysTogether`単体（明日・2日後）＋`stats.get`統合（30日後） |
| 4 | 会った日ゼロ | `stats.get`統合（`meetupCount: 0`）＋`stats-card.test.tsx` |
| 5 | ペアが1人だけ | `stats.get`統合（`members`1件）＋`stats-card.test.tsx`（招待中表示） |

## 005の認可テスト

5項目チェックリストは`stats.get`を追加した上ですべて緑。基底
（`readProcedure`）を経由しない手続きが無いことの機械的検査も実在数
16→17件に更新した上で緑。
