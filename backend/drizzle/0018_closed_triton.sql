CREATE TABLE `briefing_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`briefing_id` text NOT NULL,
	`document_id` text NOT NULL,
	FOREIGN KEY (`briefing_id`) REFERENCES `briefings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `briefings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_session_id` text,
	`assignee_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`image_url` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_id`) REFERENCES `assignees`(`id`) ON UPDATE no action ON DELETE set null
);
