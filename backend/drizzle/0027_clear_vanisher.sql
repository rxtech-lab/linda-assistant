CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_session_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`approval_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`number_uploads` integer NOT NULL,
	`extensions` text,
	`urls` text,
	`uploaded_keys` text,
	`status` text DEFAULT 'pending',
	`created_at` text DEFAULT (datetime('now')),
	`completed_at` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
