ALTER TABLE `email_inbox` ADD `email_id` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `email_inbox_email_id_unique` ON `email_inbox` (`email_id`);