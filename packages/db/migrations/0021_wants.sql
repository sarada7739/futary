CREATE TABLE `wants` (
	`id` text PRIMARY KEY NOT NULL,
	`couple_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`note` text DEFAULT '' NOT NULL,
	`image_key` text,
	`created_at` integer NOT NULL,
	`obtained_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wants_couple_owner_created_idx` ON `wants` (`couple_id`,`owner_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `wants_image_key_unique` ON `wants` (`image_key`);