CREATE TABLE `assignees` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`personality` text,
	`model` text,
	`tool_permissions` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text,
	`assignee_id` text,
	`title` text,
	`status` text DEFAULT 'starting',
	`messages` text DEFAULT '[]',
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_id`) REFERENCES `assignees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_session_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`parameters` text,
	`status` text DEFAULT 'pending',
	`created_at` text DEFAULT (datetime('now')),
	`resolved_at` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_token` text NOT NULL,
	`platform` text NOT NULL,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `email_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`assignee_id` text,
	`from_email` text NOT NULL,
	`from_name` text,
	`to_email` text NOT NULL,
	`subject` text,
	`body` text,
	`received_at` text NOT NULL,
	`is_read` integer DEFAULT false,
	`metadata` text,
	FOREIGN KEY (`assignee_id`) REFERENCES `assignees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `task_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`email_id` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`email_id`) REFERENCES `email_inbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending',
	`tags` text,
	`categories` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
