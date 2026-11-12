CREATE TABLE `application_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`application_id` integer NOT NULL,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`stored_name` text NOT NULL,
	`resume_id` integer,
	`template` text,
	`page_count` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_documents_stored_name_unique` ON `application_documents` (`stored_name`);--> statement-breakpoint
CREATE INDEX `application_documents_application_idx` ON `application_documents` (`application_id`);