# 018: カレンダーの改善（設定者・時間・会った日の一意化） — テスト結果

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
apps/app test:       Tests  69 passed (69)
apps/api test:  Test Files  13 passed (13)
apps/api test:       Tests  204 passed (204)
```

apps/apiは193件（013完了時点）→204件（+11。`event.test.ts`）。
apps/appは61件→69件（+8。`calendar-screen.test.tsx`）。

## 内訳（新規/変更ファイル）

- `packages/db/src/schema/event.ts`（変更） — `time`列（TEXT・NULL許容）、
  `events_meetup_unique`（`(couple_id, date) WHERE kind='meetup'`の部分UNIQUE
  インデックス）を追加
- `packages/db/migrations/0008_event_time_and_meetup_unique.sql`（新規） —
  `drizzle-kit generate`で生成した`ALTER TABLE`・`CREATE UNIQUE INDEX`の前に、
  既存の重複meetup（同じcouple_id・date）を解消するDELETE文を手で追加した
  （残すのは`created_at`最大、同値なら`id`が大きい方）。ローカルD1に適用して
  動作確認済み（`wrangler d1 migrations apply DB --local`）。**リモートD1への
  適用はこのタスクのレビュー・マージ後に行う**（0007の教訓。docs/worklog.md参照）
- `packages/contract/src/event.ts`（変更） — `eventSchema`に`time`
  （HH:MM形式・null許容）・`createdByName`（null許容）を追加。入力スキーマに
  `refineTimeKind`（`kind==='anniversary'`のときは`time`を設定できない。
  `refineRepeatYearlyKind`と同じ形）を追加
- `apps/api/src/procedures/event.ts`（変更） —
  - `event.list`: `user`を`LEFT JOIN`して`createdByName`を返す
    （`post.list`の`authorName`と同じ形）
  - `event.create`: `INSERT ... ON CONFLICT (couple_id, date) WHERE kind='meetup'
    DO UPDATE`で1文のまま上書きする（「SELECTしてからUPDATE」の2段階にしない。
    security-requirements.md 3節）。設定者の名前は`context.user!.name`を直接使う
    （post.createと同じ判断）
  - `event.update`: `events_meetup_unique`違反を`isConstraintViolation`で
    捕捉し`INVALID_INPUT`を返す（上書きしない）。設定者の名前は変わらない
    可能性があるため、`created_by`から改めて1件引く
- `apps/app/components/event-form.tsx`（変更） — 時間の入力欄を追加
  （記念日のときは項目ごと隠す）。同じ日に自分以外の「会った日」が
  既にあるとき、上書き（create）または保存不可（edit）の注記を出す
- `apps/app/app/(tabs)/calendar.tsx`（変更） — 予定の行に時間（あれば）と
  設定者名を追加（どちらも既存の2行に収め、行の高さを変えない）。
  `event.update`の`INVALID_INPUT`（会った日の重複）だけ専用のエラー文言にする

## D1でのON CONFLICT構文の事前検証

設計（`docs/tasks/018-calendar-improvements.md`）で「部分UNIQUEインデックスを
衝突対象にする`ON CONFLICT ... WHERE ... DO UPDATE`がD1で通るか未確認」と
指摘されていたため、実装前にローカルD1の使い捨てテーブルで検証した。
想定どおり後勝ちで上書きされることを確認済み（`docs/worklog.md`参照）。

## 重複解消DELETE文の検証

実際のマイグレーション（既に部分UNIQUEインデックスが有効な状態でテストが
走るこの環境では再現できない）とは別に、同一のDELETE文を使い捨てのテーブルに
対して実行するテスト（`event.test.ts`の「重複したmeetupの解消ロジック」）で、
「最新の1件（created_atが最大、同値ならidが大きい方）が残る」ことを検証した。
実際のマイグレーションはローカルD1に適用し手動確認済み（`docs/worklog.md`参照）。
