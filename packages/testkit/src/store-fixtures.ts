export const storeNormalizationCases = {
  address: [
    {
      name: "canonicalizes Seoul alias, punctuation and spacing",
      input: " 서울시  마포구 월드컵로 1 , 2층 ",
      expected: {
        displayAddress: "서울특별시 마포구 월드컵로 1 2층",
        normalizedAddress: "서울특별시 마포구 월드컵로 1 2층",
        seoulDistrict: "마포구"
      }
    },
    {
      name: "canonicalizes the short Seoul prefix",
      input: "서울 마포구 월드컵로 1－1",
      expected: {
        displayAddress: "서울특별시 마포구 월드컵로 1-1",
        normalizedAddress: "서울특별시 마포구 월드컵로 1-1",
        seoulDistrict: "마포구"
      }
    },
    {
      name: "rejects an address outside Seoul",
      input: "부산광역시 해운대구 해운대로 3",
      expected: null
    },
    {
      name: "rejects an empty address",
      input: "   ",
      expected: null
    },
    {
      name: "keeps a missing address missing",
      input: null,
      expected: null
    }
  ],
  phone: [
    {
      name: "normalizes a Seoul landline",
      input: "02-1234-5678",
      expected: "0212345678"
    },
    {
      name: "normalizes a Korean international number",
      input: "+82 2 1234 5678",
      expected: "0212345678"
    },
    {
      name: "normalizes a mobile number",
      input: "010.1234.5678",
      expected: "01012345678"
    },
    {
      name: "rejects a redacted placeholder number",
      input: "010-0000-0000",
      expected: null
    },
    {
      name: "rejects an invalid short number",
      input: "02-123",
      expected: null
    },
    {
      name: "keeps a missing phone missing",
      input: null,
      expected: null
    }
  ],
  name: [
    {
      name: "removes a legal marker and separates an explicit branch",
      input: "(주) 소금빵 연구소 강남점",
      expected: {
        displayName: "소금빵 연구소 강남점",
        normalizedName: "소금빵연구소강남점",
        normalizedBrandName: "소금빵연구소",
        branchName: "강남점"
      }
    },
    {
      name: "does not mistake 제과점 for a branch label",
      input: " 북촌   제과점 ",
      expected: {
        displayName: "북촌 제과점",
        normalizedName: "북촌제과점",
        normalizedBrandName: "북촌제과점",
        branchName: null
      }
    },
    {
      name: "does not mistake 빵집 for a branch label",
      input: "한강 빵집",
      expected: {
        displayName: "한강 빵집",
        normalizedName: "한강빵집",
        normalizedBrandName: "한강빵집",
        branchName: null
      }
    }
  ],
  coordinates: [
    {
      name: "transforms the Feature 2 Mapo EPSG:5174 point",
      x: "191234.125",
      y: "451234.5",
      expected: {
        latitudeE7: 375634614,
        longitudeE7: 1269014494,
        crs: "EPSG:4326"
      }
    },
    {
      name: "transforms the Feature 2 Jongno EPSG:5174 point",
      x: "198765.25",
      y: "452345.75",
      expected: {
        latitudeE7: 375735170,
        longitudeE7: 1269866872,
        crs: "EPSG:4326"
      }
    },
    {
      name: "keeps missing coordinates missing",
      x: null,
      y: null,
      expected: null
    },
    {
      name: "rejects a partial coordinate pair",
      x: "191234.125",
      y: null,
      expected: null
    },
    {
      name: "rejects a malformed coordinate pair",
      x: "not-a-number",
      y: "451234.5",
      expected: null
    }
  ]
} as const;

const commonDeduplicationCandidate = {
  snapshotId: "snapshot_deduplication",
  displayName: "소금빵 연구소 본점",
  normalizedName: "소금빵연구소본점",
  normalizedBrandName: "소금빵연구소",
  branchName: "본점",
  displayAddress: "서울특별시 마포구 월드컵로 1",
  normalizedAddress: "서울특별시 마포구 월드컵로 1",
  seoulDistrict: "마포구",
  coordinates: {
    latitudeE7: 375634614,
    longitudeE7: 1269014494,
    crs: "EPSG:4326"
  },
  businessStatus: "active",
  normalizationVersion: "store-normalization-v1",
  reviewReasonCodes: []
} as const;

