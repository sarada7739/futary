# 013: 思い出し — テスト結果

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
packages/date test:       Tests  46 passed (46)
apps/app test:  Test Files  10 passed (10)
apps/app test:       Tests  61 passed (61)
apps/api test:  Test Files  13 passed (13)
apps/api test:       Tests  193 passed (193)
```

apps/api は176件（012完了時点）→193件（+17。`memory.test.ts`15件・
`authorization.test.ts` 2件）。apps/appは56件→61件（+5。`memory-card.test.tsx`）。
packages/dateは44件→46件（+2。`jstDayRangeMs`）。

## 内訳（新規/変更ファイル）

- `packages/date/src/index.ts`（変更） — `jstDayRangeMs(date)`を新設。
  指定したJSTの暦日が覆うUnixミリ秒の範囲を返す
- `packages/contract/src/memory.ts`（新規） — `memory.get`契約。ラベルは
  機械可読なenum（`oneMonthAgo`/`halfYearAgo`/`oneYearAgo`/`random`）で返し、
  日本語文言への変換はクライアント側で行う
- `apps/api/src/procedures/memory.ts`（新規） — `memory.get`実装。
  4段の探索すべてに`AND deleted_at IS NULL`を含めた（L69）。ランダム選択は
  `(coupleId, JST日付)`を種にした決定的なハッシュ（`stableHash`）+
  `ORDER BY created_at, id`で完全に決定的にした
- `apps/app/components/memory-card.tsx`（新規） — 思い出しカードUI
- `apps/app/app/(tabs)/index.tsx`（変更） — `MemoryCard`をホームに追加
- `apps/api/test/memory.test.ts`（新規、15件） — 探索順4段・7日境界の両側・
  削除済み投稿の除外・決定的な選択（同日2回呼んで一致）・署名付きURL発行・
  他ペア分離。`stableHash`単体3件を含む
- `apps/api/test/authorization.test.ts`（変更、+2件） — memory.getの
  デモペア読み取り・NEEDS_ONBOARDING。基底経由チェックの実在数を17→18に更新
- `apps/app/test/memory-card.test.tsx`（新規、5件） — ラベル表示・画像タップで
  全画面表示・null時非表示・通信エラー時非表示
- `apps/app/test/home-timeline.test.tsx`（変更） — `memory.get`のモック追加
  （MemoryCardがホーム画面に組み込まれたため、既存テストの回帰を防ぐ）

## タスク定義の境界条件6件との対応

| # | 条件 | テスト |
|---|---|---|
| 1 | 1ヶ月前に投稿がある | `memory.test.ts`「1ヶ月前に投稿があれば...」 |
| 2 | 1ヶ月前・半年前が無く1年前にある | `memory.test.ts`「1ヶ月前・半年前が無く1年前にあれば...」 |
| 3 | どの節目にも無いが古い投稿はある | `memory.test.ts`「どの節目にも無いが7日以上前の投稿があれば...」 |
| 4 | 投稿が7日分しかない | `memory.test.ts`「投稿が7日分（6日前まで）しかなければnull」＋境界の両側テスト |
| 5 | 投稿ゼロ | `memory.test.ts`「投稿ゼロならnull」 |
| 6 | 1ヶ月前が月末 | `packages/date`の`monthsBefore`テストで規則自体を網羅済み。`memory.ts`は再実装せず直接importしているため、通常の「1ヶ月前に投稿がある」テストが実行時点の実際の暦でこの規則をそのまま通す |

## 005の認可テスト

5項目チェックリストは`memory.get`を追加した上ですべて緑。基底
（`readProcedure`）を経由しない手続きが無いことの機械的検査も実在数
17→18件に更新した上で緑。
