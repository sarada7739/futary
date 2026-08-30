-- couplesは複数の子テーブルからFOREIGN KEYで参照される親テーブルのため、
-- テーブルを作り直す形（drizzle-kitの既定の列改名手順）はD1で
-- FOREIGN KEY constraint failedになる（0009・architecture.md 4節と同じ制約。
-- ローカルD1で実測確認済み。docs/worklog.md 2026-08-31参照）。
-- ALTER TABLE ADD COLUMN + 値コピー + DROP COLUMNの手順で回避する
-- （ALTER TABLE DROP COLUMNがD1で通ることも事前にローカルD1で実測確認済み）。
ALTER TABLE `couples` ADD `dating_date` text;--> statement-breakpoint
UPDATE `couples` SET `dating_date` = `anniversary_date`;--> statement-breakpoint
-- anniversary_dateを参照するTRIGGERは`couples_married_after_anniversary_*`の
-- 2本だけ（`couples_married_date_required_*`はprimary_date/married_dateしか
-- 見ておらず対象外。023タスク定義「作り直すのは2本であって4本ではない」）。
-- これを先に落として作り直さないと、下のDROP COLUMNが
-- 「no such column: NEW.anniversary_date」で失敗する（実測確認済み）。
-- dating_dateがNULL（まだ設定していない）のときは比較しようがないため通す
DROP TRIGGER `couples_married_after_anniversary_insert`;--> statement-breakpoint
DROP TRIGGER `couples_married_after_anniversary_update`;--> statement-breakpoint
CREATE TRIGGER `couples_married_after_anniversary_insert`
  BEFORE INSERT ON `couples`
  WHEN NEW.married_date IS NOT NULL AND NEW.dating_date IS NOT NULL AND NEW.married_date < NEW.dating_date
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: couples_married_after_anniversary');
END;--> statement-breakpoint
CREATE TRIGGER `couples_married_after_anniversary_update`
  BEFORE UPDATE ON `couples`
  WHEN NEW.married_date IS NOT NULL AND NEW.dating_date IS NOT NULL AND NEW.married_date < NEW.dating_date
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: couples_married_after_anniversary');
END;--> statement-breakpoint
ALTER TABLE `couples` DROP COLUMN `anniversary_date`;
