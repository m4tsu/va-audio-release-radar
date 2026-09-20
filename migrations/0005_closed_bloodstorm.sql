PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_crawl_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`store_slug` text NOT NULL,
	`voice_actor_id` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`work_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`total_count` integer,
	`coverage_complete` integer
);
--> statement-breakpoint
INSERT INTO `__new_crawl_runs`("id", "store_slug", "voice_actor_id", "started_at", "finished_at", "work_count", "new_count", "status", "error", "total_count", "coverage_complete") SELECT "id", "store_slug", "voice_actor_id", "started_at", "finished_at", "work_count", "new_count", "status", "error", "total_count", "coverage_complete" FROM `crawl_runs`;--> statement-breakpoint
DROP TABLE `crawl_runs`;--> statement-breakpoint
ALTER TABLE `__new_crawl_runs` RENAME TO `crawl_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `crawl_runs_store_actor_started_idx` ON `crawl_runs` (`store_slug`,`voice_actor_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `store_listings` DROP COLUMN `price`;--> statement-breakpoint
ALTER TABLE `store_listings` DROP COLUMN `list_price`;--> statement-breakpoint
ALTER TABLE `store_listings` DROP COLUMN `available`;