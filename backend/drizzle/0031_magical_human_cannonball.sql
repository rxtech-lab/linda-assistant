CREATE TABLE `data_sheets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_session_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`columns` text,
	`row_count` integer DEFAULT 0 NOT NULL,
	`s3_data_url` text,
	`inline_data` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
