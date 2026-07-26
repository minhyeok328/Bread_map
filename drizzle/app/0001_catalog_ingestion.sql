CREATE TABLE `data_quality_issue` (
	`issue_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`source_row_id` text NOT NULL,
	`rule_code` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`redacted_details_json` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ingestion_run`(`run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_row_id`) REFERENCES `source_snapshot_row`(`source_row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "data_quality_issue_severity_allowed" CHECK("data_quality_issue"."severity" = 'REJECTED'),
	CONSTRAINT "data_quality_issue_status_allowed" CHECK("data_quality_issue"."status" = 'OPEN')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_quality_issue_run_row_rule_unique` ON `data_quality_issue` (`run_id`,`source_row_id`,`rule_code`);--> statement-breakpoint
CREATE INDEX `data_quality_issue_status_severity_idx` ON `data_quality_issue` (`status`,`severity`);--> statement-breakpoint
CREATE TABLE `ingestion_run` (
	`run_id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`adapter_version` text NOT NULL,
	`status` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`finished_at_ms` integer,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`read_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`rejected_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `source_catalog`(`source_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`snapshot_id`) REFERENCES `source_snapshot`(`snapshot_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ingestion_run_status_allowed" CHECK("ingestion_run"."status" in ('RUNNING', 'SUCCEEDED', 'FAILED_FINAL')),
	CONSTRAINT "ingestion_run_counts_nonnegative" CHECK("ingestion_run"."attempt_count" > 0
        and "ingestion_run"."page_count" >= 0
        and "ingestion_run"."read_count" >= 0
        and "ingestion_run"."inserted_count" >= 0
        and "ingestion_run"."updated_count" >= 0
        and "ingestion_run"."rejected_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingestion_run_source_snapshot_adapter_unique` ON `ingestion_run` (`source_id`,`snapshot_id`,`adapter_version`);--> statement-breakpoint
CREATE INDEX `ingestion_run_source_started_idx` ON `ingestion_run` (`source_id`,`started_at_ms`);--> statement-breakpoint
CREATE TABLE `localdata_bakery_record` (
	`record_id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`source_row_id` text NOT NULL,
	`mng_no` text NOT NULL,
	`open_authority_group_code` text NOT NULL,
	`permit_date` text,
	`business_status_code` text NOT NULL,
	`business_status_name` text NOT NULL,
	`detailed_business_status_code` text,
	`detailed_business_status_name` text,
	`closed_date` text,
	`business_name` text NOT NULL,
	`road_name_address` text,
	`lot_number_address` text,
	`source_coordinate_x` text,
	`source_coordinate_y` text,
	`data_updated_at_ms` integer,
	`last_modified_at_ms` integer,
	`staged_at_ms` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `source_snapshot`(`snapshot_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_row_id`) REFERENCES `source_snapshot_row`(`source_row_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `localdata_bakery_record_source_row_unique` ON `localdata_bakery_record` (`source_row_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `localdata_bakery_record_snapshot_mng_unique` ON `localdata_bakery_record` (`snapshot_id`,`mng_no`);--> statement-breakpoint
CREATE INDEX `localdata_bakery_record_status_idx` ON `localdata_bakery_record` (`business_status_code`);--> statement-breakpoint
CREATE TABLE `source_catalog` (
	`source_id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`official_url` text NOT NULL,
	`required_fields_json` text NOT NULL,
	`terms_checked_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_catalog_source_key_unique` ON `source_catalog` (`source_key`);--> statement-breakpoint
CREATE TABLE `source_checkpoint` (
	`checkpoint_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`page_no` integer NOT NULL,
	`last_committed_key` text,
	`state` text NOT NULL,
	`read_count` integer NOT NULL,
	`inserted_count` integer NOT NULL,
	`updated_count` integer NOT NULL,
	`rejected_count` integer NOT NULL,
	`committed_at_ms` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ingestion_run`(`run_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_checkpoint_state_allowed" CHECK("source_checkpoint"."state" = 'COMMITTED'),
	CONSTRAINT "source_checkpoint_counts_nonnegative" CHECK("source_checkpoint"."page_no" > 0
        and "source_checkpoint"."read_count" >= 0
        and "source_checkpoint"."inserted_count" >= 0
        and "source_checkpoint"."updated_count" >= 0
        and "source_checkpoint"."rejected_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_checkpoint_run_page_unique` ON `source_checkpoint` (`run_id`,`page_no`);--> statement-breakpoint
CREATE TABLE `source_snapshot_row` (
	`source_row_id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`page_no` integer NOT NULL,
	`row_index` integer NOT NULL,
	`source_row_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`payload_sha256` blob NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `source_snapshot`(`snapshot_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_snapshot_row_page_positive" CHECK("source_snapshot_row"."page_no" > 0),
	CONSTRAINT "source_snapshot_row_index_nonnegative" CHECK("source_snapshot_row"."row_index" >= 0),
	CONSTRAINT "source_snapshot_row_sha256_length" CHECK(length("source_snapshot_row"."payload_sha256") = 32)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshot_row_snapshot_position_unique` ON `source_snapshot_row` (`snapshot_id`,`page_no`,`row_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshot_row_snapshot_key_unique` ON `source_snapshot_row` (`snapshot_id`,`source_row_key`);--> statement-breakpoint
CREATE TABLE `source_snapshot` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`sha256` blob NOT NULL,
	`byte_size` integer NOT NULL,
	`basis_date` text NOT NULL,
	`downloaded_at_ms` integer NOT NULL,
	`adapter_version` text NOT NULL,
	`local_path_hint` text,
	FOREIGN KEY (`source_id`) REFERENCES `source_catalog`(`source_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "source_snapshot_sha256_length" CHECK(length("source_snapshot"."sha256") = 32),
	CONSTRAINT "source_snapshot_byte_size_nonnegative" CHECK("source_snapshot"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshot_source_sha256_unique` ON `source_snapshot` (`source_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `source_snapshot_source_basis_idx` ON `source_snapshot` (`source_id`,`basis_date`);