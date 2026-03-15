CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_session_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`approval_id` text NOT NULL,
	`questions_data` text,
	`answers` text,
	`status` text DEFAULT 'pending',
	`created_at` text DEFAULT (datetime('now')),
	`answered_at` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
