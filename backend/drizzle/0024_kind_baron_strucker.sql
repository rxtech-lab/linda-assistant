CREATE TABLE `webhook_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`event` text,
	`summary` text,
	`payload` text,
	`received_at` text NOT NULL,
	`is_read` integer DEFAULT false,
	`metadata` text
);
