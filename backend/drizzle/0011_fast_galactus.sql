ALTER TABLE `tasks` ADD `assignee_id` text REFERENCES assignees(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `cron_schedule` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `is_cron_enabled` integer DEFAULT false;