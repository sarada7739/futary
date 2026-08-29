CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`couple_id` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`repeat_yearly` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "events_kind_check" CHECK("events"."kind" IN ('anniversary', 'plan', 'meetup'))
);
--> statement-breakpoint
CREATE INDEX `events_couple_date_idx` ON `events` (`couple_id`,`date`);