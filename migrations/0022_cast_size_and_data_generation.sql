CREATE TABLE `data_generation` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `audio_works` ADD `cast_size` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `store_listings_store_first_seen_idx` ON `store_listings` (`store_slug`,`first_seen_at`);