CREATE TABLE `kakao_discovery_run` (
	`run_id` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`region_code` text NOT NULL,
	`category_tag` text NOT NULL,
	`status` text NOT NULL,
	`active_slot` integer,
	`policy_snapshot_id` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`finished_at_ms` integer,
	`expires_at_ms` integer NOT NULL,
	CONSTRAINT "kakao_discovery_query_allowed" CHECK("kakao_discovery_run"."query" = '빵집'),
	CONSTRAINT "kakao_discovery_region_allowed" CHECK("kakao_discovery_run"."region_code" = 'SEOUL'),
	CONSTRAINT "kakao_discovery_category_allowed" CHECK("kakao_discovery_run"."category_tag" = '제과,베이커리'),
	CONSTRAINT "kakao_discovery_status_allowed" CHECK("kakao_discovery_run"."status" in (
        'READY', 'RUNNING', 'COMPLETE', 'PARTIAL',
        'STOPPED_POLICY', 'STOPPED_ACCESS', 'FAILED_FINAL'
      )),
	CONSTRAINT "kakao_discovery_active_slot_allowed" CHECK("kakao_discovery_run"."active_slot" is null or "kakao_discovery_run"."active_slot" = 1),
	CONSTRAINT "kakao_discovery_finished_after_start" CHECK("kakao_discovery_run"."finished_at_ms" is null
        or "kakao_discovery_run"."finished_at_ms" >= "kakao_discovery_run"."started_at_ms"),
	CONSTRAINT "kakao_discovery_retention_positive" CHECK("kakao_discovery_run"."expires_at_ms" > "kakao_discovery_run"."started_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kakao_discovery_active_slot_unique` ON `kakao_discovery_run` (`active_slot`);--> statement-breakpoint
CREATE INDEX `kakao_discovery_status_started_idx` ON `kakao_discovery_run` (`status`,`started_at_ms`);--> statement-breakpoint
CREATE TABLE `kakao_place_locator` (
	`locator_id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`provider` text NOT NULL,
	`place_id` text NOT NULL,
	`place_url` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`delete_by_ms` integer NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `kakao_place_observation`(`observation_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kakao_place_locator_provider_allowed" CHECK("kakao_place_locator"."provider" = 'KAKAO'),
	CONSTRAINT "kakao_place_locator_deadline_positive" CHECK("kakao_place_locator"."delete_by_ms" > "kakao_place_locator"."created_at_ms"),
	CONSTRAINT "kakao_place_locator_deadline_max" CHECK("kakao_place_locator"."delete_by_ms" <= "kakao_place_locator"."created_at_ms" + 2592000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kakao_place_locator_observation_unique` ON `kakao_place_locator` (`observation_id`);--> statement-breakpoint
CREATE INDEX `kakao_place_locator_provider_place_idx` ON `kakao_place_locator` (`provider`,`place_id`);--> statement-breakpoint
CREATE INDEX `kakao_place_locator_delete_by_idx` ON `kakao_place_locator` (`delete_by_ms`);--> statement-breakpoint
CREATE TABLE `kakao_place_observation` (
	`observation_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`observation_key` blob NOT NULL,
	`display_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`category_name` text NOT NULL,
	`category_tag` text NOT NULL,
	`road_address` text,
	`lot_address` text,
	`phone` text,
	`latitude_e7` integer NOT NULL,
	`longitude_e7` integer NOT NULL,
	`tile_key` text NOT NULL,
	`page_number` integer NOT NULL,
	`match_status` text NOT NULL,
	`matched_store_id` text,
	`match_signals_json` text NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `kakao_discovery_run`(`run_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kakao_place_observation_key_length" CHECK(length("kakao_place_observation"."observation_key") = 32),
	CONSTRAINT "kakao_place_observation_page_positive" CHECK("kakao_place_observation"."page_number" > 0),
	CONSTRAINT "kakao_place_observation_match_status_allowed" CHECK("kakao_place_observation"."match_status" in (
        'MATCHED_ELIGIBLE', 'MATCHED_EXCLUDED', 'UNMATCHED',
        'AMBIGUOUS', 'CATEGORY_REJECTED'
      )),
	CONSTRAINT "kakao_place_observation_match_store_consistent" CHECK((
        "kakao_place_observation"."match_status" in ('MATCHED_ELIGIBLE', 'MATCHED_EXCLUDED')
        and "kakao_place_observation"."matched_store_id" is not null
      ) or (
        "kakao_place_observation"."match_status" in (
          'UNMATCHED', 'AMBIGUOUS', 'CATEGORY_REJECTED'
        )
        and "kakao_place_observation"."matched_store_id" is null
      )),
	CONSTRAINT "kakao_place_observation_signals_json_valid" CHECK(json_valid("kakao_place_observation"."match_signals_json")),
	CONSTRAINT "kakao_place_observation_seoul_bounds" CHECK("kakao_place_observation"."latitude_e7" between 374000000 and 377500000
        and "kakao_place_observation"."longitude_e7" between 1267000000 and 1273000000),
	CONSTRAINT "kakao_place_observation_retention_positive" CHECK("kakao_place_observation"."expires_at_ms" > "kakao_place_observation"."observed_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kakao_place_observation_run_key_unique` ON `kakao_place_observation` (`run_id`,`observation_key`);--> statement-breakpoint
CREATE INDEX `kakao_place_observation_match_idx` ON `kakao_place_observation` (`run_id`,`match_status`);--> statement-breakpoint
CREATE INDEX `kakao_place_observation_store_idx` ON `kakao_place_observation` (`matched_store_id`);--> statement-breakpoint
CREATE TABLE `raw_review_ciphertext` (
	`review_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`store_id` text NOT NULL,
	`provider` text NOT NULL,
	`ciphertext` blob NOT NULL,
	`nonce` blob NOT NULL,
	`auth_tag` blob NOT NULL,
	`key_version` text NOT NULL,
	`aad_version` text NOT NULL,
	`fingerprint` blob NOT NULL,
	`collected_at_ms` integer NOT NULL,
	`retention_until_ms` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `review_collection_run`(`run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `kakao_place_observation`(`observation_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "raw_review_provider_allowed" CHECK("raw_review_ciphertext"."provider" = 'KAKAO_MAP'),
	CONSTRAINT "raw_review_ciphertext_nonempty" CHECK(length("raw_review_ciphertext"."ciphertext") > 0),
	CONSTRAINT "raw_review_nonce_length" CHECK(length("raw_review_ciphertext"."nonce") = 12),
	CONSTRAINT "raw_review_auth_tag_length" CHECK(length("raw_review_ciphertext"."auth_tag") = 16),
	CONSTRAINT "raw_review_fingerprint_length" CHECK(length("raw_review_ciphertext"."fingerprint") = 32),
	CONSTRAINT "raw_review_retention_positive" CHECK("raw_review_ciphertext"."retention_until_ms" > "raw_review_ciphertext"."collected_at_ms"),
	CONSTRAINT "raw_review_retention_max" CHECK("raw_review_ciphertext"."retention_until_ms"
        <= "raw_review_ciphertext"."collected_at_ms" + 2592000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_review_store_provider_fingerprint_unique` ON `raw_review_ciphertext` (`store_id`,`provider`,`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `raw_review_key_nonce_unique` ON `raw_review_ciphertext` (`key_version`,`nonce`);--> statement-breakpoint
CREATE INDEX `raw_review_run_store_idx` ON `raw_review_ciphertext` (`run_id`,`store_id`);--> statement-breakpoint
CREATE INDEX `raw_review_retention_idx` ON `raw_review_ciphertext` (`retention_until_ms`);--> statement-breakpoint
CREATE TABLE `deidentification_failure` (
	`failure_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`store_id` text NOT NULL,
	`reason_code` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `review_collection_run`(`run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `kakao_place_observation`(`observation_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "deidentification_failure_retention_positive" CHECK("deidentification_failure"."expires_at_ms" > "deidentification_failure"."occurred_at_ms")
);
--> statement-breakpoint
CREATE INDEX `deidentification_failure_run_store_idx` ON `deidentification_failure` (`run_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `raw_delete_audit` (
	`delete_run_id` text PRIMARY KEY NOT NULL,
	`cutoff_at_ms` integer NOT NULL,
	`attempted_count` integer NOT NULL,
	`deleted_count` integer NOT NULL,
	`failed_count` integer NOT NULL,
	`status` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`finished_at_ms` integer,
	`expires_at_ms` integer NOT NULL,
	CONSTRAINT "raw_delete_audit_status_allowed" CHECK("raw_delete_audit"."status" in ('RUNNING', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "raw_delete_audit_counts_valid" CHECK("raw_delete_audit"."attempted_count" >= 0
        and "raw_delete_audit"."deleted_count" >= 0
        and "raw_delete_audit"."failed_count" >= 0
        and "raw_delete_audit"."deleted_count" + "raw_delete_audit"."failed_count"
          <= "raw_delete_audit"."attempted_count"),
	CONSTRAINT "raw_delete_audit_finished_after_start" CHECK("raw_delete_audit"."finished_at_ms" is null
        or "raw_delete_audit"."finished_at_ms" >= "raw_delete_audit"."started_at_ms"),
	CONSTRAINT "raw_delete_audit_retention_positive" CHECK("raw_delete_audit"."expires_at_ms" > "raw_delete_audit"."started_at_ms")
);
--> statement-breakpoint
CREATE INDEX `raw_delete_audit_status_started_idx` ON `raw_delete_audit` (`status`,`started_at_ms`);--> statement-breakpoint
CREATE TABLE `review_checkpoint` (
	`checkpoint_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`store_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`page_cursor` text,
	`last_fingerprint` blob,
	`state` text NOT NULL,
	`committed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `review_collection_run`(`run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `kakao_place_observation`(`observation_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_checkpoint_page_nonnegative" CHECK("review_checkpoint"."page_number" >= 0),
	CONSTRAINT "review_checkpoint_fingerprint_length" CHECK("review_checkpoint"."last_fingerprint" is null
        or length("review_checkpoint"."last_fingerprint") = 32),
	CONSTRAINT "review_checkpoint_state_allowed" CHECK("review_checkpoint"."state" in (
        'PENDING', 'RUNNING', 'COMPLETE', 'NO_REVIEWS',
        'FAILED_STORE', 'STOPPED_PROVIDER'
      )),
	CONSTRAINT "review_checkpoint_retention_positive" CHECK("review_checkpoint"."expires_at_ms" > "review_checkpoint"."committed_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_checkpoint_run_store_page_unique` ON `review_checkpoint` (`run_id`,`store_id`,`page_number`);--> statement-breakpoint
CREATE INDEX `review_checkpoint_run_state_idx` ON `review_checkpoint` (`run_id`,`state`);--> statement-breakpoint
CREATE TABLE `review_collection_run` (
	`run_id` text PRIMARY KEY NOT NULL,
	`discovery_run_id` text NOT NULL,
	`catalog_snapshot_id` text NOT NULL,
	`policy_snapshot_id` text NOT NULL,
	`selector_contract_version` text NOT NULL,
	`status` text NOT NULL,
	`active_slot` integer,
	`store_count` integer NOT NULL,
	`collected_count` integer NOT NULL,
	`duplicate_count` integer NOT NULL,
	`rejected_pii_count` integer NOT NULL,
	`failed_store_count` integer NOT NULL,
	`started_at_ms` integer NOT NULL,
	`finished_at_ms` integer,
	`expires_at_ms` integer NOT NULL,
	FOREIGN KEY (`discovery_run_id`) REFERENCES `kakao_discovery_run`(`run_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_collection_status_allowed" CHECK("review_collection_run"."status" in (
        'READY', 'RUNNING', 'PAUSED', 'SUCCEEDED',
        'STOPPED_POLICY', 'STOPPED_ACCESS', 'FAILED_FINAL'
      )),
	CONSTRAINT "review_collection_active_slot_allowed" CHECK("review_collection_run"."active_slot" is null or "review_collection_run"."active_slot" = 1),
	CONSTRAINT "review_collection_counts_nonnegative" CHECK("review_collection_run"."store_count" >= 0
        and "review_collection_run"."collected_count" >= 0
        and "review_collection_run"."duplicate_count" >= 0
        and "review_collection_run"."rejected_pii_count" >= 0
        and "review_collection_run"."failed_store_count" >= 0),
	CONSTRAINT "review_collection_finished_after_start" CHECK("review_collection_run"."finished_at_ms" is null
        or "review_collection_run"."finished_at_ms" >= "review_collection_run"."started_at_ms"),
	CONSTRAINT "review_collection_retention_positive" CHECK("review_collection_run"."expires_at_ms" > "review_collection_run"."started_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_collection_active_slot_unique` ON `review_collection_run` (`active_slot`);--> statement-breakpoint
CREATE INDEX `review_collection_discovery_idx` ON `review_collection_run` (`discovery_run_id`);--> statement-breakpoint
CREATE INDEX `review_collection_status_started_idx` ON `review_collection_run` (`status`,`started_at_ms`);
