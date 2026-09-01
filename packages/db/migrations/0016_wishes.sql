CREATE TABLE `wishes` (
	`id` text PRIMARY KEY NOT NULL,
	`couple_id` text NOT NULL,
	`title` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`done_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wishes_couple_created_idx` ON `wishes` (`couple_id`,`created_at`);