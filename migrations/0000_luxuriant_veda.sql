CREATE TABLE `audio_credits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audio_work_id` text NOT NULL,
	`voice_actor_id` text,
	`credited_name` text NOT NULL,
	`role` text,
	`confidence` text NOT NULL,
	`source_store_slug` text NOT NULL,
	FOREIGN KEY (`audio_work_id`) REFERENCES `audio_works`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voice_actor_id`) REFERENCES `voice_actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audio_credits_work_name_store_unique` ON `audio_credits` (`audio_work_id`,`credited_name`,`source_store_slug`);--> statement-breakpoint
CREATE INDEX `audio_credits_voice_actor_id_idx` ON `audio_credits` (`voice_actor_id`);--> statement-breakpoint
CREATE TABLE `audio_works` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`release_date` text,
	`cover_image_url` text,
	`duration_seconds` integer,
	`adult` integer DEFAULT false NOT NULL,
	`maker_name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audio_works_release_date_idx` ON `audio_works` (`release_date`);--> statement-breakpoint
CREATE TABLE `crawl_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`store_slug` text NOT NULL,
	`voice_actor_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`work_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `crawl_runs_store_actor_started_idx` ON `crawl_runs` (`store_slug`,`voice_actor_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `store_listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audio_work_id` text NOT NULL,
	`store_slug` text NOT NULL,
	`store_product_id` text NOT NULL,
	`product_url` text NOT NULL,
	`affiliate_url` text,
	`title_raw` text NOT NULL,
	`price` integer,
	`list_price` integer,
	`available` integer DEFAULT true NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_checked_at` text NOT NULL,
	FOREIGN KEY (`audio_work_id`) REFERENCES `audio_works`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_listings_store_product_unique` ON `store_listings` (`store_slug`,`store_product_id`);--> statement-breakpoint
CREATE INDEX `store_listings_audio_work_id_idx` ON `store_listings` (`audio_work_id`);--> statement-breakpoint
CREATE TABLE `voice_actor_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voice_actor_id` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`voice_actor_id`) REFERENCES `voice_actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_actor_aliases_actor_name_unique` ON `voice_actor_aliases` (`voice_actor_id`,`name`);--> statement-breakpoint
CREATE TABLE `voice_actors` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`canonical_name` text NOT NULL,
	`name_kana` text,
	`anilist_staff_id` integer,
	`image_url` text,
	`status` text DEFAULT 'unknown' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_actors_slug_unique` ON `voice_actors` (`slug`);