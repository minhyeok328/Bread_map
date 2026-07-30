CREATE TABLE `account` (
	`account_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_type_allowed" CHECK("account"."type" = 'oauth'),
	CONSTRAINT "account_provider_allowed" CHECK("account"."provider" = 'kakao')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_identity_unique` ON `account` (`provider`,`provider_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_user_provider_unique` ON `account` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`session_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_token_hash` text NOT NULL,
	`authenticated_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_token_hash_format" CHECK(length("session"."session_token_hash") = 64
        and "session"."session_token_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "session_expiry_after_authentication" CHECK("session"."expires_at_ms" > "session"."authenticated_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_hash_unique` ON `session` (`session_token_hash`);--> statement-breakpoint
CREATE INDEX `session_user_expiry_idx` ON `session` (`user_id`,`expires_at_ms`);--> statement-breakpoint
CREATE TABLE `user` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	CONSTRAINT "user_status_allowed" CHECK("user"."status" in ('ACTIVE', 'DELETING')),
	CONSTRAINT "user_deletion_state_consistent" CHECK(("user"."status" = 'ACTIVE' and "user"."deleted_at_ms" is null)
        or ("user"."status" = 'DELETING' and "user"."deleted_at_ms" is not null))
);
--> statement-breakpoint
CREATE INDEX `user_status_idx` ON `user` (`status`);--> statement-breakpoint
CREATE TABLE `favorite` (
	`favorite_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`store_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `favorite_user_store_unique` ON `favorite` (`user_id`,`store_id`);--> statement-breakpoint
CREATE INDEX `favorite_user_created_idx` ON `favorite` (`user_id`,`created_at_ms`);--> statement-breakpoint
CREATE TABLE `search_history` (
	`search_history_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`display_filters_json` text NOT NULL,
	`data_snapshot_version` text NOT NULL,
	`recommendation_version` text NOT NULL,
	`result_count` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "search_history_filters_json_valid" CHECK(json_valid("search_history"."display_filters_json")),
	CONSTRAINT "search_history_result_count_nonnegative" CHECK("search_history"."result_count" >= 0),
	CONSTRAINT "search_history_data_version_format" CHECK(length("search_history"."data_snapshot_version") = 79
        and substr("search_history"."data_snapshot_version", 1, 15) = 'search-data-v1_'
        and substr("search_history"."data_snapshot_version", 16)
          not glob '*[^0-9a-f]*'),
	CONSTRAINT "search_history_recommendation_version_allowed" CHECK("search_history"."recommendation_version" = 'recommendation-v1')
);
--> statement-breakpoint
CREATE INDEX `search_history_user_created_idx` ON `search_history` (`user_id`,`created_at_ms`);--> statement-breakpoint
CREATE TABLE `selection_history` (
	`selection_history_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`store_id` text NOT NULL,
	`source_surface` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "selection_history_surface_allowed" CHECK("selection_history"."source_surface" in ('LIST', 'MAP', 'SEARCH'))
);
--> statement-breakpoint
CREATE INDEX `selection_history_user_created_idx` ON `selection_history` (`user_id`,`created_at_ms`);