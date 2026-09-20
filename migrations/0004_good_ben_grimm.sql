CREATE TABLE `anime_title_synonyms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`anime_title_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`anime_title_id`) REFERENCES `anime_titles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anime_title_synonyms_title_name_unique` ON `anime_title_synonyms` (`anime_title_id`,`name`);--> statement-breakpoint
CREATE INDEX `anime_title_synonyms_anime_title_id_idx` ON `anime_title_synonyms` (`anime_title_id`);--> statement-breakpoint
ALTER TABLE `anime_titles` ADD `cover_image_color` text;--> statement-breakpoint
ALTER TABLE `anime_titles` ADD `format` text;--> statement-breakpoint
ALTER TABLE `anime_titles` ADD `popularity` integer;--> statement-breakpoint
ALTER TABLE `anime_titles` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `anime_titles` ADD `end_date` text;