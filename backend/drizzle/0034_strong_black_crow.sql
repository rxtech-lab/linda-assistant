CREATE TABLE `audios` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_session_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`prompt` text NOT NULL,
	`content` text NOT NULL,
	`audio_url` text,
	`status` text NOT NULL,
	`error_message` text,
	`transcript` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
