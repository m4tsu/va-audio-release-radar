CREATE TABLE `inquiries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`contact` text,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inquiries_received_at_idx` ON `inquiries` (`received_at`);