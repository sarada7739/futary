# 010: カレンダーAPI — テスト結果

実行日: 2026-08-30 / セッションB

## `pnpm type-check`

全ワークスペースで通過（exit 0）。

```
packages/contract type-check: Done
packages/db type-check: Done
packages/ui type-check: Done
apps/app type-check: Done
apps/api type-check: Done
```

## `pnpm lint`

`eslint .` エラーなし。

## `pnpm test`

```
packages/ui test:  Test Files  2 passed (2)
packages/ui test:       Tests  7 passed (7)
apps/app test:  Test Files  6 passed (6)
apps/app test:       Tests  36 passed (36)
apps/api test:  Test Files  12 passed (12)
apps/api test:       Tests  178 passed (178)
```

（Rレビュー往復1回目対応後の最終値。当初は175件。`date.test.ts`にRレビュー
指摘の回帰テスト3件を追加した。詳細は`docs/tasks/010-calendar-api.md`実装メモ
と`artifacts/010/review.md`参照）

apps/app・packages/ui は本タスクでは無変更（既存の緑を維持）。増えたのは apps/api のみ
（009時点128件 → 178件。内訳は下記）。

## 内訳（新規/変更ファイル）

- `apps/api/src/lib/date.ts`（新規） — JST 前提の日付ユーティリティを集約
  - `todayJst` / `diffDays` / `isLeapYear` / `monthsBefore` / `yearsBefore` /
    `monthDayOf` / `yearsBetween` / `projectMonthDay`
  - 実行時刻に依存する関数は `nowMs` を引数で受け取れるようにし、他所で `new Date()` を
    直接呼ばなくても日跨ぎの境界時刻をテストで直接指定できるようにした
- `apps/api/test/date.test.ts`（新規） — 上記の単体テスト（19件）
  - JST の日跨ぎ（UTC 14:59:59.999 → JST 当日23:59:59.999 / UTC 15:00:00 → JST 翌日00:00:00）
  - うるう年判定（4年に1度／100年で除外／400年で復活の3パターン）
  - `diffDays` がうるう年の2月をまたぐと平年より1日多くなること
  - architecture.md 5節の実例（`2026-12-20〜2028-01-24` がちょうど400日・3暦年に触れる）を
    そのまま数値で検証
- `packages/db/src/schema/event.ts`（新規） — `events` テーブル。`kind` に CHECK 制約
  （`reactions.kind` の 0006 と同じ理由。未知の値で `event.list` の出力検証全体が
  壊れる、という壊れ方を作らない）
- `packages/db/migrations/0007_event.sql`（新規、`drizzle-kit generate` で生成）
- `packages/contract/src/event.ts`（新規） — `event.list`/`create`/`update`/`delete`
  - `event.update` は部分更新にせず、`create` と同じ全項目を受け取って置き換える形にした
    （architecture.md に部分更新の要求が無く、部分更新は WHERE 句や NULL 上書きの扱いで
    複雑さが増すだけのため、シンプルな全置換を選んだ）
  - 日付は形式のみ検証し、実在する日付かどうかは検証しない（`couple.ts` の
    `anniversaryDateSchema` と異なり `refine` を足さなかった）。02-29 の記念日は
    平年には実在しない日付として登録されるため、実在性チェックを入れると
    記念日そのものが登録できなくなる
- `apps/api/src/procedures/event.ts`（新規） — `readProcedure`/`writeProcedure` の上に実装
  - `event.list`: `repeat_yearly=0` は SQL の `date BETWEEN` で絞り、`repeat_yearly=1` は
    その couple の全件を取ってから `lib/date.ts` の関数で年ごとに射影する
    （登録年に関わらず表示されうるため `date` 列の範囲条件では絞れない）
  - `event.update`/`event.delete`: `WHERE id = ? AND couple_id = ?` の1文で行う
    （006の `post.delete` と同じ形。他ペアのIDと存在しないIDを区別せず `NOT_FOUND`）
- `apps/api/test/event.test.ts`（新規、28件） — CRUD の基本動作・他ペア分離に加え、
  タスクファイルの「テストで証明すること」を1項目ずつ対応させた
  - repeat_yearly の記念日が登録年と異なる年の照会で正しく返る
  - 範囲が年をまたぐとき、年末側と年始側の記念日が両方返る
  - 400日の範囲で同じ記念日が2回返る（重複を除去しない）
  - 3つの暦年に触れる窓（`2026-12-20〜2028-01-24`）で、中間の年（2027）の記念日だけが
    返り、両端の年（2026・2028）には出ないこと
  - 401日の範囲・`from > to` は `INVALID_INPUT`
  - うるう年 02-29 の記念日は平年に射影すると 02-28 に出る（消えない）
  - うるう年へ射影したときは 02-29 のまま
- `apps/api/src/router.ts`（変更） — `event: eventProcedures` を追加
- `apps/api/test/authorization.test.ts`（変更） — `security-requirements.md` 3節の
  5項目チェックリストに `event.create`/`update`/`delete`/`list` を追加
  - 2. 未認証での書き込み（`event.create`/`update`/`delete`）が `DEMO_COUPLE_ID` 設定有無に
    関わらず `FORBIDDEN`
  - 4. 未所属ユーザーが `event.list`/`create`/`update`/`delete` を呼ぶと `NEEDS_ONBOARDING`
  - 「認可の基底を経由しない手続きが無い」の実在数チェックを 12→16 に更新
    （health.get/me.get + couple 3 + invite 2 + post 4 + reaction 1 + event 4）
  - 既存の005〜009由来のテストはすべて維持され緑

## `event.list` の射影ロジック（設計メモ）

`projectEvent`（`apps/api/src/procedures/event.ts`）が `repeat_yearly` の値で分岐する。

- `repeat_yearly=0`: `toEvent` をそのまま1件返す（`date === sourceDate`）
- `repeat_yearly=1`: `yearsBetween(from, to)` で `year(from)`〜`year(to)` を必ず全て
  ループし（決め打ちの2年にしない。architecture.md 5節「射影する年を決め打ちにしない」）、
  各年に `projectMonthDay` で射影した日付が `[from, to]` に入るものだけを残す。
  同じ `MM-DD` が2回窓に入る場合は2件とも残る（重複除去はしない）

`projectMonthDay` の 02-29 特例（平年は02-28に寄せる。03-01にしない）は
`isLeapYear` の3パターン（4年に1度／100年で除外／400年で復活）を
`date.test.ts` で個別に確認したうえで、`event.test.ts` 側でも
射影結果（02-28・02-29）として2方向とも確認している。

## 認可

009までの5項目チェックリスト（`security-requirements.md` 3節）は `event` 系の
4手続きを追加した上ですべて緑。`event` 系は `readProcedure`/`writeProcedure` を
そのまま `.use()` しているだけで、認可ミドルウェア自体（`auth-context.ts`）は
変更していない。

`security-requirements.md` 10節1「認証・招待・画像アップロード・認可ミドルウェアを
触ったタスク」には該当しないため、010単体でのsecurity-auditor監査は必須ではない
（006・008と同じ扱い）。M3の他タスク（011〜013）と合わせて、マイルストーン単位の
まとめ監査で回収する（10節2）。
