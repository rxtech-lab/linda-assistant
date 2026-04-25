CREATE TABLE `live_activity_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`token` text NOT NULL,
	`ended_at` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_activity_tokens_activity_id_unique` ON `live_activity_tokens` (`activity_id`);--> statement-breakpoint
ALTER TABLE `devices` ADD `live_activity_start_token` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `live_activity_enabled` integer DEFAULT true;