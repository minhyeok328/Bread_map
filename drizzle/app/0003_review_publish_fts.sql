CREATE TABLE `fts_index_state` (
	`state_id` text PRIMARY KEY NOT NULL,
	`index_version` text NOT NULL,
	`publish_version_id` text NOT NULL,
	`status` text NOT NULL,
	`active_slot` integer,
	`document_count` integer NOT NULL,
	`corpus_checksum` text NOT NULL,
	`built_at_ms` integer NOT NULL,
	FOREIGN KEY (`publish_version_id`) REFERENCES `review_publish_version`(`version_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "fts_index_version_allowed" CHECK("fts_index_state"."index_version" = 'review-fts-unicode61-v1'),
	CONSTRAINT "fts_index_status_allowed" CHECK("fts_index_state"."status" in ('ACTIVE', 'SUPERSEDED')),
	CONSTRAINT "fts_index_active_slot_allowed" CHECK("fts_index_state"."active_slot" is null or "fts_index_state"."active_slot" = 1),
	CONSTRAINT "fts_index_document_count_nonnegative" CHECK("fts_index_state"."document_count" >= 0),
	CONSTRAINT "fts_index_checksum_valid" CHECK(length("fts_index_state"."corpus_checksum") = 64
    and "fts_index_state"."corpus_checksum" = lower("fts_index_state"."corpus_checksum")
    and "fts_index_state"."corpus_checksum" not glob '*[^0-9a-f]*'),
	CONSTRAINT "fts_index_time_nonnegative" CHECK("fts_index_state"."built_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fts_index_publish_version_unique` ON `fts_index_state` (`publish_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fts_index_active_slot_unique` ON `fts_index_state` (`active_slot`);--> statement-breakpoint
CREATE INDEX `fts_index_status_time_idx` ON `fts_index_state` (`status`,`built_at_ms`);--> statement-breakpoint
CREATE TABLE `review_document` (
	`review_id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`provider` text NOT NULL,
	`body` text NOT NULL,
	`normalized_body` text NOT NULL,
	`rating_basis_points` integer,
	`published_date` text NOT NULL,
	`collected_at_ms` integer NOT NULL,
	`source_run_id` text NOT NULL,
	`publish_version_id` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`publish_version_id`) REFERENCES `review_publish_version`(`version_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_document_provider_allowed" CHECK("review_document"."provider" = 'KAKAO_MAP'),
	CONSTRAINT "review_document_body_nonempty" CHECK(length(trim("review_document"."body")) > 0),
	CONSTRAINT "review_document_normalized_body_nonempty" CHECK(length(trim("review_document"."normalized_body")) > 0),
	CONSTRAINT "review_document_rating_range" CHECK("review_document"."rating_basis_points" is null
        or "review_document"."rating_basis_points" between 0 and 5000),
	CONSTRAINT "review_document_published_date_format" CHECK("review_document"."published_date" glob
    '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "review_document_collected_time_nonnegative" CHECK("review_document"."collected_at_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX `review_document_store_date_idx` ON `review_document` (`store_id`,`published_date`,`review_id`);--> statement-breakpoint
CREATE INDEX `review_document_publish_version_idx` ON `review_document` (`publish_version_id`);--> statement-breakpoint
CREATE INDEX `review_document_source_run_idx` ON `review_document` (`source_run_id`);--> statement-breakpoint
CREATE TABLE `review_publish_version` (
	`version_id` text PRIMARY KEY NOT NULL,
	`source_run_id` text NOT NULL,
	`source_run_status` text NOT NULL,
	`source_as_of_date` text NOT NULL,
	`status` text NOT NULL,
	`active_slot` integer,
	`document_count` integer NOT NULL,
	`fts_document_count` integer NOT NULL,
	`corpus_checksum` text NOT NULL,
	`published_at_ms` integer NOT NULL,
	CONSTRAINT "review_publish_source_status_allowed" CHECK("review_publish_version"."source_run_status" in ('SUCCEEDED', 'PARTIAL')),
	CONSTRAINT "review_publish_status_allowed" CHECK("review_publish_version"."status" in ('BUILDING', 'ACTIVE', 'SUPERSEDED')),
	CONSTRAINT "review_publish_active_slot_allowed" CHECK("review_publish_version"."active_slot" is null or "review_publish_version"."active_slot" = 1),
	CONSTRAINT "review_publish_source_date_format" CHECK("review_publish_version"."source_as_of_date" glob
    '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "review_publish_counts_valid" CHECK("review_publish_version"."document_count" >= 0
        and "review_publish_version"."fts_document_count" >= 0
        and "review_publish_version"."document_count" = "review_publish_version"."fts_document_count"),
	CONSTRAINT "review_publish_checksum_valid" CHECK(length("review_publish_version"."corpus_checksum") = 64
    and "review_publish_version"."corpus_checksum" = lower("review_publish_version"."corpus_checksum")
    and "review_publish_version"."corpus_checksum" not glob '*[^0-9a-f]*'),
	CONSTRAINT "review_publish_time_nonnegative" CHECK("review_publish_version"."published_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_publish_source_run_unique` ON `review_publish_version` (`source_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_publish_active_slot_unique` ON `review_publish_version` (`active_slot`);--> statement-breakpoint
CREATE INDEX `review_publish_status_time_idx` ON `review_publish_version` (`status`,`published_at_ms`);--> statement-breakpoint
CREATE VIRTUAL TABLE `review_fts` USING fts5(
	`review_id` UNINDEXED,
	`store_id` UNINDEXED,
	`normalized_body`,
	tokenize = 'unicode61 remove_diacritics 2'
);--> statement-breakpoint
CREATE TRIGGER `review_document_public_store_insert`
BEFORE INSERT ON `review_document`
WHEN NOT EXISTS (
	SELECT 1
	FROM `store`
	WHERE `store_id` = new.`store_id`
	  AND `catalog_status` = 'published'
	  AND `business_status` = 'active'
)
BEGIN
	SELECT RAISE(ABORT, 'review_document requires a published store');
END;--> statement-breakpoint
CREATE TRIGGER `review_document_public_store_update`
BEFORE UPDATE OF `store_id` ON `review_document`
WHEN NOT EXISTS (
	SELECT 1
	FROM `store`
	WHERE `store_id` = new.`store_id`
	  AND `catalog_status` = 'published'
	  AND `business_status` = 'active'
)
BEGIN
	SELECT RAISE(ABORT, 'review_document requires a published store');
END;--> statement-breakpoint
CREATE TRIGGER `review_document_fts_insert`
AFTER INSERT ON `review_document`
BEGIN
	INSERT INTO `review_fts`(
		rowid, review_id, store_id, normalized_body
	) VALUES (
		new.rowid, new.review_id, new.store_id, new.normalized_body
	);
END;--> statement-breakpoint
CREATE TRIGGER `review_document_fts_update`
AFTER UPDATE OF `review_id`, `store_id`, `normalized_body`
ON `review_document`
BEGIN
	DELETE FROM `review_fts` WHERE rowid = old.rowid;
	INSERT INTO `review_fts`(
		rowid, review_id, store_id, normalized_body
	) VALUES (
		new.rowid, new.review_id, new.store_id, new.normalized_body
	);
END;--> statement-breakpoint
CREATE TRIGGER `review_document_fts_delete`
AFTER DELETE ON `review_document`
BEGIN
	DELETE FROM `review_fts` WHERE rowid = old.rowid;
END;--> statement-breakpoint
CREATE TRIGGER `store_unpublish_reviews`
AFTER UPDATE OF `catalog_status`, `business_status` ON `store`
WHEN new.`catalog_status` != 'published'
  OR new.`business_status` != 'active'
BEGIN
	DELETE FROM `review_document`
	WHERE `store_id` = new.`store_id`;
END;
