CREATE TABLE `review_seen_fingerprint` (
	`seen_id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`provider` text NOT NULL,
	`fingerprint_key_version` text NOT NULL,
	`fingerprint` blob NOT NULL,
	`published_date` text NOT NULL,
	`first_seen_at_ms` integer NOT NULL,
	`last_seen_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	CONSTRAINT "review_seen_provider_allowed" CHECK("review_seen_fingerprint"."provider" = 'KAKAO_MAP'),
	CONSTRAINT "review_seen_fingerprint_length" CHECK(length("review_seen_fingerprint"."fingerprint") = 32),
	CONSTRAINT "review_seen_date_format" CHECK("review_seen_fingerprint"."published_date" glob
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "review_seen_times_ordered" CHECK("review_seen_fingerprint"."first_seen_at_ms" <= "review_seen_fingerprint"."last_seen_at_ms"
        and "review_seen_fingerprint"."last_seen_at_ms" < "review_seen_fingerprint"."expires_at_ms"),
	CONSTRAINT "review_seen_retention_max" CHECK("review_seen_fingerprint"."expires_at_ms"
        <= "review_seen_fingerprint"."last_seen_at_ms" + 34560000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_seen_store_provider_key_fingerprint_unique` ON `review_seen_fingerprint` (`store_id`,`provider`,`fingerprint_key_version`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `review_seen_expiry_idx` ON `review_seen_fingerprint` (`expires_at_ms`);--> statement-breakpoint
CREATE TABLE `review_store_sync_state` (
	`sync_state_id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`provider` text NOT NULL,
	`anchor_fingerprint` blob,
	`anchor_fingerprint_key_version` text,
	`anchor_published_date` text,
	`last_successful_mode` text NOT NULL,
	`last_successful_run_id` text NOT NULL,
	`last_successful_as_of_date` text NOT NULL,
	`completed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	CONSTRAINT "review_store_sync_provider_allowed" CHECK("review_store_sync_state"."provider" = 'KAKAO_MAP'),
	CONSTRAINT "review_store_sync_mode_allowed" CHECK("review_store_sync_state"."last_successful_mode" in (
        'INITIAL_BACKFILL', 'INCREMENTAL', 'BACKFILL_FALLBACK'
      )),
	CONSTRAINT "review_store_sync_as_of_date_format" CHECK("review_store_sync_state"."last_successful_as_of_date" glob
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "review_store_sync_anchor_complete" CHECK((
        "review_store_sync_state"."anchor_fingerprint" is null
        and "review_store_sync_state"."anchor_fingerprint_key_version" is null
        and "review_store_sync_state"."anchor_published_date" is null
      ) or (
        "review_store_sync_state"."anchor_fingerprint" is not null
        and "review_store_sync_state"."anchor_fingerprint_key_version" is not null
        and "review_store_sync_state"."anchor_published_date" is not null
      )),
	CONSTRAINT "review_store_sync_anchor_fingerprint_length" CHECK("review_store_sync_state"."anchor_fingerprint" is null
        or length("review_store_sync_state"."anchor_fingerprint") = 32),
	CONSTRAINT "review_store_sync_anchor_date_format" CHECK("review_store_sync_state"."anchor_published_date" is null
        or "review_store_sync_state"."anchor_published_date" glob
          '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "review_store_sync_retention_positive" CHECK("review_store_sync_state"."completed_at_ms" < "review_store_sync_state"."expires_at_ms"),
	CONSTRAINT "review_store_sync_retention_max" CHECK("review_store_sync_state"."expires_at_ms"
        <= "review_store_sync_state"."completed_at_ms" + 34560000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_store_sync_store_provider_unique` ON `review_store_sync_state` (`store_id`,`provider`);--> statement-breakpoint
CREATE INDEX `review_store_sync_expiry_idx` ON `review_store_sync_state` (`expires_at_ms`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_review_collection_run` (
	`run_id` text PRIMARY KEY NOT NULL,
	`discovery_run_id` text NOT NULL,
	`catalog_snapshot_id` text NOT NULL,
	`policy_snapshot_id` text NOT NULL,
	`selector_contract_version` text NOT NULL,
	`as_of_date` text NOT NULL,
	`fingerprint_key_version` text NOT NULL,
	`run_budget_ms` integer NOT NULL,
	`status` text NOT NULL,
	`active_slot` integer,
	`store_count` integer NOT NULL,
	`initial_backfill_store_count` integer NOT NULL,
	`incremental_store_count` integer NOT NULL,
	`backfill_fallback_store_count` integer NOT NULL,
	`collected_count` integer NOT NULL,
	`duplicate_count` integer NOT NULL,
	`rejected_pii_count` integer NOT NULL,
	`failed_store_count` integer NOT NULL,
	`started_at_ms` integer NOT NULL,
	`finished_at_ms` integer,
	`expires_at_ms` integer NOT NULL,
	FOREIGN KEY (`discovery_run_id`) REFERENCES `kakao_discovery_run`(`run_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_collection_status_allowed" CHECK("__new_review_collection_run"."status" in (
        'READY', 'RUNNING', 'PAUSED_OPERATOR', 'PAUSED_BUDGET',
        'SUCCEEDED', 'PARTIAL',
        'STOPPED_POLICY', 'STOPPED_ACCESS', 'FAILED_FINAL'
      )),
	CONSTRAINT "review_collection_active_slot_allowed" CHECK("__new_review_collection_run"."active_slot" is null or "__new_review_collection_run"."active_slot" = 1),
	CONSTRAINT "review_collection_as_of_date_format" CHECK("__new_review_collection_run"."as_of_date" glob
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "review_collection_budget_allowed" CHECK("__new_review_collection_run"."run_budget_ms" between 1 and 28800000),
	CONSTRAINT "review_collection_counts_nonnegative" CHECK("__new_review_collection_run"."store_count" >= 0
        and "__new_review_collection_run"."initial_backfill_store_count" >= 0
        and "__new_review_collection_run"."incremental_store_count" >= 0
        and "__new_review_collection_run"."backfill_fallback_store_count" >= 0
        and "__new_review_collection_run"."collected_count" >= 0
        and "__new_review_collection_run"."duplicate_count" >= 0
        and "__new_review_collection_run"."rejected_pii_count" >= 0
        and "__new_review_collection_run"."failed_store_count" >= 0),
	CONSTRAINT "review_collection_mode_counts_match_store_count" CHECK("__new_review_collection_run"."initial_backfill_store_count"
          + "__new_review_collection_run"."incremental_store_count"
          + "__new_review_collection_run"."backfill_fallback_store_count"
        = "__new_review_collection_run"."store_count"),
	CONSTRAINT "review_collection_finished_after_start" CHECK("__new_review_collection_run"."finished_at_ms" is null
        or "__new_review_collection_run"."finished_at_ms" >= "__new_review_collection_run"."started_at_ms"),
	CONSTRAINT "review_collection_retention_positive" CHECK("__new_review_collection_run"."expires_at_ms" > "__new_review_collection_run"."started_at_ms")
);
--> statement-breakpoint
INSERT INTO `__new_review_collection_run`("run_id", "discovery_run_id", "catalog_snapshot_id", "policy_snapshot_id", "selector_contract_version", "as_of_date", "fingerprint_key_version", "run_budget_ms", "status", "active_slot", "store_count", "initial_backfill_store_count", "incremental_store_count", "backfill_fallback_store_count", "collected_count", "duplicate_count", "rejected_pii_count", "failed_store_count", "started_at_ms", "finished_at_ms", "expires_at_ms") SELECT "run_id", "discovery_run_id", "catalog_snapshot_id", "policy_snapshot_id", "selector_contract_version", '1970-01-01', 'legacy-feature4', 3600000, CASE WHEN "status" = 'PAUSED' THEN 'PAUSED_OPERATOR' ELSE "status" END, "active_slot", "store_count", "store_count", 0, 0, "collected_count", "duplicate_count", "rejected_pii_count", "failed_store_count", "started_at_ms", "finished_at_ms", "expires_at_ms" FROM `review_collection_run`;--> statement-breakpoint
DROP TABLE `review_collection_run`;--> statement-breakpoint
ALTER TABLE `__new_review_collection_run` RENAME TO `review_collection_run`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `review_collection_active_slot_unique` ON `review_collection_run` (`active_slot`);--> statement-breakpoint
CREATE INDEX `review_collection_discovery_idx` ON `review_collection_run` (`discovery_run_id`);--> statement-breakpoint
CREATE INDEX `review_collection_status_started_idx` ON `review_collection_run` (`status`,`started_at_ms`);--> statement-breakpoint
DROP INDEX `raw_review_store_provider_fingerprint_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `raw_review_store_provider_key_fingerprint_unique` ON `raw_review_ciphertext` (`store_id`,`provider`,`key_version`,`fingerprint`);
