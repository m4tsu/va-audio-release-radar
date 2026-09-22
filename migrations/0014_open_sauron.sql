CREATE TABLE `voice_actor_attributes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voice_actor_id` text NOT NULL,
	`attribute` text NOT NULL,
	`source` text NOT NULL,
	`value` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`voice_actor_id`) REFERENCES `voice_actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_actor_attributes_actor_attribute_source_unique` ON `voice_actor_attributes` (`voice_actor_id`,`attribute`,`source`);--> statement-breakpoint
ALTER TABLE `voice_actors` ADD `first_seen_at` text;--> statement-breakpoint
UPDATE `voice_actors` SET `first_seen_at` = `created_at` WHERE `first_seen_at` IS NULL;--> statement-breakpoint
ALTER TABLE `voice_actors` ADD `last_seen_season_year` integer;--> statement-breakpoint
ALTER TABLE `voice_actors` ADD `last_seen_season` text;--> statement-breakpoint
CREATE UNIQUE INDEX `voice_actors_anilist_staff_id_unique` ON `voice_actors` (`anilist_staff_id`);