DROP INDEX "devices_device_token_unique";--> statement-breakpoint
DROP INDEX "email_inbox_email_id_unique";--> statement-breakpoint
DROP INDEX "task_extensions_task_id_extension_id_unique";--> statement-breakpoint
DROP INDEX "user_settings_user_id_unique";--> statement-breakpoint
ALTER TABLE `uploads` ALTER COLUMN "number_uploads" TO "number_uploads" integer;--> statement-breakpoint
CREATE UNIQUE INDEX `devices_device_token_unique` ON `devices` (`device_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_inbox_email_id_unique` ON `email_inbox` (`email_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_extensions_task_id_extension_id_unique` ON `task_extensions` (`task_id`,`extension_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);