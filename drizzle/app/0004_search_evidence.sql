CREATE TABLE `catalog_publish_state` (
	`state_id` text PRIMARY KEY NOT NULL,
	`publish_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`source_basis_date` text NOT NULL,
	`source_downloaded_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`publish_id`,`snapshot_id`) REFERENCES `data_publish`(`publish_id`,`input_snapshot_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "catalog_publish_state_singleton" CHECK("catalog_publish_state"."state_id" = 'active'),
	CONSTRAINT "catalog_publish_state_source_date_format" CHECK("catalog_publish_state"."source_basis_date" glob
          '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        and date("catalog_publish_state"."source_basis_date") is not null),
	CONSTRAINT "catalog_publish_state_download_time_nonnegative" CHECK("catalog_publish_state"."source_downloaded_at_ms" >= 0),
	CONSTRAINT "catalog_publish_state_time_nonnegative" CHECK("catalog_publish_state"."updated_at_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE `menu_alias` (
	`alias_id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`source` text NOT NULL,
	`evidence_ref` text NOT NULL,
	`verified_at_ms` integer NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `menu`(`menu_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "menu_alias_display_nonempty" CHECK(length(trim("menu_alias"."alias")) > 0),
	CONSTRAINT "menu_alias_normalized_nonempty" CHECK(length(trim("menu_alias"."normalized_alias")) > 0),
	CONSTRAINT "source_manual_verified" CHECK("menu_alias"."source" = 'MANUAL_VERIFIED'),
	CONSTRAINT "evidence_ref_nonempty" CHECK(length(trim("menu_alias"."evidence_ref")) > 0),
	CONSTRAINT "verified_at_ms_nonnegative" CHECK("menu_alias"."verified_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_alias_menu_normalized_unique` ON `menu_alias` (`menu_id`,`normalized_alias`);--> statement-breakpoint
CREATE INDEX `menu_alias_normalized_idx` ON `menu_alias` (`normalized_alias`);--> statement-breakpoint
CREATE TABLE `menu` (
	`menu_id` text PRIMARY KEY NOT NULL,
	`evidence_publish_id` text NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`category` text NOT NULL,
	`source` text NOT NULL,
	`evidence_ref` text NOT NULL,
	`verified_at_ms` integer NOT NULL,
	FOREIGN KEY (`evidence_publish_id`) REFERENCES `search_evidence_publish`(`publish_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "menu_name_nonempty" CHECK(length(trim("menu"."name")) > 0),
	CONSTRAINT "menu_normalized_name_nonempty" CHECK(length(trim("menu"."normalized_name")) > 0),
	CONSTRAINT "menu_category_allowed" CHECK("menu"."category" in (
        'FERMENTED_BREAD',
        'PASTRY',
        'SALT_BREAD',
        'BAGUETTE',
        'LOAF_BREAD',
        'SWEET_BREAD',
        'SANDWICH',
        'DESSERT'
      )),
	CONSTRAINT "source_manual_verified" CHECK("menu"."source" = 'MANUAL_VERIFIED'),
	CONSTRAINT "evidence_ref_nonempty" CHECK(length(trim("menu"."evidence_ref")) > 0),
	CONSTRAINT "verified_at_ms_nonnegative" CHECK("menu"."verified_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_store_normalized_name_unique` ON `menu` (`evidence_publish_id`,`store_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `menu_publish_store_category_idx` ON `menu` (`evidence_publish_id`,`store_id`,`category`);--> statement-breakpoint
CREATE TABLE `search_evidence_publish` (
	`publish_id` text PRIMARY KEY NOT NULL,
	`input_catalog_publish_id` text NOT NULL,
	`contract_version` text NOT NULL,
	`status` text NOT NULL,
	`active_slot` integer,
	`menu_count` integer NOT NULL,
	`store_alias_count` integer NOT NULL,
	`menu_alias_count` integer NOT NULL,
	`business_hour_count` integer NOT NULL,
	`corpus_checksum` text NOT NULL,
	`published_at_ms` integer NOT NULL,
	FOREIGN KEY (`input_catalog_publish_id`) REFERENCES `data_publish`(`publish_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "search_evidence_contract_version_allowed" CHECK("search_evidence_publish"."contract_version" = 'search-evidence-v1'),
	CONSTRAINT "search_evidence_status_allowed" CHECK("search_evidence_publish"."status" in ('BUILDING', 'ACTIVE', 'SUPERSEDED')),
	CONSTRAINT "search_evidence_active_state_valid" CHECK((
          "search_evidence_publish"."status" = 'ACTIVE'
          and "search_evidence_publish"."active_slot" = 1
        ) or (
          "search_evidence_publish"."status" = 'SUPERSEDED'
          and "search_evidence_publish"."active_slot" is null
        ) or (
          "search_evidence_publish"."status" = 'BUILDING'
          and "search_evidence_publish"."active_slot" is null
        )),
	CONSTRAINT "search_evidence_counts_nonnegative" CHECK("search_evidence_publish"."menu_count" >= 0
        and "search_evidence_publish"."store_alias_count" >= 0
        and "search_evidence_publish"."menu_alias_count" >= 0
        and "search_evidence_publish"."business_hour_count" >= 0),
	CONSTRAINT "search_evidence_checksum_valid" CHECK(length("search_evidence_publish"."corpus_checksum") = 64
    and "search_evidence_publish"."corpus_checksum" = lower("search_evidence_publish"."corpus_checksum")
    and "search_evidence_publish"."corpus_checksum" not glob '*[^0-9a-f]*'),
	CONSTRAINT "search_evidence_time_nonnegative" CHECK("search_evidence_publish"."published_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_evidence_active_slot_unique` ON `search_evidence_publish` (`active_slot`);--> statement-breakpoint
CREATE INDEX `search_evidence_catalog_status_idx` ON `search_evidence_publish` (`input_catalog_publish_id`,`status`);--> statement-breakpoint
CREATE TABLE `store_alias` (
	`alias_id` text PRIMARY KEY NOT NULL,
	`evidence_publish_id` text NOT NULL,
	`store_id` text NOT NULL,
	`alias_type` text NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`source` text NOT NULL,
	`evidence_ref` text NOT NULL,
	`verified_at_ms` integer NOT NULL,
	FOREIGN KEY (`evidence_publish_id`) REFERENCES `search_evidence_publish`(`publish_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "store_alias_type_allowed" CHECK("store_alias"."alias_type" in ('STORE_NAME', 'REGION')),
	CONSTRAINT "store_alias_display_nonempty" CHECK(length(trim("store_alias"."alias")) > 0),
	CONSTRAINT "store_alias_normalized_nonempty" CHECK(length(trim("store_alias"."normalized_alias")) > 0),
	CONSTRAINT "source_manual_verified" CHECK("store_alias"."source" = 'MANUAL_VERIFIED'),
	CONSTRAINT "evidence_ref_nonempty" CHECK(length(trim("store_alias"."evidence_ref")) > 0),
	CONSTRAINT "verified_at_ms_nonnegative" CHECK("store_alias"."verified_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_alias_scope_normalized_unique` ON `store_alias` (`evidence_publish_id`,`store_id`,`alias_type`,`normalized_alias`);--> statement-breakpoint
CREATE INDEX `store_alias_type_normalized_idx` ON `store_alias` (`evidence_publish_id`,`alias_type`,`normalized_alias`);--> statement-breakpoint
CREATE TABLE `store_business_hour` (
	`interval_id` text PRIMARY KEY NOT NULL,
	`evidence_publish_id` text NOT NULL,
	`store_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`sequence` integer NOT NULL,
	`opens_minute` integer NOT NULL,
	`closes_minute` integer NOT NULL,
	`closes_next_day` integer NOT NULL,
	`source` text NOT NULL,
	`evidence_ref` text NOT NULL,
	`verified_at_ms` integer NOT NULL,
	FOREIGN KEY (`evidence_publish_id`) REFERENCES `search_evidence_publish`(`publish_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "store_business_hour_weekday_range" CHECK("store_business_hour"."weekday" between 0 and 6),
	CONSTRAINT "store_business_hour_sequence_nonnegative" CHECK("store_business_hour"."sequence" >= 0),
	CONSTRAINT "store_business_hour_minute_ranges" CHECK("store_business_hour"."opens_minute" between 0 and 1439
        and "store_business_hour"."closes_minute" between 0 and 1439),
	CONSTRAINT "store_business_hour_next_day_boolean" CHECK("store_business_hour"."closes_next_day" in (0, 1)),
	CONSTRAINT "store_business_hour_interval_direction" CHECK((
          "store_business_hour"."closes_next_day" = 0
          and "store_business_hour"."closes_minute" > "store_business_hour"."opens_minute"
        ) or (
          "store_business_hour"."closes_next_day" = 1
          and "store_business_hour"."closes_minute" <= "store_business_hour"."opens_minute"
        )),
	CONSTRAINT "source_manual_verified" CHECK("store_business_hour"."source" = 'MANUAL_VERIFIED'),
	CONSTRAINT "evidence_ref_nonempty" CHECK(length(trim("store_business_hour"."evidence_ref")) > 0),
	CONSTRAINT "verified_at_ms_nonnegative" CHECK("store_business_hour"."verified_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_business_hour_store_day_sequence_unique` ON `store_business_hour` (`evidence_publish_id`,`store_id`,`weekday`,`sequence`);--> statement-breakpoint
CREATE INDEX `store_business_hour_store_day_idx` ON `store_business_hour` (`evidence_publish_id`,`store_id`,`weekday`);--> statement-breakpoint
CREATE TRIGGER `search_evidence_publish_metadata_immutable`
BEFORE UPDATE OF
	`publish_id`,
	`input_catalog_publish_id`,
	`contract_version`,
	`menu_count`,
	`store_alias_count`,
	`menu_alias_count`,
	`business_hour_count`,
	`corpus_checksum`,
	`published_at_ms`
ON `search_evidence_publish`
BEGIN
	SELECT RAISE(ABORT, 'search evidence metadata is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_publish_delete_immutable`
BEFORE DELETE ON `search_evidence_publish`
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_publish_insert_count_guard`
BEFORE INSERT ON `search_evidence_publish`
WHEN NEW.`status` = 'ACTIVE'
	AND NEW.`active_slot` = 1
	AND (
		NEW.`menu_count` != 0
		OR NEW.`store_alias_count` != 0
		OR NEW.`menu_alias_count` != 0
		OR NEW.`business_hour_count` != 0
	)
BEGIN
	SELECT RAISE(ABORT, 'search evidence counts do not match');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_publish_activation_count_guard`
BEFORE UPDATE OF `status`, `active_slot` ON `search_evidence_publish`
WHEN NEW.`status` = 'ACTIVE'
	AND NEW.`active_slot` = 1
	AND (
		NEW.`menu_count` != (
			SELECT count(*)
			FROM `menu`
			WHERE `evidence_publish_id` = NEW.`publish_id`
		)
		OR NEW.`store_alias_count` != (
			SELECT count(*)
			FROM `store_alias`
			WHERE `evidence_publish_id` = NEW.`publish_id`
		)
		OR NEW.`menu_alias_count` != (
			SELECT count(*)
			FROM `menu_alias` AS `existing_alias`
			JOIN `menu` AS `existing_menu`
				ON `existing_menu`.`menu_id` = `existing_alias`.`menu_id`
			WHERE `existing_menu`.`evidence_publish_id` = NEW.`publish_id`
		)
		OR NEW.`business_hour_count` != (
			SELECT count(*)
			FROM `store_business_hour`
			WHERE `evidence_publish_id` = NEW.`publish_id`
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'search evidence counts do not match');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_menu_count_guard`
BEFORE INSERT ON `menu`
WHEN NOT EXISTS (
	SELECT 1
	FROM `search_evidence_publish`
	WHERE `publish_id` = NEW.`evidence_publish_id`
		AND `status` = 'BUILDING'
		AND `active_slot` IS NULL
)
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_menu_update_immutable`
BEFORE UPDATE ON `menu`
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_menu_delete_immutable`
BEFORE DELETE ON `menu`
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_store_alias_count_guard`
BEFORE INSERT ON `store_alias`
WHEN NOT EXISTS (
	SELECT 1
	FROM `search_evidence_publish`
	WHERE `publish_id` = NEW.`evidence_publish_id`
		AND `status` = 'BUILDING'
		AND `active_slot` IS NULL
)
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_store_alias_update_immutable`
BEFORE UPDATE ON `store_alias`
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_store_alias_delete_immutable`
BEFORE DELETE ON `store_alias`
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_menu_alias_count_guard`
BEFORE INSERT ON `menu_alias`
WHEN NOT EXISTS (
	SELECT 1
	FROM `search_evidence_publish` AS `publish`
	JOIN `menu` AS `parent_menu`
		ON `parent_menu`.`evidence_publish_id` = `publish`.`publish_id`
	WHERE `parent_menu`.`menu_id` = NEW.`menu_id`
		AND `publish`.`status` = 'BUILDING'
		AND `publish`.`active_slot` IS NULL
)
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_menu_alias_update_immutable`
BEFORE UPDATE ON `menu_alias`
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_menu_alias_delete_immutable`
BEFORE DELETE ON `menu_alias`
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_business_hour_count_guard`
BEFORE INSERT ON `store_business_hour`
WHEN NOT EXISTS (
	SELECT 1
	FROM `search_evidence_publish`
	WHERE `publish_id` = NEW.`evidence_publish_id`
		AND `status` = 'BUILDING'
		AND `active_slot` IS NULL
)
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_business_hour_update_immutable`
BEFORE UPDATE ON `store_business_hour`
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `search_evidence_business_hour_delete_immutable`
BEFORE DELETE ON `store_business_hour`
BEGIN
	SELECT RAISE(ABORT, 'search evidence is immutable');
END;--> statement-breakpoint
CREATE UNIQUE INDEX `data_publish_identity_snapshot_unique` ON `data_publish` (`publish_id`,`input_snapshot_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `catalog_publish_state` (
	`state_id`,
	`publish_id`,
	`snapshot_id`,
	`source_basis_date`,
	`source_downloaded_at_ms`,
	`updated_at_ms`
)
SELECT
	'active',
	`publish`.`publish_id`,
	`publish`.`input_snapshot_id`,
	`snapshot`.`basis_date`,
	`snapshot`.`downloaded_at_ms`,
	`publish`.`published_at_ms`
FROM `data_publish` AS `publish`
JOIN `source_snapshot` AS `snapshot`
	ON `snapshot`.`snapshot_id` = `publish`.`input_snapshot_id`
WHERE `publish`.`status` = 'SUCCEEDED'
ORDER BY
	`snapshot`.`basis_date` DESC,
	`snapshot`.`downloaded_at_ms` DESC,
	`snapshot`.`snapshot_id` DESC,
	`publish`.`published_at_ms` DESC,
	`publish`.`publish_id` ASC
LIMIT 1;
