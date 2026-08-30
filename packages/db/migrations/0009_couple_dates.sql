-- couplesは複数の子テーブル（couple_members・invites・invite_failures・events・
-- posts）からFOREIGN KEYで参照される親テーブル。drizzle-kitはCHECK制約の追加を
-- 「新テーブルを作って差し替える」手順（PRAGMA foreign_keys=OFF; ...; DROP TABLE
-- couples; ...）で生成するが、D1はPRAGMA foreign_keys=OFFを無視して常にFKを強制
-- するため（architecture.md 4節）、親テーブルの DROP がFOREIGN KEY constraint
-- failedで落ちる（実測）。単一列で完結するprimary_dateはALTER TABLE ADD COLUMNに
-- 直接CHECKを付けられるため素直に追加し、married_dateとの2列にまたがる制約だけは
-- テーブルを作り直さずTRIGGERで表す
ALTER TABLE `couples` ADD `married_date` text;--> statement-breakpoint
ALTER TABLE `couples` ADD `primary_date` text DEFAULT 'dating' NOT NULL CHECK("primary_date" IN ('dating', 'married', 'none'));--> statement-breakpoint
CREATE TRIGGER `couples_married_date_required_insert`
  BEFORE INSERT ON `couples`
  WHEN NEW.primary_date = 'married' AND NEW.married_date IS NULL
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: couples_married_date_required');
END;--> statement-breakpoint
CREATE TRIGGER `couples_married_date_required_update`
  BEFORE UPDATE ON `couples`
  WHEN NEW.primary_date = 'married' AND NEW.married_date IS NULL
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: couples_married_date_required');
END;--> statement-breakpoint
CREATE TRIGGER `couples_married_after_anniversary_insert`
  BEFORE INSERT ON `couples`
  WHEN NEW.married_date IS NOT NULL AND NEW.married_date < NEW.anniversary_date
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: couples_married_after_anniversary');
END;--> statement-breakpoint
CREATE TRIGGER `couples_married_after_anniversary_update`
  BEFORE UPDATE ON `couples`
  WHEN NEW.married_date IS NOT NULL AND NEW.married_date < NEW.anniversary_date
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: couples_married_after_anniversary');
END;
