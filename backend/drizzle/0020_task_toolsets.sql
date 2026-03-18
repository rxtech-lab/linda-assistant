ALTER TABLE `tasks` ADD `tool_permissions` text;
CREATE TABLE `task_extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL REFERENCES `tasks`(`id`) ON DELETE cascade,
	`extension_id` text NOT NULL REFERENCES `extensions`(`id`) ON DELETE cascade,
	`enabled` integer DEFAULT false NOT NULL,
	`tool_permissions` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
