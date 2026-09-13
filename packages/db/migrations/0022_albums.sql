CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`couple_id` text NOT NULL,
	`title` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`start_date` text,
	`end_date` text,
	`cover_photo_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `albums_couple_created_idx` ON `albums` (`couple_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `album_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`album_id` text NOT NULL,
	`key` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`taken_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `album_photos_album_taken_idx` ON `album_photos` (`album_id`,`taken_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `album_photos_key_unique` ON `album_photos` (`key`);
