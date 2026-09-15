ALTER TABLE `couple_plans` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `couple_plans` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `couple_plans` ADD `stripe_cancel_at` integer;