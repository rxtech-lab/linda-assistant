CREATE TABLE `history_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`history_id` text NOT NULL,
	`email_id` text NOT NULL,
	FOREIGN KEY (`history_id`) REFERENCES `task_history`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`email_id`) REFERENCES `email_inbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `history_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`history_id` text NOT NULL,
	`webhook_id` text NOT NULL,
	FOREIGN KEY (`history_id`) REFERENCES `task_history`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhook_inbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`webhook_id` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhook_inbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `task_history` ADD `source` text;