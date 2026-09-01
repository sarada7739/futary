PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invite_failures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip_address` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_invite_failures`("id", "ip_address", "created_at") SELECT "id", "ip_address", "created_at" FROM `invite_failures`;--> statement-breakpoint
DROP TABLE `invite_failures`;--> statement-breakpoint
ALTER TABLE `__new_invite_failures` RENAME TO `invite_failures`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `invite_failures_ip_created_idx` ON `invite_failures` (`ip_address`,`created_at`);