# 023: 付き合った日を、登録時に聞かない — テスト結果

実行日: 2026-08-31 / セッションB

## `pnpm --filter @futary/api run test`

apps/api 288件→296件（+8）すべて緑。

内訳:
- `stats.test.ts`: `computeDaysTogether`のunit testに`unset`3件を追加
  （primary_date='dating'でdating_dateが無い／primary_date='married'で
  married_dateが無い／married_dateが無ければdating_dateがあってもunset。
  「片方の日付があるから、そっちを出す」はしない、を確認）。統合テストに
  「couple.create直後（datingDate未設定）はunset」「datingDateが無くても
  meetupDays/postCount/photoCountは返る」を追加
- `couple.test.ts`: `couple.create`の入力に日付が無くなったため全面書き換え。
  日付の形式・範囲検証（旧couple.createのテスト）は`couple.update`のdatingDate
  検証へ移設。TRIGGER直接検証に「dating_dateがNULLでもmarried_dateを設定
  できる」を追加（023の要望本体をDB側でも確認）
- `schema-integrity.test.ts`: `couples_married_after_anniversary`の2本の
  TRIGGERのWHEN句期待値を、dating_date参照・NULL許容の形に更新（名前は
  変えていない。`couples_married_date_required_*`は対象外。タスク定義
  「作り直すのは2本であって4本ではない」）
- `migration-existing-rows.test.ts`（新規describe）: `conventions.md` 6節
  「既存行の扱いが変わるマイグレーションは、行を入れた状態で当てる」。
  `d1_migrations`テーブルから0012の適用記録を外し、`couples`を0011時点の
  構造（`anniversary_date`列・旧TRIGGER）へ一時的に戻して既存行をINSERTした
  うえで、実物の`0012_couple_dating_date_optional.sql`を再適用し、
  `anniversary_date`の値が`dating_date`へそのまま移ることを確認した
  （0011テストのevents版と同じ形。TRIGGER名がDB全体で一意なため、
  退避前に一度落として後片付けで作り直す必要があった）
- 他の既存テストファイル（authorization/event/invite/memory/post/reaction/
  method-restriction）は`couple.create`の呼び出しから日付引数を除去、
  直接SQLの`anniversary_date`列を`dating_date`へ変更しただけで、
  各ファイル自体のテスト内容（別ドメイン）は変えていない

## `pnpm --filter @futary/app run test`

apps/app 129件→133件（+4）すべて緑。

内訳:
- `profile-screen.test.tsx`: テストIDを`profile-anniversary-date`→
  `profile-dating-date`に更新。新設descrbe「datingDateが未設定（023）」に
  2件追加（datingDateがnullのまま名前だけ変更保存／marriedDateだけ設定保存。
  タスク定義の要望本体をUI結合テストでも確認）
- `stats-card.test.tsx`・`stats-screen.test.tsx`: `stats-card.tsx`・
  `app/(tabs)/stats.tsx`が`useRouter`を使うようになったため、
  `home-screen.test.tsx`と同じ形で`expo-router`をモック。各1件、
  「daysTogetherが'unset'ならマイページへの導線が出て、押すと`/profile`へ
  遷移する」を追加。hiddenのときは導線が出ないことも既存テストに追記

## `pnpm --filter ... run type-check`（全ワークスペース）・`pnpm lint`

すべて通過。

## マイグレーション0012（`packages/db/migrations/0012_couple_dating_date_optional.sql`）

`couples`は複数の子テーブルからFOREIGN KEYで参照される親テーブルのため、
drizzle-kitの既定手順（表を作り直す）はD1で`FOREIGN KEY constraint failed`
になる（0009・022と同じ制約）。着手前にローカルD1へ実際に流して確認した
（`docs/worklog.md` 2026-08-31参照）:

1. `ALTER TABLE couples ADD dating_date text`
2. `UPDATE couples SET dating_date = anniversary_date`
3. `anniversary_date`を参照する2本のTRIGGER（`couples_married_after_anniversary_*`。
   `couples_married_date_required_*`は対象外）を落として、dating_date参照・
   NULL許容の形で作り直す
4. `ALTER TABLE couples DROP COLUMN anniversary_date` — **D1で通ることを実測確認済み**

3を飛ばして4を先にやると`no such column: NEW.anniversary_date`で失敗する
ことも実測した。既存行（`dating_date`に値が入る）・新規行（`dating_date`が
NULLのまま`married_date`を設定できる）の両方をローカルD1で直接確認済み。

`meta/`のスナップショット・journalは非TTY環境のため手動生成し
（022と同じ手順）、`pnpm generate`が「No schema changes」を返すことで
スキーマ定義との一致を検証した。ローカルD1・リモートD1への実適用は
Rレビュー・マージ後、人間の許可を得てから行う（018以降の方針を維持）。
