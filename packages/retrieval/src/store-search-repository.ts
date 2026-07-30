import type {
  SearchErrorCode
} from "@bread-map/contracts";
import type {
  RecommendationCandidateFacts
} from "@bread-map/recommendation";

export interface SearchSnapshotDescriptor {
  dataSnapshotVersion: string;
  catalogPublishId: string;
  catalogSnapshotId: string;
  sourceBasisDate: string;
  searchEvidencePublishId: string | null;
  reviewPublishVersionId: string | null;
  ftsIndexVersion: string | null;
}

export interface LoadSearchSnapshotInput {
  expectedDataSnapshotVersion: string;
  requestTimeMs: number;
}

export interface StoreSearchSnapshot {
  descriptor: SearchSnapshotDescriptor;
  candidates: readonly RecommendationCandidateFacts[];
}

export interface StoreSearchRepository {
  inspectCurrentSnapshot(
    requestTimeMs: number
  ): SearchSnapshotDescriptor;
  loadSnapshot(
    input: LoadSearchSnapshotInput
  ): StoreSearchSnapshot;
}

export class StoreSearchError extends Error {
  readonly code: SearchErrorCode;

  constructor(code: SearchErrorCode) {
    super(code);
    this.name = "StoreSearchError";
    this.code = code;
  }
}
