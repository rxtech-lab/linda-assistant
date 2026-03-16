ALTER TABLE `chat_sessions` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `cost_usd` real;
