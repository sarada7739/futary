PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reactions` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`, `kind`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reactions_kind_check" CHECK("__new_reactions"."kind" IN ('heart'))
);
--> statement-breakpoint
INSERT INTO `__new_reactions`("post_id", "user_id", "kind", "created_at") SELECT "post_id", "user_id", "kind", "created_at" FROM `reactions`;--> statement-breakpoint
DROP TABLE `reactions`;--> statement-breakpoint
ALTER TABLE `__new_reactions` RENAME TO `reactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;