export const storeDeduplicationFixture = {
  candidates: [
    {
      ...commonDeduplicationCandidate,
      candidateId: "candidate_a",
      sourceRecordId: "record_a",
      sourceRowId: "source_row_a",
      managementNumber: "SEOUL-DUP-001",
      normalizedPhone: "0212345678"
    },
    {
      ...commonDeduplicationCandidate,
      candidateId: "candidate_b",
      sourceRecordId: "record_b",
      sourceRowId: "source_row_b",
      managementNumber: "SEOUL-DUP-002",
      normalizedPhone: "0212345678"
    },
    {
      ...commonDeduplicationCandidate,
      candidateId: "candidate_c",
      sourceRecordId: "record_c",
      sourceRowId: "source_row_c",
      managementNumber: "SEOUL-DUP-003",
      normalizedPhone: null
    },
    {
      candidateId: "candidate_d",
      snapshotId: "snapshot_deduplication",
      sourceRecordId: "record_d",
      sourceRowId: "source_row_d",
      managementNumber: "SEOUL-DISTINCT-001",
      displayName: "북촌 제과점",
      normalizedName: "북촌제과점",
      normalizedBrandName: "북촌제과점",
      branchName: null,
      displayAddress: "서울특별시 종로구 북촌로 4",
      normalizedAddress: "서울특별시 종로구 북촌로 4",
      seoulDistrict: "종로구",
      normalizedPhone: "0276543210",
      coordinates: {
        latitudeE7: 375735170,
        longitudeE7: 1269866872,
        crs: "EPSG:4326"
      },
      businessStatus: "active",
      normalizationVersion: "store-normalization-v1",
      reviewReasonCodes: []
    }
  ],
  expectedMatches: [
    {
      leftCandidateId: "candidate_a",
      rightCandidateId: "candidate_b",
      scoreBasisPoints: 10000,
      status: "auto_merge",
      evidence: {
        address: {
          available: true,
          matched: true,
          conflict: false,
          left: "서울특별시 마포구 월드컵로 1",
          right: "서울특별시 마포구 월드컵로 1"
        },
        coordinate: {
          available: true,
          matched: true,
          distanceMeters: 0
        },
        phone: {
          available: true,
          matched: true,
          conflict: false,
          left: "0212345678",
          right: "0212345678"
        },
        name: {
          available: true,
          matched: true,
          similarityBasisPoints: 10000
        }
      }
    },
    {
      leftCandidateId: "candidate_a",
      rightCandidateId: "candidate_c",
      scoreBasisPoints: 8000,
      status: "admin_review",
      evidence: {
        address: {
          available: true,
          matched: true,
          conflict: false,
          left: "서울특별시 마포구 월드컵로 1",
          right: "서울특별시 마포구 월드컵로 1"
        },
        coordinate: {
          available: true,
          matched: true,
          distanceMeters: 0
        },
        phone: {
          available: false,
          matched: false,
          conflict: false,
          left: "0212345678",
          right: null
        },
        name: {
          available: true,
          matched: true,
          similarityBasisPoints: 10000
        }
      }
    },
    {
      leftCandidateId: "candidate_b",
      rightCandidateId: "candidate_c",
      scoreBasisPoints: 8000,
      status: "admin_review",
      evidence: {
        address: {
          available: true,
          matched: true,
          conflict: false,
          left: "서울특별시 마포구 월드컵로 1",
          right: "서울특별시 마포구 월드컵로 1"
        },
        coordinate: {
          available: true,
          matched: true,
          distanceMeters: 0
        },
        phone: {
          available: false,
          matched: false,
          conflict: false,
          left: "0212345678",
          right: null
        },
        name: {
          available: true,
          matched: true,
          similarityBasisPoints: 10000
        }
      }
    }
  ],
  expectedGroups: [
    ["candidate_a", "candidate_b"],
    ["candidate_c"],
    ["candidate_d"]
  ]
} as const;

