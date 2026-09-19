CREATE TABLE `anime_appearances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`anime_title_id` text NOT NULL,
	`voice_actor_id` text NOT NULL,
	`character_id` text NOT NULL,
	`character_name_native` text NOT NULL,
	`character_name_full` text,
	`character_image_url` text,
	`role` text NOT NULL,
	FOREIGN KEY (`anime_title_id`) REFERENCES `anime_titles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voice_actor_id`) REFERENCES `voice_actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anime_appearances_title_character_actor_unique` ON `anime_appearances` (`anime_title_id`,`character_id`,`voice_actor_id`);--> statement-breakpoint
CREATE INDEX `anime_appearances_anime_title_id_idx` ON `anime_appearances` (`anime_title_id`);--> statement-breakpoint
CREATE INDEX `anime_appearances_voice_actor_id_idx` ON `anime_appearances` (`voice_actor_id`);--> statement-breakpoint
CREATE TABLE `anime_titles` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title_native` text NOT NULL,
	`title_romaji` text NOT NULL,
	`title_english` text,
	`season_year` integer NOT NULL,
	`season` text NOT NULL,
	`cover_image_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anime_titles_slug_unique` ON `anime_titles` (`slug`);--> statement-breakpoint
CREATE INDEX `anime_titles_season_idx` ON `anime_titles` (`season_year`,`season`);--> statement-breakpoint
ALTER TABLE `voice_actors` ADD `name_en` text;