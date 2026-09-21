CREATE TABLE `screened_store_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_slug` text NOT NULL,
	`store_product_id` text NOT NULL,
	`screened_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `screened_store_products_store_product_unique` ON `screened_store_products` (`store_slug`,`store_product_id`);