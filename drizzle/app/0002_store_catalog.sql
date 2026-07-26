CREATE TABLE `bakery` (
	`bakery_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`catalog_status` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "bakery_catalog_status_allowed" CHECK("bakery"."catalog_status" in ('candidate', 'published', 'excluded', 'admin_review'))
);
--> statement-breakpoint
CREATE INDEX `bakery_normalized_name_idx` ON `bakery` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `bakery_catalog_status_idx` ON `bakery` (`catalog_status`);--> statement-breakpoint
CREATE TABLE `data_publish` (
	`publish_id` text PRIMARY KEY NOT NULL,
	`input_snapshot_id` text NOT NULL,
	`normalization_version` text NOT NULL,
	`matcher_version` text NOT NULL,
	`eligibility_version` text NOT NULL,
	`status` text NOT NULL,
	`candidate_count` integer NOT NULL,
	`published_count` integer NOT NULL,
	`excluded_count` integer NOT NULL,
	`admin_review_count` integer NOT NULL,
	`published_at_ms` integer NOT NULL,
	FOREIGN KEY (`input_snapshot_id`) REFERENCES `source_snapshot`(`snapshot_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "data_publish_status_allowed" CHECK("data_publish"."status" in ('SUCCEEDED', 'BLOCKED_QUALITY', 'SUPERSEDED')),
	CONSTRAINT "data_publish_counts_nonnegative" CHECK("data_publish"."candidate_count" >= 0
        and "data_publish"."published_count" >= 0
        and "data_publish"."excluded_count" >= 0
        and "data_publish"."admin_review_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_publish_snapshot_versions_unique` ON `data_publish` (`input_snapshot_id`,`normalization_version`,`matcher_version`,`eligibility_version`);--> statement-breakpoint
CREATE INDEX `data_publish_status_time_idx` ON `data_publish` (`status`,`published_at_ms`);--> statement-breakpoint
CREATE TABLE `eligibility_decision` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`decision_group_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`bakery_id` text NOT NULL,
	`store_id` text NOT NULL,
	`classification` text NOT NULL,
	`status` text NOT NULL,
	`reasons_json` text NOT NULL,
	`rule_version` text NOT NULL,
	`decided_at_ms` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `source_snapshot`(`snapshot_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bakery_id`) REFERENCES `bakery`(`bakery_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "eligibility_decision_classification_allowed" CHECK("eligibility_decision"."classification" in (
        'INDEPENDENT_SINGLE',
        'DIRECT_ONLY_SMALL_CHAIN',
        'FRANCHISE',
        'CHAIN_TOO_LARGE',
        'UNCERTAIN_REVIEW_REQUIRED'
      )),
	CONSTRAINT "eligibility_decision_status_allowed" CHECK("eligibility_decision"."status" in ('eligible', 'excluded', 'admin_review')),
	CONSTRAINT "eligibility_decision_reasons_json_valid" CHECK(json_valid("eligibility_decision"."reasons_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eligibility_decision_store_rule_unique` ON `eligibility_decision` (`snapshot_id`,`store_id`,`rule_version`);--> statement-breakpoint
CREATE INDEX `eligibility_decision_bakery_status_idx` ON `eligibility_decision` (`bakery_id`,`status`);--> statement-breakpoint
CREATE TABLE `manual_review` (
	`manual_review_id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`review_type` text NOT NULL,
	`status` text NOT NULL,
	`decision` text,
	`evidence_refs_json` text NOT NULL,
	`review_version` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`decided_at_ms` integer,
	FOREIGN KEY (`snapshot_id`) REFERENCES `source_snapshot`(`snapshot_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "manual_review_target_type_allowed" CHECK("manual_review"."target_type" in ('store', 'bakery', 'match')),
	CONSTRAINT "manual_review_type_allowed" CHECK("manual_review"."review_type" in ('normalization', 'duplicate', 'eligibility')),
	CONSTRAINT "manual_review_status_allowed" CHECK("manual_review"."status" in ('open', 'approved', 'rejected')),
	CONSTRAINT "manual_review_evidence_json_valid" CHECK(json_valid("manual_review"."evidence_refs_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_review_target_type_version_unique` ON `manual_review` (`snapshot_id`,`target_type`,`target_id`,`review_type`,`review_version`);--> statement-breakpoint
CREATE INDEX `manual_review_status_created_idx` ON `manual_review` (`status`,`created_at_ms`);--> statement-breakpoint
CREATE TABLE `match_candidate` (
	`match_id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`left_candidate_id` text NOT NULL,
	`right_candidate_id` text NOT NULL,
	`left_source_record_id` text NOT NULL,
	`right_source_record_id` text NOT NULL,
	`score_basis_points` integer NOT NULL,
	`signals_json` text NOT NULL,
	`matcher_version` text NOT NULL,
	`status` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `source_snapshot`(`snapshot_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`left_source_record_id`) REFERENCES `localdata_bakery_record`(`record_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`right_source_record_id`) REFERENCES `localdata_bakery_record`(`record_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "match_candidate_ordered_pair" CHECK("match_candidate"."left_candidate_id" < "match_candidate"."right_candidate_id"),
	CONSTRAINT "match_candidate_score_range" CHECK("match_candidate"."score_basis_points" between 0 and 10000),
	CONSTRAINT "match_candidate_status_allowed" CHECK("match_candidate"."status" in ('auto_merge', 'admin_review', 'separate')),
	CONSTRAINT "match_candidate_signals_json_valid" CHECK(json_valid("match_candidate"."signals_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_candidate_pair_version_unique` ON `match_candidate` (`snapshot_id`,`left_candidate_id`,`right_candidate_id`,`matcher_version`);--> statement-breakpoint
CREATE INDEX `match_candidate_status_score_idx` ON `match_candidate` (`status`,`score_basis_points`);--> statement-breakpoint
CREATE TABLE `store_source_link` (
	`link_id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`source_record_id` text NOT NULL,
	`source_row_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`source_type` text NOT NULL,
	`linked_at_ms` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_record_id`) REFERENCES `localdata_bakery_record`(`record_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_row_id`) REFERENCES `source_snapshot_row`(`source_row_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`snapshot_id`) REFERENCES `source_snapshot`(`snapshot_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "store_source_link_type_allowed" CHECK("store_source_link"."source_type" = 'LOCALDATA')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_source_link_source_record_unique` ON `store_source_link` (`source_record_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_source_link_source_row_unique` ON `store_source_link` (`source_row_id`);--> statement-breakpoint
CREATE INDEX `store_source_link_store_idx` ON `store_source_link` (`store_id`);--> statement-breakpoint
CREATE TABLE `store` (
	`store_id` text PRIMARY KEY NOT NULL,
	`bakery_id` text NOT NULL,
	`display_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`normalized_brand_name` text NOT NULL,
	`normalized_address` text NOT NULL,
	`seoul_district` text NOT NULL,
	`normalized_phone` text,
	`latitude_e7` integer,
	`longitude_e7` integer,
	`business_status` text NOT NULL,
	`catalog_status` text NOT NULL,
	`latest_verified_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`bakery_id`) REFERENCES `bakery`(`bakery_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "store_business_status_allowed" CHECK("store"."business_status" in ('active', 'inactive', 'unknown')),
	CONSTRAINT "store_catalog_status_allowed" CHECK("store"."catalog_status" in ('candidate', 'published', 'excluded', 'admin_review')),
	CONSTRAINT "store_coordinate_pair_complete" CHECK(("store"."latitude_e7" is null and "store"."longitude_e7" is null)
        or ("store"."latitude_e7" is not null and "store"."longitude_e7" is not null)),
	CONSTRAINT "store_coordinate_seoul_bounds" CHECK("store"."latitude_e7" is null
        or (
          "store"."latitude_e7" between 374000000 and 377500000
          and "store"."longitude_e7" between 1267000000 and 1273000000
        )),
	CONSTRAINT "store_published_requirements" CHECK("store"."catalog_status" != 'published'
        or (
          "store"."business_status" = 'active'
          and "store"."latitude_e7" is not null
          and "store"."longitude_e7" is not null
        ))
);
--> statement-breakpoint
CREATE INDEX `store_bakery_idx` ON `store` (`bakery_id`);--> statement-breakpoint
CREATE INDEX `store_catalog_status_idx` ON `store` (`catalog_status`);--> statement-breakpoint
CREATE INDEX `store_seoul_status_name_idx` ON `store` (`seoul_district`,`catalog_status`,`normalized_name`);