CREATE TABLE `excluded_credit_names` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`credited_name` text NOT NULL,
	`source_store_slug` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `excluded_credit_names_name_store_unique` ON `excluded_credit_names` (`credited_name`,`source_store_slug`);