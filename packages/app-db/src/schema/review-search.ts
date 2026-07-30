export const REVIEW_PUBLISH_CONTRACT_VERSION = "review-publish-v1";
export const REVIEW_FTS_INDEX_VERSION =
  "review-fts-unicode61-v1";
export const REVIEW_FTS_TABLE_NAME = "review_fts";

export const REVIEW_FTS_TRIGGER_NAMES = [
  "review_document_fts_insert",
  "review_document_fts_update",
  "review_document_fts_delete"
] as const;
