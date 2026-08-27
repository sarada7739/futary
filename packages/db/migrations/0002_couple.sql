CREATE TABLE `couple_members` (
	`couple_id` text NOT NULL,
	`user_id` text NOT NULL,
	`slot` integer NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`couple_id`, `user_id`),
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "couple_members_slot_check" CHECK("couple_members"."slot" IN (1, 2))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `couple_members_user_id_unique` ON `couple_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `couple_members_couple_id_slot_unique` ON `couple_members` (`couple_id`,`slot`);--> statement-breakpoint
CREATE TABLE `couples` (
	`id` text PRIMARY KEY NOT NULL,
	`anniversary_date` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invite_failures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`ip_address` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invite_failures_user_created_idx` ON `invite_failures` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `invite_failures_ip_created_idx` ON `invite_failures` (`ip_address`,`created_at`);--> statement-breakpoint
CREATE TABLE `invites` (
	`code` text PRIMARY KEY NOT NULL,
	`couple_id` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
