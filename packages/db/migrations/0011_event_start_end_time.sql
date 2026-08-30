PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_events` (
	`id` text PRIMARY KEY NOT NULL,
	`couple_id` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`repeat_yearly` integer DEFAULT false NOT NULL,
	`start_time` text,
	`end_time` text,
	`created_by` text NOT NULL,
	`is_shared` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "events_kind_check" CHECK("__new_events"."kind" IN ('anniversary', 'plan', 'meetup')),
	CONSTRAINT "events_is_shared_check" CHECK("__new_events"."is_shared" = 0 OR "__new_events"."kind" = 'plan'),
	CONSTRAINT "events_start_time_check" CHECK("__new_events"."start_time" IS NULL OR "__new_events"."kind" <> 'anniversary'),
	CONSTRAINT "events_end_time_requires_start_check" CHECK("__new_events"."end_time" IS NULL OR "__new_events"."start_time" IS NOT NULL),
	CONSTRAINT "events_end_time_after_start_check" CHECK("__new_events"."end_time" IS NULL OR "__new_events"."end_time" > "__new_events"."start_time")
);
--> statement-breakpoint
-- time → start_time は改名であり、削除して作り直すのではない。既存の時刻を
-- start_timeへそのまま引き継ぐ（Rの指摘。0010のis_shared追加と同じ形で手で書いた）。
-- end_timeは022で新設する列で移行元に無いため、SELECT側に直接NULLを書く
-- （0010がis_sharedの既定値0を直接書いたのと同じ理由）
INSERT INTO `__new_events`("id", "couple_id", "date", "title", "kind", "repeat_yearly", "start_time", "end_time", "created_by", "is_shared", "created_at") SELECT "id", "couple_id", "date", "title", "kind", "repeat_yearly", "time", NULL, "created_by", "is_shared", "created_at" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `events_couple_date_idx` ON `events` (`couple_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_meetup_unique` ON `events` (`couple_id`,`date`) WHERE "events"."kind" = 'meetup';
