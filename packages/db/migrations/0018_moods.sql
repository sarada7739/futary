CREATE TABLE `moods` (
	`couple_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`level` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`couple_id`, `user_id`, `date`),
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "moods_level_range_check" CHECK("moods"."level" BETWEEN 1 AND 5)
);
