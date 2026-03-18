CREATE TABLE `scheduled_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`sent` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now'))
);
