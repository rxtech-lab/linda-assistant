CREATE TABLE `slide_decks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_session_id` text NOT NULL,
	`title` text NOT NULL,
	`theme` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `slide_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`scene_data` text,
	`image_url` text,
	`thumbnail_url` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`deck_id`) REFERENCES `slide_decks`(`id`) ON UPDATE no action ON DELETE cascade
);
