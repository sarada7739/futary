CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`couple_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`image_key` text,
	`image_width` integer,
	`image_height` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_couple_created_idx` ON `posts` (`couple_id`,`created_at`);