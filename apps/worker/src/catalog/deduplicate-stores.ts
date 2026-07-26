import { createHash } from "node:crypto";
import {
  deduplicationResultSchema,
  STORE_MATCHER_VERSION,
  type CanonicalStoreCandidate,
  type DeduplicationResult,
  type NormalizedCoordinates,
  type NormalizedStoreCandidate,
  type StoreMatchCandidate,
  type StoreMatchEvidence
} from "@bread-map/contracts";

const EARTH_RADIUS_METERS = 6_371_000;

function stableId(namespace: string, input: string): string {
  return `${namespace}_${createHash("sha256")
    .update(input)
    .digest("hex")
    .slice(0, 24)}`;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function coordinateDistanceMeters(
  left: NormalizedCoordinates,
  right: NormalizedCoordinates
): number {
  const leftLatitude = left.latitudeE7 / 10_000_000;
  const rightLatitude = right.latitudeE7 / 10_000_000;
  const latitudeDelta = toRadians(
    rightLatitude - leftLatitude
  );
  const longitudeDelta = toRadians(
    (right.longitudeE7 - left.longitudeE7) / 10_000_000
  );
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(leftLatitude)) *
      Math.cos(toRadians(rightLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

function characterBigrams(value: string): Set<string> {
  if (value.length < 2) {
    return new Set([value]);
  }
  return new Set(
    Array.from({ length: value.length - 1 }, (_, index) =>
      value.slice(index, index + 2)
    )
  );
}

function nameSimilarityBasisPoints(
  left: NormalizedStoreCandidate,
  right: NormalizedStoreCandidate
): number {
  if (left.normalizedName === right.normalizedName) {
    return 10000;
  }
  const leftBigrams = characterBigrams(left.normalizedBrandName);
  const rightBigrams = characterBigrams(right.normalizedBrandName);
  const intersection = [...leftBigrams].filter((value) =>
    rightBigrams.has(value)
  ).length;
  return Math.round(
    (20000 * intersection) /
      (leftBigrams.size + rightBigrams.size)
  );
}

function buildEvidence(
  left: NormalizedStoreCandidate,
  right: NormalizedStoreCandidate
): StoreMatchEvidence {
  const addressAvailable =
    left.normalizedAddress.length > 0 &&
    right.normalizedAddress.length > 0;
  const addressMatched =
    addressAvailable &&
    left.normalizedAddress === right.normalizedAddress;
  const coordinateAvailable =
    left.coordinates !== null && right.coordinates !== null;
  const distanceMeters = coordinateAvailable
    ? coordinateDistanceMeters(left.coordinates!, right.coordinates!)
    : null;
  const phoneAvailable =
    left.normalizedPhone !== null &&
    right.normalizedPhone !== null;
  const phoneMatched =
    phoneAvailable &&
    left.normalizedPhone === right.normalizedPhone;
  const similarityBasisPoints = nameSimilarityBasisPoints(left, right);

  return {
    address: {
      available: addressAvailable,
      matched: addressMatched,
      conflict: addressAvailable && !addressMatched,
      left: left.normalizedAddress || null,
      right: right.normalizedAddress || null
    },
    coordinate: {
      available: coordinateAvailable,
      matched:
        distanceMeters !== null && distanceMeters <= 50,
      distanceMeters:
        distanceMeters === null
          ? null
          : Math.round(distanceMeters * 100) / 100
    },
    phone: {
      available: phoneAvailable,
      matched: phoneMatched,
      conflict: phoneAvailable && !phoneMatched,
      left: left.normalizedPhone,
      right: right.normalizedPhone
    },
    name: {
      available: true,
      matched: similarityBasisPoints >= 7500,
      similarityBasisPoints
    }
  };
}

function scoreEvidence(evidence: StoreMatchEvidence): number {
  return (
    (evidence.address.matched ? 4000 : 0) +
    (evidence.coordinate.matched ? 2500 : 0) +
    (evidence.phone.matched ? 2000 : 0) +
    Math.round(
      (evidence.name.similarityBasisPoints * 1500) / 10000
    )
  );
}

function isCandidatePair(evidence: StoreMatchEvidence): boolean {
  return (
    evidence.address.matched ||
    (evidence.coordinate.distanceMeters !== null &&
      evidence.coordinate.distanceMeters <= 100) ||
    evidence.phone.matched ||
    evidence.name.similarityBasisPoints >= 7500
  );
}

function classifyMatch(
  scoreBasisPoints: number,
  evidence: StoreMatchEvidence
): StoreMatchCandidate["status"] {
  const hasConflict =
    evidence.address.conflict || evidence.phone.conflict;
  if (scoreBasisPoints >= 9200 && !hasConflict) {
    return "auto_merge";
  }
  if (
    scoreBasisPoints >= 7500 ||
    (hasConflict &&
      (evidence.address.matched ||
        evidence.coordinate.matched ||
        evidence.phone.matched))
  ) {
    return "admin_review";
  }
  return "separate";
}

class DisjointSet {
  readonly #parents = new Map<string, string>();

  constructor(ids: readonly string[]) {
    for (const id of ids) {
      this.#parents.set(id, id);
    }
  }

  find(id: string): string {
    const parent = this.#parents.get(id);
    if (parent === undefined) {
      throw new Error("STORE_MATCH_CANDIDATE_NOT_FOUND");
    }
    if (parent === id) {
      return id;
    }
    const root = this.find(parent);
    this.#parents.set(id, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) {
      return;
    }
    const [first, second] = [leftRoot, rightRoot].sort();
    this.#parents.set(second!, first!);
  }
}

function buildCanonicalStore(
  candidates: readonly NormalizedStoreCandidate[],
  hasAdminReviewMatch: boolean,
  matcherVersion: string
): CanonicalStoreCandidate {
  const ordered = [...candidates].sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId)
  );
  const primary = ordered[0];
  if (primary === undefined) {
    throw new Error("STORE_MATCH_GROUP_EMPTY");
  }
  const sourceRecordIds = ordered.map(
    (candidate) => candidate.sourceRecordId
  );
  const reviewReasonCodes = [
    ...new Set(
      ordered.flatMap((candidate) => candidate.reviewReasonCodes)
    )
  ].sort();
  if (hasAdminReviewMatch) {
    reviewReasonCodes.push("DUPLICATE_MATCH_REVIEW_REQUIRED");
  }

  return {
    storeId: stableId(
      "store",
      [
        matcherVersion,
        ...sourceRecordIds.slice().sort()
      ].join(":")
    ),
    displayName: primary.displayName,
    normalizedName: primary.normalizedName,
    normalizedBrandName: primary.normalizedBrandName,
    normalizedAddress: primary.normalizedAddress,
    seoulDistrict: primary.seoulDistrict,
    normalizedPhone: primary.normalizedPhone,
    coordinates: primary.coordinates,
    businessStatus: primary.businessStatus,
    sourceCandidateIds: ordered.map(
      (candidate) => candidate.candidateId
    ),
    sourceRecordIds,
    sourceManagementNumbers: ordered.map(
      (candidate) => candidate.managementNumber
    ),
    mergeStatus: hasAdminReviewMatch
      ? "admin_review"
      : ordered.length > 1
        ? "auto_merged"
        : "distinct",
    reviewReasonCodes
  };
}

