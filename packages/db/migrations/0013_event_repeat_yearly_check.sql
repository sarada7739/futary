-- リモートD1へ適用する前に、このCHECKに違反する既存行が無いかを数えること
-- （architecture.md 4節「行を消すマイグレーションは、当てる前に件数を数えて
-- 記録する」と同じ理由。このマイグレーションは行を消さないが、下のINSERT文が
-- 表の作り直し中に失敗すると同様に手動での復旧が要る）。
--   SELECT COUNT(*) FROM events WHERE repeat_yearly = 1 AND kind <> 'anniversary';
-- 0件でなければ、このマイグレーションを当てる前に是正する。
-- 【Rレビュー実測: 違反行がある状態で当てると、下のINSERT文がCHECK違反で
-- 失敗し、events本体は無事だが __new_events が残骸として残る。この状態で
-- 是正だけしてそのまま再実行すると「table `__new_events` already exists」で
-- 別のエラーになる。是正の前に必ず残骸を消すこと】
--   DROP TABLE IF EXISTS __new_events;
--   UPDATE events SET repeat_yearly = 0 WHERE repeat_yearly = 1 AND kind <> 'anniversary';
-- で是正してから適用する（security-auditor指摘。0件でも結果をworklog.mdに記録する）
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
	CONSTRAINT "events_repeat_yearly_check" CHECK("__new_events"."repeat_yearly" = 0 OR "__new_events"."kind" = 'anniversary'),
	CONSTRAINT "events_is_shared_check" CHECK("__new_events"."is_shared" = 0 OR "__new_events"."kind" = 'plan'),
	CONSTRAINT "events_start_time_check" CHECK("__new_events"."start_time" IS NULL OR "__new_events"."kind" <> 'anniversary'),
	CONSTRAINT "events_end_time_requires_start_check" CHECK("__new_events"."end_time" IS NULL OR "__new_events"."start_time" IS NOT NULL),
	CONSTRAINT "events_end_time_after_start_check" CHECK("__new_events"."end_time" IS NULL OR "__new_events"."end_time" > "__new_events"."start_time")
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "couple_id", "date", "title", "kind", "repeat_yearly", "start_time", "end_time", "created_by", "is_shared", "created_at") SELECT "id", "couple_id", "date", "title", "kind", "repeat_yearly", "start_time", "end_time", "created_by", "is_shared", "created_at" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `events_couple_date_idx` ON `events` (`couple_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_meetup_unique` ON `events` (`couple_id`,`date`) WHERE "events"."kind" = 'meetup';