import { createHash } from "node:crypto";
import {
  brandEligibilityEvidenceSchema,
  eligibilityDecisionSchema,
  STORE_ELIGIBILITY_VERSION,
  type BrandEligibilityEvidence,
  type CanonicalStoreCandidate,
  type EligibilityDecision,
  type EligibilityReason
} from "@bread-map/contracts";

export interface BrandEligibilityInput {
  bakeryId: string;
  stores: readonly CanonicalStoreCandidate[];
  evidence: BrandEligibilityEvidence;
  ruleVersion?: string;
}

function stableDecisionId(
  bakeryId: string,
  storeIds: readonly string[],
  ruleVersion: string
): string {
  return `decision_${createHash("sha256")
    .update(
      [ruleVersion, bakeryId, ...storeIds.slice().sort()].join(":")
    )
    .digest("hex")
    .slice(0, 24)}`;
}

function reason(
  code: string,
  evidenceRefs: readonly string[] = []
): EligibilityReason {
  return { code, evidenceRefs: [...evidenceRefs].sort() };
}

function uniqueReasons(
  reasons: readonly EligibilityReason[]
): EligibilityReason[] {
  const byCode = new Map<string, EligibilityReason>();
  for (const item of reasons) {
    byCode.set(item.code, item);
  }
  return [...byCode.values()].sort((left, right) =>
    left.code.localeCompare(right.code)
  );
}

function ftcReason(
  evidence: BrandEligibilityEvidence
): EligibilityReason {
  const code = {
    confirmed_franchise: "FTC_FRANCHISE_CONFIRMED",
    not_found: "FTC_NO_MATCH",
    unavailable: "FTC_UNAVAILABLE",
    stale: "FTC_STALE"
  }[evidence.ftcStatus];
  return reason(code, evidence.ftcEvidenceRefs);
}

function adminReason(
  evidence: BrandEligibilityEvidence
): EligibilityReason {
  const code = {
    approved: "ADMIN_APPROVED",
    pending: "ADMIN_PENDING",
    rejected: "ADMIN_REJECTED"
  }[evidence.adminReviewStatus];
  return reason(code, evidence.adminEvidenceRefs);
}

function evidenceReason(
  storeCount: number,
  evidence: BrandEligibilityEvidence
): EligibilityReason {
  if (storeCount === 1) {
    return reason(
      evidence.independenceEvidenceRefs.length > 0
        ? "INDEPENDENCE_EVIDENCE_PRESENT"
        : "INDEPENDENCE_EVIDENCE_MISSING",
      evidence.independenceEvidenceRefs
    );
  }
  return reason(
    evidence.operatorEvidenceRefs.length > 0
      ? "OPERATOR_EVIDENCE_PRESENT"
      : "OPERATOR_EVIDENCE_MISSING",
    evidence.operatorEvidenceRefs
  );
}

function hasCompleteBrandMembership(
  stores: readonly CanonicalStoreCandidate[],
  evidence: BrandEligibilityEvidence
): boolean {
  const actual = [
    ...new Set(
      stores.flatMap((store) => store.sourceManagementNumbers)
    )
  ].sort();
  const evidenced = [
    ...new Set(evidence.sourceManagementNumbers)
  ].sort();
  return (
    actual.length === evidenced.length &&
    actual.every((value, index) => value === evidenced[index])
  );
}

export function classifyEligibility({
  bakeryId,
  stores,
  evidence: unvalidatedEvidence,
  ruleVersion = STORE_ELIGIBILITY_VERSION
}: BrandEligibilityInput): EligibilityDecision {
  const evidence = brandEligibilityEvidenceSchema.parse(
    unvalidatedEvidence
  );
  if (stores.length === 0) {
    throw new Error("ELIGIBILITY_STORE_SET_EMPTY");
  }
  const orderedStoreIds = stores
    .map((store) => store.storeId)
    .sort();
  const baseReasons = [
    reason("SEOUL_STORE_COUNT", [
      `count://seoul/${stores.length}`
    ]),
    ftcReason(evidence),
    adminReason(evidence),
    evidenceReason(stores.length, evidence)
  ];
  const decide = (
    classification: EligibilityDecision["classification"],
    status: EligibilityDecision["status"],
    additionalReasons: readonly EligibilityReason[] = []
  ) =>
    eligibilityDecisionSchema.parse({
      decisionId: stableDecisionId(
        bakeryId,
        orderedStoreIds,
        ruleVersion
      ),
      bakeryId,
      storeIds: orderedStoreIds,
      classification,
      status,
      reasons: uniqueReasons([
        ...baseReasons,
        ...additionalReasons
      ]),
      ruleVersion
    });

  const nonOperating = stores.filter(
    (store) => store.businessStatus === "inactive"
  );
  if (nonOperating.length > 0) {
    return decide(
      "UNCERTAIN_REVIEW_REQUIRED",
      "excluded",
      nonOperating.map((store) =>
        reason("STORE_NOT_OPERATING", [
          `store://${store.storeId}`
        ])
      )
    );
  }
  if (evidence.adminReviewStatus === "rejected") {
    return decide(
      "UNCERTAIN_REVIEW_REQUIRED",
      "excluded"
    );
  }
  if (evidence.ftcStatus === "confirmed_franchise") {
    return decide("FRANCHISE", "excluded");
  }
  if (stores.length >= 6) {
    return decide("CHAIN_TOO_LARGE", "excluded", [
      reason("CHAIN_LIMIT_EXCEEDED", [
        `count://seoul/${stores.length}`
      ])
    ]);
  }

  const unknownStatus = stores.filter(
    (store) => store.businessStatus === "unknown"
  );
  const missingCoordinates = stores.filter(
    (store) => store.coordinates === null
  );
  const unresolvedMatches = stores.filter(
    (store) => store.mergeStatus === "admin_review"
  );
  const blockingReasons: EligibilityReason[] = [];
  blockingReasons.push(
    ...unknownStatus.map((store) =>
      reason("STORE_STATUS_UNRESOLVED", [
        `store://${store.storeId}`
      ])
    ),
    ...missingCoordinates.map((store) =>
      reason("STORE_COORDINATE_UNRESOLVED", [
        `store://${store.storeId}`
      ])
    ),
    ...unresolvedMatches.map((store) =>
      reason("DUPLICATE_MATCH_UNRESOLVED", [
        `store://${store.storeId}`
      ])
    )
  );
  if (!hasCompleteBrandMembership(stores, evidence)) {
    blockingReasons.push(
      reason("BRAND_MEMBERSHIP_EVIDENCE_INCOMPLETE")
    );
  }
  if (
    evidence.ftcStatus === "unavailable" ||
    evidence.ftcStatus === "stale"
  ) {
    blockingReasons.push(ftcReason(evidence));
  }
  if (evidence.adminReviewStatus !== "approved") {
    blockingReasons.push(adminReason(evidence));
  }
  if (
    stores.length === 1 &&
    evidence.independenceEvidenceRefs.length === 0
  ) {
    blockingReasons.push(
      reason("INDEPENDENCE_EVIDENCE_MISSING")
    );
  }
  if (
    stores.length >= 2 &&
    evidence.operatorEvidenceRefs.length === 0
  ) {
    blockingReasons.push(reason("OPERATOR_EVIDENCE_MISSING"));
  }

  if (blockingReasons.length > 0) {
    return decide(
      "UNCERTAIN_REVIEW_REQUIRED",
      "admin_review",
      blockingReasons
    );
  }

  return decide(
    stores.length === 1
      ? "INDEPENDENT_SINGLE"
      : "DIRECT_ONLY_SMALL_CHAIN",
    "eligible"
  );
}