export function deduplicateStores(
  candidates: readonly NormalizedStoreCandidate[],
  options: { matcherVersion?: string } = {}
): DeduplicationResult {
  const matcherVersion =
    options.matcherVersion ?? STORE_MATCHER_VERSION;
  const ordered = [...candidates].sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId)
  );
  const matches: StoreMatchCandidate[] = [];
  const disjointSet = new DisjointSet(
    ordered.map((candidate) => candidate.candidateId)
  );

  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const left = ordered[leftIndex]!;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < ordered.length;
      rightIndex += 1
    ) {
      const right = ordered[rightIndex]!;
      const evidence = buildEvidence(left, right);
      if (!isCandidatePair(evidence)) {
        continue;
      }
      const scoreBasisPoints = scoreEvidence(evidence);
      const status = classifyMatch(scoreBasisPoints, evidence);
      const match: StoreMatchCandidate = {
        matchId: stableId(
          "match",
          [
            matcherVersion,
            left.candidateId,
            right.candidateId
          ].join(":")
        ),
        leftCandidateId: left.candidateId,
        rightCandidateId: right.candidateId,
        scoreBasisPoints,
        status,
        matcherVersion,
        evidence
      };
      matches.push(match);
      if (status === "auto_merge") {
        disjointSet.union(left.candidateId, right.candidateId);
      }
    }
  }

  const groups = new Map<string, NormalizedStoreCandidate[]>();
  for (const candidate of ordered) {
    const root = disjointSet.find(candidate.candidateId);
    const group = groups.get(root) ?? [];
    group.push(candidate);
    groups.set(root, group);
  }
  const adminReviewCandidateIds = new Set(
    matches
      .filter((match) => match.status === "admin_review")
      .flatMap((match) => [
        match.leftCandidateId,
        match.rightCandidateId
      ])
  );
  const stores = [...groups.values()]
    .map((group) =>
      buildCanonicalStore(
        group,
        group.some((candidate) =>
          adminReviewCandidateIds.has(candidate.candidateId)
        ),
        matcherVersion
      )
    )
    .sort((left, right) =>
      left.sourceCandidateIds[0]!.localeCompare(
        right.sourceCandidateIds[0]!
      )
    );

  return deduplicationResultSchema.parse({
    stores,
    matches,
    matcherVersion
  });
}
