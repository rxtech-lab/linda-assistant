DROP INDEX IF EXISTS `live_activity_tokens_activity_id_unique`;--> statement-breakpoint
ALTER TABLE `briefings` ADD `podcast_status` text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `briefings` ADD `podcast_error` text;--> statement-breakpoint
ALTER TABLE `briefings` ADD `podcast_attempts` integer DEFAULT 0;--> statement-breakpoint
UPDATE `briefings` SET `podcast_status` = 'ready' WHERE `podcast_url` IS NOT NULL;