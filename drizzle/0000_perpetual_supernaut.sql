CREATE TABLE `lesson_operations` (
	`room_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `operation_id`),
	FOREIGN KEY (`room_id`) REFERENCES `lesson_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lesson_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`teacher_id` text,
	`invitation_hash` text NOT NULL,
	`packet` text NOT NULL,
	`snapshot` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_op` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`closed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_learner` ON `lesson_rooms` (`learner_id`);--> statement-breakpoint
CREATE INDEX `rooms_teacher` ON `lesson_rooms` (`teacher_id`);