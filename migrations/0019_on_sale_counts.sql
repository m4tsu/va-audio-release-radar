ALTER TABLE `anime_titles` ADD `on_sale_actor_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `voice_actors` ADD `on_sale_work_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `voice_actors` ADD `on_sale_store_slugs` text;--> statement-breakpoint
CREATE INDEX `store_listings_first_seen_at_idx` ON `store_listings` (`first_seen_at`);