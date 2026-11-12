CREATE TABLE `application_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`application_id` integer NOT NULL,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`title` text,
	`body` text,
	`network_contact_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`network_contact_id`) REFERENCES `network_contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `application_events_application_idx` ON `application_events` (`application_id`,`occurred_at`);