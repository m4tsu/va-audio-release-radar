CREATE TABLE `push_digest_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`digest_scheduled_at` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`subscription_count` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`expired_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `push_digest_runs_scheduled_started_idx` ON `push_digest_runs` (`digest_scheduled_at`,`started_at`);--> statement-breakpoint
CREATE TABLE `push_subscription_actors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscription_id` integer NOT NULL,
	`voice_actor_id` text NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`voice_actor_id`) REFERENCES `voice_actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscription_actors_subscription_actor_unique` ON `push_subscription_actors` (`subscription_id`,`voice_actor_id`);--> statement-breakpoint
CREATE INDEX `push_subscription_actors_voice_actor_id_idx` ON `push_subscription_actors` (`voice_actor_id`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`locale` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_attempted_at` text,
	`last_digest_scheduled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);