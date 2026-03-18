CREATE TABLE `task_extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`extension_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`tool_permissions` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `tool_permissions` text;