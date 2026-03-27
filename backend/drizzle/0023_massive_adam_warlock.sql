CREATE TABLE `task_history` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`chat_session_id` text NOT NULL,
	`assignee_id` text,
	`user_id` text NOT NULL,
	`summary` text NOT NULL,
	`embedding` F32_BLOB(768),
	`tool_calls` text,
	`status` text,
	`duration_secs` integer,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `assignees`(`id`) ON UPDATE no action ON DELETE set null
);
