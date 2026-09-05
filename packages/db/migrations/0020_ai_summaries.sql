CREATE TABLE `ai_summaries` (
	`couple_id` text NOT NULL,
	`period_kind` text NOT NULL,
	`period_key` text NOT NULL,
	`body` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`generated_count` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`couple_id`, `period_kind`, `period_key`),
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_summaries_provider_check" CHECK("ai_summaries"."provider" IN ('openai', 'anthropic')),
	CONSTRAINT "ai_summaries_period_kind_check" CHECK("ai_summaries"."period_kind" IN ('month', 'week'))
);
--> statement-breakpoint
ALTER TABLE `couple_members` ADD `ai_opt_in` integer DEFAULT false NOT NULL;