PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_events` (
	`id` text PRIMARY KEY NOT NULL,
	`couple_id` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`repeat_yearly` integer DEFAULT false NOT NULL,
	`time` text,
	`created_by` text NOT NULL,
	`is_shared` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "events_kind_check" CHECK("__new_events"."kind" IN ('anniversary', 'plan', 'meetup')),
	CONSTRAINT "events_is_shared_check" CHECK("__new_events"."is_shared" = 0 OR "__new_events"."kind" = 'plan')
);
--> statement-breakpoint
-- drizzle-kitが生成したそのままだと、SELECT側にも"is_shared"を含めてしまう。
-- is_sharedは今回このマイグレーションで初めて追加する列で、移行元のevents
-- （旧テーブル）にはまだ存在しない。SQLiteは未解決の二重引用符識別子を
-- 文字列リテラルへ静かにフォールバックする実装があり（DQSの既定値は
-- SQLiteのバージョン・ビルドに依存）、その場合エラーにならず全行のis_shared
-- に文字列"is_shared"が入ってしまう（INTEGER列への型親和性変換でも数値化
-- されない）。厳格な設定のSQLiteでは代わりに`no such column: is_shared`で
-- 移行そのものが失敗する（Rが実機で確認）。SELECT側は新しい列の既定値
-- （0=false）を直接書く（手で直した。0008の重複解消DELETEと同じ形）
INSERT INTO `__new_events`("id", "couple_id", "date", "title", "kind", "repeat_yearly", "time", "created_by", "is_shared", "created_at") SELECT "id", "couple_id", "date", "title", "kind", "repeat_yearly", "time", "created_by", 0, "created_at" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `events_couple_date_idx` ON `events` (`couple_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_meetup_unique` ON `events` (`couple_id`,`date`) WHERE "events"."kind" = 'meetup';