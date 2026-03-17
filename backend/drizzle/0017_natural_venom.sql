CREATE TABLE `usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_session_id` text,
	`assignee_id` text,
	`model` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_id`) REFERENCES `assignees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `input_tokens`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `output_tokens`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `cost_usd`;