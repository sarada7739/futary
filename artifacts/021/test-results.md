# 021: 予定の持ち主とふたりの予定 — テスト結果

実行日: 2026-08-31 / セッションB

## `pnpm --filter @futary/api run test`

apps/api 248件→277件（+29）すべて緑。詳細は`test-results-api.txt`

内訳:
- `authorization.test.ts`: security-requirements.md 3節の項目6（`DEMO_COUPLE_ID`が
  実在するがis_demoでないペアを指すとき拒否。021以前から未実装だった）を2件、
  項目7（ペアのもう1人が、共有でないplanを更新・削除できない）を4件、項目8
  （更新の結果この行を編集できなくなる側が生まれる更新を拒否する）を9件追加。
  項目8はRの2回のレビューを経て「区分をまたぐ変換自体を拒む」形になり、
  設定者・設定者でない側の両方を主語にしたテストと、2段階の迂回が1回目で
  拒まれることを固定するテストを含む
- `event.test.ts`: `event.list`が返す`canEdit`と`event.update`/`event.delete`の
  実際の可否が一致することを、`kind × is_shared × 設定者かどうか`の8通り
  （作れない組み合わせ〈anniversary/meetup × is_shared=true〉は除外）で
  突き合わせる`it.each`テストを追加。`is_shared`が`kind='plan'`以外に立てられ
  ないことを入力・DB CHECK両方で確かめるテストも追加

## `pnpm --filter @futary/app run test`

apps/app 96件→107件（+11）すべて緑。詳細は`test-results-app.txt`

内訳（`calendar-screen.test.tsx`）:
- 種別がplanのときだけ「ふたりの予定にする」ボタンが出る
- チェックして送信するとisShared:trueで作成される
- kindをplan以外に切り替えるとisSharedがfalseに戻って送信される
- canEdit:falseのイベントは押しても何も起きず「編集は設定者のみ」と表示される
- canEdit:trueのイベントは通常どおり編集でき、is_sharedの状態がチェックに反映される
- 元の種別がplan以外（記念日・会った日）のときは、種別の選択肢から「予定」が
  外れる。既存のplanを編集しているとき・新規作成のときは3つとも選べる
- 既存のplan・新規作成では「ふたりの予定」を自由にチェック・解除できる

## `pnpm --filter @futary/contract run type-check` / `@futary/api` / `@futary/ui` / `@futary/app`

すべて通過。

## `pnpm lint`

エラーなし。

## `pnpm --filter @futary/db run generate`（drizzle-kitのスナップショット同期確認）

`events`単体の差分（`0010_event_is_shared.sql`）になることを確認済み。
`couples`（親テーブル）を巻き込む差分が出ないことを確認した（詳細は
worklog.md参照。0009スナップショットの欠落エントリを修正済み）。

## マイグレーション0010の実データでの直接確認（Rレビュー指摘）

apps/apiのvitestテストが使うminiflare D1は各テストファイルとも`events`が
空の状態でマイグレーションを適用するため、**既存行がある状態での
INSERT...SELECTの不具合をテストでは検出できなかった**（Rが実機のSQLiteで
`no such column: is_shared`のエラーを発見）。

drizzle-kitが生成したSELECT側に、追加する側の新列`is_shared`をそのまま
含めてしまっていた。SQLiteのビルド・バージョンによっては未解決の二重引用符
識別子が文字列リテラルへ静かにフォールバックし（エラーにならず全行へ文字列
`"is_shared"`が入る）、厳格な設定では代わりにマイグレーションそのものが
失敗する。SELECT側を新列の既定値（`0`）に手で直し、`.wrangler/state/v3/d1`を
削除してローカルD1に0000〜0009を適用→`events`へ既存行相当のテスト行を
`wrangler d1 execute`で直接INSERT→0010を適用→`is_shared`が`0`
（integer）になっていることを実機で確認した。
