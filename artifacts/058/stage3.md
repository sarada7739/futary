# 058 追補: 予定の無い日にも「天気」の行

人間の指示（2026-09-17）: 7 日以内の日で予定を入れていないとき、「この日の予定はありません」の下に、予定があるときと同じ天気の行（地域名・天気・最高／最低）を出す。

## 変更

- `apps/app/app/(tabs)/calendar.tsx`: 天気の行の条件から `selectedDayEvents.length > 0` を外した。残る条件は「7 日以内」と「`weather.getForDate` の応答がある」だけ
  - 行の並びは 祝日の名前 → 「この日の予定はありません」（または予定の一覧）→ 天気の行。ここは変えていない
  - `getForDate` はもともと予定の有無に関係なく 7 日以内なら呼んでいた（通信は増えない）
- `apps/app/test/calendar-screen.test.tsx`（T7）
  - 「予定が無い日は出ない」の確認を「予定が無い日も『この日の予定はありません』の下に出る」に反転
  - 新規: 7 日の外の日（グリッド先頭の過去日）は予定が無くても行が出ず、`getForDate` も呼ばない

API・契約・DB・タスク定義の表は触っていない。

## テスト

- `apps/app`: vitest 51 ファイル 595 件 緑 / `tsc --noEmit` 緑 / eslint 緑（変えた 2 ファイル）

## 画面（`artifacts/058/stage3/`。390×844・両モード。`scripts/capture-stage3.mjs`。天気は本物の気象庁から）

| ファイル | 内容 |
|---|---|
| `{pink,white}-day-with-event.png` | 今日（予定あり）。比べる用。従来どおり予定の下に天気の行 |
| `{pink,white}-day-no-event.png` | 明日（予定なし）。「この日の予定はありません」の下に「東京地方: 曇・最高 25° / 最低 18°」 |

`capture.json`: `noEventText` が両モードとも `empty-then-weather`（DOM の順で「予定はありません」→ 天気の行）。`consoleErrors` は従来と同じ 404 だけ（stage1・stage2 と同じ。天気のリソースではない）。

## A へ

- `docs/tasks/058-weather-and-holidays.md` 0節 #5「7 日以内の**予定なら**「天気」の行」は「7 日以内の**日なら**（予定の有無によらず）」が今の定義。B は起票のみ
