ALTER TABLE `audio_works` ADD `age_rating` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
UPDATE `audio_works` SET `age_rating` = CASE WHEN `adult` = 1 THEN 'r18' ELSE 'general' END;--> statement-breakpoint
ALTER TABLE `audio_works` DROP COLUMN `adult`;--> statement-breakpoint
ALTER TABLE `store_listings` ADD `store_section` text;
