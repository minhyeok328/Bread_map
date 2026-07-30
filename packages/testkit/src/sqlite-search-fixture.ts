import type {
  AppDatabaseHandle
} from "@bread-map/app-db";

export const SQLITE_SEARCH_FIXTURE_REQUEST_TIME_MS = Date.parse(
  "2026-07-30T12:00:00+09:00"
);

export const SQLITE_SEARCH_FIXTURE_SOURCE_DATE = "2026-07-30";

/**
 * Seeds a migrated app database with a complete active search snapshot.
 *
 * This fixture contains no user or provider identity. Store A has three
 * reviews, Store B has two, and Store Hidden is deliberately absent from the
 * active source snapshot.
 */
export function seedSqliteSearchFixture(
  database: AppDatabaseHandle
): void {
  database.client.exec(`
    INSERT INTO source_catalog (
      source_id, source_key, official_url, required_fields_json,
      terms_checked_at_ms, created_at_ms
    ) VALUES (
      'source_fixture', 'fixture', 'https://example.test',
      '[]', 1, 1
    );

    INSERT INTO source_snapshot (
      snapshot_id, source_id, sha256, byte_size, basis_date,
      downloaded_at_ms, adapter_version, local_path_hint
    ) VALUES (
      'snapshot_active', 'source_fixture',
      X'0101010101010101010101010101010101010101010101010101010101010101',
      1, '2026-07-30', 100, 'fixture-v1', NULL
    );

    INSERT INTO source_snapshot_row (
      source_row_id, snapshot_id, page_no, row_index,
      source_row_key, payload_json, payload_sha256, created_at_ms
    ) VALUES
      (
        'source_row_store_a', 'snapshot_active', 1, 0,
        'SEOUL-A', '{}',
        X'0202020202020202020202020202020202020202020202020202020202020202',
        1
      ),
      (
        'source_row_store_b', 'snapshot_active', 1, 1,
        'SEOUL-B', '{}',
        X'0303030303030303030303030303030303030303030303030303030303030303',
        1
      );

    INSERT INTO localdata_bakery_record (
      record_id, snapshot_id, source_row_id, mng_no,
      open_authority_group_code, permit_date,
      business_status_code, business_status_name,
      detailed_business_status_code, detailed_business_status_name,
      closed_date, business_name, road_name_address,
      lot_number_address, source_coordinate_x, source_coordinate_y,
      data_updated_at_ms, last_modified_at_ms, staged_at_ms
    ) VALUES
      (
        'record_store_a', 'snapshot_active', 'source_row_store_a',
        'SEOUL-A', '6110000', NULL, '01', '영업/정상', '01', '영업',
        NULL, '한강 빵집', '서울특별시 마포구 월드컵로 1', NULL,
        '191234.125', '451234.5', NULL, NULL, 1
      ),
      (
        'record_store_b', 'snapshot_active', 'source_row_store_b',
        'SEOUL-B', '6110000', NULL, '01', '영업/정상', '01', '영업',
        NULL, '연남 제과', '서울특별시 마포구 연남로 2', NULL,
        '191235.125', '451235.5', NULL, NULL, 1
      );

    INSERT INTO bakery (
      bakery_id, display_name, normalized_name, catalog_status,
      created_at_ms, updated_at_ms
    ) VALUES
      ('bakery_a', '한강 빵집', '한강빵집', 'published', 1, 1),
      ('bakery_b', '연남 제과', '연남제과', 'published', 1, 1),
      (
        'bakery_hidden', '숨김 빵집', '숨김빵집',
        'published', 1, 1
      );

    INSERT INTO store (
      store_id, bakery_id, display_name, normalized_name,
      normalized_brand_name, normalized_address, seoul_district,
      normalized_phone, latitude_e7, longitude_e7, business_status,
      catalog_status, latest_verified_at_ms, created_at_ms,
      updated_at_ms
    ) VALUES
      (
        'store_a', 'bakery_a', '한강 빵집', '한강빵집', '',
        '서울특별시 마포구 월드컵로 1', '마포구', '0212345678',
        375634614, 1269014494, 'active', 'published', 200, 1, 1
      ),
      (
        'store_b', 'bakery_b', '연남 제과', '연남제과', '',
        '서울특별시 마포구 연남로 2', '마포구', NULL,
        375644614, 1269114494, 'active', 'published', 201, 1, 1
      ),
      (
        'store_hidden', 'bakery_hidden', '숨김 빵집', '숨김빵집', '',
        '서울특별시 마포구 숨김로 3', '마포구', NULL,
        375654614, 1269214494, 'active', 'published', 202, 1, 1
      );

    INSERT INTO store_source_link (
      link_id, store_id, source_record_id, source_row_id,
      snapshot_id, source_type, linked_at_ms
    ) VALUES
      (
        'link_store_a', 'store_a', 'record_store_a',
        'source_row_store_a', 'snapshot_active', 'LOCALDATA', 1
      ),
      (
        'link_store_b', 'store_b', 'record_store_b',
        'source_row_store_b', 'snapshot_active', 'LOCALDATA', 1
      );

    INSERT INTO data_publish (
      publish_id, input_snapshot_id, normalization_version,
      matcher_version, eligibility_version, status,
      candidate_count, published_count, excluded_count,
      admin_review_count, published_at_ms
    ) VALUES (
      'publish_active', 'snapshot_active', 'store-normalization-v1',
      'store-matcher-v1', 'store-eligibility-v1', 'SUCCEEDED',
      2, 2, 0, 0, 100
    );

    INSERT INTO catalog_publish_state (
      state_id, publish_id, snapshot_id, source_basis_date,
      source_downloaded_at_ms, updated_at_ms
    ) VALUES (
      'active', 'publish_active', 'snapshot_active',
      '2026-07-30', 100, 100
    );

    INSERT INTO search_evidence_publish (
      publish_id, input_catalog_publish_id, contract_version,
      status, active_slot, menu_count, store_alias_count,
      menu_alias_count, business_hour_count, corpus_checksum,
      published_at_ms
    ) VALUES (
      'evidence_active', 'publish_active', 'search-evidence-v1',
      'BUILDING', NULL, 3, 2, 1, 3,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      200
    );

    INSERT INTO menu (
      menu_id, evidence_publish_id, store_id, name, normalized_name,
      category, source, evidence_ref, verified_at_ms
    ) VALUES
      (
        'menu_a_salt', 'evidence_active', 'store_a', '소금빵',
        '소금빵', 'SALT_BREAD', 'MANUAL_VERIFIED',
        'fixture://menu/a/salt', 200
      ),
      (
        'menu_a_baguette', 'evidence_active', 'store_a', '바게트',
        '바게트', 'BAGUETTE', 'MANUAL_VERIFIED',
        'fixture://menu/a/baguette', 201
      ),
      (
        'menu_b_pastry', 'evidence_active', 'store_b', '크루아상',
        '크루아상', 'PASTRY', 'MANUAL_VERIFIED',
        'fixture://menu/b/pastry', 202
      );

    INSERT INTO menu_alias (
      alias_id, menu_id, alias, normalized_alias, source,
      evidence_ref, verified_at_ms
    ) VALUES (
      'menu_alias_a', 'menu_a_salt', '시오빵', '시오빵',
      'MANUAL_VERIFIED', 'fixture://menu-alias/a', 200
    );

    INSERT INTO store_alias (
      alias_id, evidence_publish_id, store_id, alias_type, alias,
      normalized_alias, source, evidence_ref, verified_at_ms
    ) VALUES
      (
        'store_alias_a', 'evidence_active', 'store_a', 'REGION',
        '홍대입구', '홍대입구', 'MANUAL_VERIFIED',
        'fixture://store-alias/a', 200
      ),
      (
        'store_alias_b', 'evidence_active', 'store_b', 'STORE_NAME',
        '연남빵집', '연남빵집', 'MANUAL_VERIFIED',
        'fixture://store-alias/b', 200
      );

    INSERT INTO store_business_hour (
      interval_id, evidence_publish_id, store_id, weekday, sequence,
      opens_minute, closes_minute, closes_next_day, source,
      evidence_ref, verified_at_ms
    ) VALUES
      (
        'hours_a_thursday', 'evidence_active', 'store_a',
        4, 0, 600, 1080, 0, 'MANUAL_VERIFIED',
        'fixture://hours/a/thursday', 200
      ),
      (
        'hours_a_friday', 'evidence_active', 'store_a',
        5, 0, 600, 1080, 0, 'MANUAL_VERIFIED',
        'fixture://hours/a/friday', 201
      ),
      (
        'hours_b_thursday', 'evidence_active', 'store_b',
        4, 0, 720, 1200, 0, 'MANUAL_VERIFIED',
        'fixture://hours/b/thursday', 202
      );

    UPDATE search_evidence_publish
       SET status = 'ACTIVE', active_slot = 1
     WHERE publish_id = 'evidence_active';

    INSERT INTO review_publish_version (
      version_id, source_run_id, source_run_status,
      source_as_of_date, status, active_slot, document_count,
      fts_document_count, corpus_checksum, published_at_ms
    ) VALUES (
      'review_active', 'run_active', 'SUCCEEDED', '2026-07-30',
      'ACTIVE', 1, 5, 5,
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      300
    );

    INSERT INTO review_document (
      review_id, store_id, provider, body, normalized_body,
      rating_basis_points, published_date, collected_at_ms,
      source_run_id, publish_version_id
    ) VALUES
      (
        'review_a_1', 'store_a', 'KAKAO_MAP',
        '소금빵이 바삭해요', '소금빵 바삭해요', 4500,
        '2026-07-30', 300, 'run_active', 'review_active'
      ),
      (
        'review_a_2', 'store_a', 'KAKAO_MAP',
        '바게트도 고소해요', '바게트 고소해요', 4000,
        '2026-07-29', 300, 'run_active', 'review_active'
      ),
      (
        'review_a_3', 'store_a', 'KAKAO_MAP',
        '빵이 좋아요', '빵 좋아요', NULL,
        '2026-07-28', 300, 'run_active', 'review_active'
      ),
      (
        'review_b_1', 'store_b', 'KAKAO_MAP',
        '크루아상이 맛있어요', '크루아상 맛있어요', 5000,
        '2026-07-27', 300, 'run_active', 'review_active'
      ),
      (
        'review_b_2', 'store_b', 'KAKAO_MAP',
        '페이스트리가 좋아요', '페이스트리 좋아요', 4500,
        '2026-07-26', 300, 'run_active', 'review_active'
      );

    INSERT INTO fts_index_state (
      state_id, index_version, publish_version_id, status,
      active_slot, document_count, corpus_checksum, built_at_ms
    ) VALUES (
      'fts_active', 'review-fts-unicode61-v1',
      'review_active', 'ACTIVE', 1, 5,
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      300
    );
  `);
}