function createEligibilityStores(
  prefix: string,
  count: number,
  overrides: {
    businessStatus?: "active" | "inactive" | "unknown";
    coordinatesMissingAt?: number;
    mergeStatusAt?: number;
  } = {}
) {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    return {
      storeId: `store_${prefix}_${ordinal}`,
      displayName: `Fixture Bakery ${ordinal}`,
      normalizedName: `fixturebakery${ordinal}`,
      normalizedBrandName: `fixturebakery${prefix}`,
      normalizedAddress: `서울특별시 마포구 월드컵로 ${ordinal}`,
      seoulDistrict: "마포구",
      normalizedPhone: `021234${String(ordinal).padStart(4, "0")}`,
      coordinates:
        overrides.coordinatesMissingAt === ordinal
          ? null
          : {
              latitudeE7: 375600000 + ordinal,
              longitudeE7: 1269000000 + ordinal,
              crs: "EPSG:4326"
            },
      businessStatus: overrides.businessStatus ?? "active",
      sourceCandidateIds: [`candidate_${prefix}_${ordinal}`],
      sourceRecordIds: [`record_${prefix}_${ordinal}`],
      sourceManagementNumbers: [`MNG-${prefix}-${ordinal}`],
      mergeStatus:
        overrides.mergeStatusAt === ordinal
          ? "admin_review"
          : "distinct",
      reviewReasonCodes:
        overrides.coordinatesMissingAt === ordinal
          ? ["COORDINATE_MISSING_OR_INVALID"]
          : overrides.mergeStatusAt === ordinal
            ? ["DUPLICATE_MATCH_REVIEW_REQUIRED"]
            : []
    };
  });
}

function createEligibilityEvidence(
  prefix: string,
  count: number,
  overrides: {
    ftcStatus?:
      | "confirmed_franchise"
      | "not_found"
      | "unavailable"
      | "stale";
    operatorEvidenceRefs?: string[];
    independenceEvidenceRefs?: string[];
    adminReviewStatus?: "approved" | "pending" | "rejected";
  } = {}
) {
  return {
    brandKey: `brand_${prefix}`,
    displayName: `Fixture Bakery ${prefix}`,
    sourceManagementNumbers: Array.from(
      { length: count },
      (_, index) => `MNG-${prefix}-${index + 1}`
    ),
    ftcStatus: overrides.ftcStatus ?? "not_found",
    ftcEvidenceRefs:
      overrides.ftcStatus === "confirmed_franchise"
        ? [`fixture://ftc/franchise/${prefix}`]
        : [`fixture://ftc/no-match/${prefix}`],
    operatorEvidenceRefs:
      overrides.operatorEvidenceRefs ??
      (count > 1 ? [`fixture://operator/${prefix}`] : []),
    independenceEvidenceRefs:
      overrides.independenceEvidenceRefs ??
      (count === 1 ? [`fixture://independent/${prefix}`] : []),
    adminReviewStatus:
      overrides.adminReviewStatus ?? "approved",
    adminEvidenceRefs:
      overrides.adminReviewStatus === "pending"
        ? []
        : [`fixture://admin/${prefix}`]
  };
}

