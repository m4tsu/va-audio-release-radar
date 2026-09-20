CREATE TABLE `crawl_leases` (
	`key` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL
);
