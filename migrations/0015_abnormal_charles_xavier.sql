CREATE TABLE `anilist_ingest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`season_from_year` integer NOT NULL,
	`season_from` text NOT NULL,
	`season_to_year` integer NOT NULL,
	`season_to` text NOT NULL,
	`season_count` integer NOT NULL,
	`anime_count` integer DEFAULT 0 NOT NULL,
	`actor_count` integer DEFAULT 0 NOT NULL,
	`new_actor_count` integer DEFAULT 0 NOT NULL,
	`new_appearance_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `anilist_ingest_runs_started_at_idx` ON `anilist_ingest_runs` (`started_at`);