export const storeEligibilityCases = [
  {
    name: "accepts one reviewed independent store",
    input: {
      bakeryId: "bakery_single",
      stores: createEligibilityStores("single", 1),
      evidence: createEligibilityEvidence("single", 1)
    },
    expected: {
      classification: "INDEPENDENT_SINGLE",
      status: "eligible",
      reasonCodes: [
        "ADMIN_APPROVED",
        "FTC_NO_MATCH",
        "INDEPENDENCE_EVIDENCE_PRESENT",
        "SEOUL_STORE_COUNT"
      ]
    }
  },
  ...[2, 5].map((count) => ({
    name: `accepts a reviewed direct-only ${count}-store brand`,
    input: {
      bakeryId: `bakery_chain_${count}`,
      stores: createEligibilityStores(`chain${count}`, count),
      evidence: createEligibilityEvidence(`chain${count}`, count)
    },
    expected: {
      classification: "DIRECT_ONLY_SMALL_CHAIN",
      status: "eligible",
      reasonCodes: [
        "ADMIN_APPROVED",
        "FTC_NO_MATCH",
        "OPERATOR_EVIDENCE_PRESENT",
        "SEOUL_STORE_COUNT"
      ]
    }
  })),
  {
    name: "excludes a six-store Seoul brand",
    input: {
      bakeryId: "bakery_chain_6",
      stores: createEligibilityStores("chain6", 6),
      evidence: createEligibilityEvidence("chain6", 6)
    },
    expected: {
      classification: "CHAIN_TOO_LARGE",
      status: "excluded",
      reasonCodes: ["CHAIN_LIMIT_EXCEEDED", "SEOUL_STORE_COUNT"]
    }
  },
  {
    name: "excludes confirmed franchise evidence",
    input: {
      bakeryId: "bakery_franchise",
      stores: createEligibilityStores("franchise", 2),
      evidence: createEligibilityEvidence("franchise", 2, {
        ftcStatus: "confirmed_franchise"
      })
    },
    expected: {
      classification: "FRANCHISE",
      status: "excluded",
      reasonCodes: ["FTC_FRANCHISE_CONFIRMED"]
    }
  },
  {
    name: "does not treat an FTC miss alone as independence",
    input: {
      bakeryId: "bakery_ftc_only",
      stores: createEligibilityStores("ftconly", 1),
      evidence: createEligibilityEvidence("ftconly", 1, {
        independenceEvidenceRefs: [],
        adminReviewStatus: "pending"
      })
    },
    expected: {
      classification: "UNCERTAIN_REVIEW_REQUIRED",
      status: "admin_review",
      reasonCodes: [
        "ADMIN_PENDING",
        "FTC_NO_MATCH",
        "INDEPENDENCE_EVIDENCE_MISSING"
      ]
    }
  },
  {
    name: "reviews stale FTC evidence",
    input: {
      bakeryId: "bakery_stale_ftc",
      stores: createEligibilityStores("staleftc", 2),
      evidence: createEligibilityEvidence("staleftc", 2, {
        ftcStatus: "stale"
      })
    },
    expected: {
      classification: "UNCERTAIN_REVIEW_REQUIRED",
      status: "admin_review",
      reasonCodes: ["FTC_STALE"]
    }
  },
  {
    name: "reviews a store without publishable coordinates",
    input: {
      bakeryId: "bakery_missing_coordinate",
      stores: createEligibilityStores("missingcoord", 1, {
        coordinatesMissingAt: 1
      }),
      evidence: createEligibilityEvidence("missingcoord", 1)
    },
    expected: {
      classification: "UNCERTAIN_REVIEW_REQUIRED",
      status: "admin_review",
      reasonCodes: ["STORE_COORDINATE_UNRESOLVED"]
    }
  },
  {
    name: "reviews an unresolved duplicate match",
    input: {
      bakeryId: "bakery_duplicate_review",
      stores: createEligibilityStores("dupreview", 1, {
        mergeStatusAt: 1
      }),
      evidence: createEligibilityEvidence("dupreview", 1)
    },
    expected: {
      classification: "UNCERTAIN_REVIEW_REQUIRED",
      status: "admin_review",
      reasonCodes: ["DUPLICATE_MATCH_UNRESOLVED"]
    }
  },
  {
    name: "excludes a rejected admin decision",
    input: {
      bakeryId: "bakery_admin_rejected",
      stores: createEligibilityStores("rejected", 1),
      evidence: createEligibilityEvidence("rejected", 1, {
        adminReviewStatus: "rejected"
      })
    },
    expected: {
      classification: "UNCERTAIN_REVIEW_REQUIRED",
      status: "excluded",
      reasonCodes: ["ADMIN_REJECTED"]
    }
  },
  {
    name: "excludes a non-operating store",
    input: {
      bakeryId: "bakery_inactive",
      stores: createEligibilityStores("inactive", 1, {
        businessStatus: "inactive"
      }),
      evidence: createEligibilityEvidence("inactive", 1)
    },
    expected: {
      classification: "UNCERTAIN_REVIEW_REQUIRED",
      status: "excluded",
      reasonCodes: ["STORE_NOT_OPERATING"]
    }
  }
] as const;
