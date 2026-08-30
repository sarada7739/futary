# 022: 時刻の選択と、日付の8桁入力 — テスト結果

実行日: 2026-08-31 / セッションB

## `pnpm --filter @futary/api run test`

apps/api 277件→288件（+11）すべて緑。詳細は`test-results-api.txt`

内訳:
- `event.test.ts`（`time`を`startTime`/`endTime`へ改名。022）:
  - anniversaryに`startTime`/`endTime`を付けるとINVALID_INPUT（create/update）
  - `startTime`が無いのに`endTime`だけ指定するとINVALID_INPUT
  - `endTime`が`startTime`と同じ・前だとINVALID_INPUT（`it.each`）
  - `endTime`が`startTime`より後なら作れる
  - DB: `events_start_time_check`・`events_end_time_requires_start_check`・
    `events_end_time_after_start_check`の3本を、直接INSERTでCHECK制約違反を
    確かめる形で追加（シードのような入力スキーマを通らない書き込み口への備え。
    021のis_shared検証と同じ理由）
  - 会った日の上書き（`ON CONFLICT DO UPDATE`）で`end_time`も新しい値に
    上書きされる（前の終了時刻が残らない）ことを確認（Rレビュー指摘）
- `schema-integrity.test.ts`: `type='table'`の走査を追加し、`events`の
  名前付きCHECK制約5本（`events_kind_check`・`events_is_shared_check`・
  `events_start_time_check`・`events_end_time_requires_start_check`・
  `events_end_time_after_start_check`）が全部そろっていることを確認する
  テストを追加（`CREATE TABLE`全文は比較しない。Aの指摘: 列を1つ足すだけで
  落ちて原因が分からなくなる）
- `migration-existing-rows.test.ts`（新規）: `conventions.md` 6節「既存行の
  扱いが変わるマイグレーションは、行を入れた状態で当てる」がこのタスクで
  初めて実際に効く（Rの提案）。`d1_migrations`テーブルから0011の適用記録を
  外し、`events`を0010時点の構造（`time`列を持つ）へ一時的に戻して既存行を
  INSERTしたうえで、書き写しではなく実物の`0011_event_start_end_time.sql`を
  再適用し、`time`の値が`start_time`へそのまま移ることを確認した

## `pnpm --filter @futary/app run test`

apps/app 107件→125件（+18）すべて緑。詳細は`test-results-app.txt`

内訳:
- `calendar-screen.test.tsx`:
  - 開始時刻だけ・開始と終了の両方（「12:00〜13:00」表示）の2パターン
  - 記念日を選ぶと時間欄（「開始時刻を追加」ボタン）が隠れる
  - 022: 刻みに乗らない時刻（`12:07`）の予定をタイトルだけ変えて保存すると、
    `startTime`が`12:07`のまま送られる（丸められない。Aの決定）
- `time-wheel.test.ts`（新規）: `buildMinuteOptions`が刻みに乗る/乗らない
  値をそれぞれ正しく扱う。`splitTime`/`joinTime`の往復
- `date-input8.test.ts`（新規）: `toDigits`（区切りを打たせない）・
  `digitsToDisplay`（8桁未満はハイフンを入れない）・`digitsToDate`
  （8桁未満・存在しない日付〈2/30、平年の2/29〉を拒み、うるう年の2/29は通す）

## `pnpm --filter @futary/contract` / `@futary/api` / `@futary/app` / `@futary/db` / `@futary/ui` / `@futary/date` `run type-check`

すべて通過。

## `pnpm lint`

エラーなし。

## マイグレーション0011（`packages/db/migrations/0011_event_start_end_time.sql`）

`drizzle-kit generate`はrename検出が対話プロンプトを要求し、この環境（非TTY）
では実行できなかった（0010の`is_shared`追加とは異なり、`time`→`start_time`は
改名を含むため）。そのため、`meta/0010_snapshot.json`を手動で複製・更新して
`meta/0011_snapshot.json`・`meta/_journal.json`・マイグレーションSQLを直接
作成し、`pnpm generate`を再実行して「No schema changes, nothing to migrate」
（＝手動生成した内容とスキーマ定義が完全に一致する）ことで整合性を検証した。

`INSERT INTO __new_events ... SELECT`で`time`列の値を`start_time`列の位置へ
そのまま渡していることを目視確認済み（Rレビュー指摘。0010で実データ移行に
失敗した箇所と同じ）。`end_time`は新設列のためSELECT側に直接`NULL`を書いた
（0010が`is_shared`の既定値`0`を直接書いたのと同じ理由）。

ローカルD1・リモートD1への実適用は次のRレビュー・マージ後に行う
（018以降の方針を維持）。
