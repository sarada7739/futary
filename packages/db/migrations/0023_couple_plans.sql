CREATE TABLE `couple_plans` (
	`couple_id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`expires_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action
);
