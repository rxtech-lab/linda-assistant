CREATE TABLE IF NOT EXISTS `extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`image_url` text,
	`mcp_url` text NOT NULL,
	`prefix` text NOT NULL,
	`auth_type` text NOT NULL DEFAULT 'rxauth',
	`auth_config` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assignee_extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`assignee_id` text NOT NULL,
	`extension_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`tool_permissions` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`assignee_id`) REFERENCES `assignees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
CREATE UNIQUE INDEX IF NOT EXISTS `task_extensions_task_id_extension_id_unique` ON `task_extensions` (`task_id`, `extension_id`);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `tool_permissions` text;