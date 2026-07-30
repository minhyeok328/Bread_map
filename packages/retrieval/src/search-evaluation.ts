import { performance } from "node:perf_hooks";
import {
  SEARCH_DATA_VERSION_PREFIX,
  type MenuCategory,
  type ReviewEvidenceStatus,
  type SearchErrorCode,
  type SearchSortMode,
  type StructuredSearchInput,
  type StructuredSearchResult
} from "@bread-map/contracts";
import { StoreSearchError } from "./store-search-repository.js";

const HIT_RATE_GATE_BASIS_POINTS = 8500;
const DETERMINISM_RUNS = 100;
const PERFORMANCE_WARMUP_RUNS = 10;
const PERFORMANCE_RUNS = 100;
const PERFORMANCE_P95_GATE_MS = 1500;

interface SearchEvaluationInput {
  region: string | null;
  storeName: string | null;
  menuName: string | null;
  categories: readonly {
    category: MenuCategory;
    mode: "INCLUDE" | "EXCLUDE";
  }[];
  openNow: boolean;
  origin: {
    latitudeE7: number;
    longitudeE7: number;
  } | null;
  maxDistanceM: number | null;
  reviewEvidenceStatus: ReviewEvidenceStatus;
  sortMode: SearchSortMode;
}

export interface SearchEvaluationCase {
  id: string;
  group:
    | "region"
    | "store"
    | "menu"
    | "category"
    | "visit"
    | "evidence"
    | "combined"
    | "degradation"
    | "expected-error";
  input: SearchEvaluationInput;
  requestTimeMs: number;
  expectedTopFiveStoreIds: readonly string[];
  forbiddenStoreIds: readonly string[];
  countsTowardHitRate: boolean;
  requiredHit?: boolean;
  expectedStatus?: "COMPLETE" | "PARTIAL";
  expectedErrorCode?: SearchErrorCode;
  degradation?: "FTS_UNAVAILABLE";
  useMismatchedVersion?: boolean;
  ratingGuards?: readonly {
    strongerStoreId: string;
    weakerHighRatingStoreId: string;
  }[];
}

export interface SearchEvaluationReport {
  fixtureId: string;
  totalScenarioCount: number;
  hitRateScenarioCount: number;
  successfulExecutionCount: number;
  expectedErrorScenarioCount: number;
  expectedErrorPassCount: number;
  hitRateBasisPoints: number;
  requiredHitViolationCount: number;
  hardExclusionViolationCount: number;
  statusViolationCount: number;
  deterministic: boolean;
  determinismRuns: number;
  ratingOnlyInversionCount: number;
  fallbackPassed: boolean;
  performanceRuns: number;
  p95Ms: number;
  passed: boolean;
}

export interface RunSearchEvaluationOptions {
  fixtureId: string;
  scenarios: readonly SearchEvaluationCase[];
  dataSnapshotVersion: StructuredSearchInput["dataSnapshotVersion"];
  recommendationVersion:
    StructuredSearchInput["recommendationVersion"];
  execute: (
    scenario: SearchEvaluationCase,
    input: StructuredSearchInput
  ) => StructuredSearchResult;
}

function mismatchedVersion(currentVersion: string): string {
  const zeroVersion = `${SEARCH_DATA_VERSION_PREFIX}${"0".repeat(64)}`;
  return currentVersion === zeroVersion
    ? `${SEARCH_DATA_VERSION_PREFIX}${"1".repeat(64)}`
    : zeroVersion;
}

function buildInput(
  scenario: SearchEvaluationCase,
  dataSnapshotVersion: string,
  recommendationVersion:
    StructuredSearchInput["recommendationVersion"]
): StructuredSearchInput {
  return {
    ...scenario.input,
    categories: scenario.input.categories.map((filter) => ({
      ...filter
    })),
    origin:
      scenario.input.origin === null
        ? null
        : { ...scenario.input.origin },
    dataSnapshotVersion: scenario.useMismatchedVersion
      ? mismatchedVersion(dataSnapshotVersion)
      : dataSnapshotVersion,
    recommendationVersion
  };
}

function isExpectedError(
  error: unknown,
  expectedCode: SearchErrorCode
): boolean {
  return (
    error instanceof StoreSearchError &&
    error.code === expectedCode
  );
}

function resultFingerprint(
  result: StructuredSearchResult
): string {
  return JSON.stringify({
    status: result.status,
    partialReason: result.partialReason,
    items: result.items,
    metadata: result.metadata,
    filterSummary: result.filterSummary,
    relaxationOptions: result.relaxationOptions
  });
}

function isTruthfulFallback(
  scenario: SearchEvaluationCase,
  result: StructuredSearchResult
): boolean {
  if (scenario.degradation !== "FTS_UNAVAILABLE") {
    return true;
  }
  return (
    result.status === "PARTIAL" &&
    result.partialReason === "FTS_UNAVAILABLE" &&
    result.metadata.ftsIndexVersion === null &&
    result.items.every(
      (item) =>
        item.review.snippet === null &&
        !item.reasonCodes.includes("REVIEW_EVIDENCE") &&
        item.warningCodes.includes("FTS_UNAVAILABLE")
    )
  );
}

function percentile95(durations: readonly number[]): number {
  if (durations.length === 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  const ordered = [...durations].sort(
    (left, right) => left - right
  );
  return ordered[Math.ceil(ordered.length * 0.95) - 1]!;
}

export function runSearchEvaluation({
  fixtureId,
  scenarios,
  dataSnapshotVersion,
  recommendationVersion,
  execute
}: RunSearchEvaluationOptions): SearchEvaluationReport {
  const successfulScenarios = scenarios.filter(
    (scenario) => scenario.countsTowardHitRate
  );
  const expectedErrorScenarios = scenarios.filter(
    (scenario) => scenario.expectedErrorCode !== undefined
  );
  const baselineResults = new Map<
    string,
    StructuredSearchResult
  >();
  let successfulExecutionCount = 0;
  let expectedErrorPassCount = 0;
  let hitCount = 0;
  let requiredHitViolationCount = 0;
  let hardExclusionViolationCount = 0;
  let statusViolationCount = 0;
  let ratingOnlyInversionCount = 0;
  let fallbackPassed = true;

  for (const scenario of scenarios) {
    const input = buildInput(
      scenario,
      dataSnapshotVersion,
      recommendationVersion
    );
    if (scenario.expectedErrorCode !== undefined) {
      try {
        execute(scenario, input);
      } catch (error) {
        if (isExpectedError(error, scenario.expectedErrorCode)) {
          expectedErrorPassCount += 1;
        }
      }
      continue;
    }

    let result: StructuredSearchResult;
    try {
      result = execute(scenario, input);
      successfulExecutionCount += 1;
    } catch {
      statusViolationCount += 1;
      fallbackPassed =
        fallbackPassed &&
        scenario.degradation !== "FTS_UNAVAILABLE";
      continue;
    }
    baselineResults.set(scenario.id, result);

    const topFiveStoreIds = result.items
      .slice(0, 5)
      .map((item) => item.storeId);
    const hit = scenario.expectedTopFiveStoreIds.some((storeId) =>
      topFiveStoreIds.includes(storeId)
    );
    if (
      scenario.countsTowardHitRate &&
      hit
    ) {
      hitCount += 1;
    }
    if (scenario.requiredHit && !hit) {
      requiredHitViolationCount += 1;
    }
    hardExclusionViolationCount +=
      scenario.forbiddenStoreIds.filter((storeId) =>
        result.items.some((item) => item.storeId === storeId)
      ).length;
    const expectedStatus = scenario.expectedStatus ?? "COMPLETE";
    if (result.status !== expectedStatus) {
      statusViolationCount += 1;
    }
    fallbackPassed =
      fallbackPassed && isTruthfulFallback(scenario, result);

    for (const guard of scenario.ratingGuards ?? []) {
      const strongerIndex = result.items.findIndex(
        (item) => item.storeId === guard.strongerStoreId
      );
      const weakerIndex = result.items.findIndex(
        (item) =>
          item.storeId === guard.weakerHighRatingStoreId
      );
      if (
        strongerIndex < 0 ||
        weakerIndex < 0 ||
        strongerIndex > weakerIndex
      ) {
        ratingOnlyInversionCount += 1;
      }
    }
  }

  let deterministic =
    baselineResults.size === successfulScenarios.length;
  for (
    let run = 1;
    run < DETERMINISM_RUNS && deterministic;
    run += 1
  ) {
    for (const scenario of successfulScenarios) {
      const baseline = baselineResults.get(scenario.id);
      if (baseline === undefined) {
        deterministic = false;
        break;
      }
      try {
        const repeated = execute(
          scenario,
          buildInput(
            scenario,
            dataSnapshotVersion,
            recommendationVersion
          )
        );
        if (
          resultFingerprint(repeated) !==
          resultFingerprint(baseline)
        ) {
          deterministic = false;
          break;
        }
      } catch {
        deterministic = false;
        break;
      }
    }
  }

  const performanceScenario = scenarios.find(
    (scenario) => scenario.id === "combined-hard-filters"
  );
  const durations: number[] = [];
  let performanceFailed = performanceScenario === undefined;
  if (performanceScenario !== undefined) {
    const performanceInput = buildInput(
      performanceScenario,
      dataSnapshotVersion,
      recommendationVersion
    );
    try {
      for (
        let run = 0;
        run < PERFORMANCE_WARMUP_RUNS;
        run += 1
      ) {
        execute(performanceScenario, performanceInput);
      }
      for (let run = 0; run < PERFORMANCE_RUNS; run += 1) {
        const startedAt = performance.now();
        execute(performanceScenario, performanceInput);
        durations.push(
          Math.ceil(performance.now() - startedAt)
        );
      }
    } catch {
      performanceFailed = true;
    }
  }

  const hitRateBasisPoints =
    successfulScenarios.length === 0
      ? 0
      : Math.floor(
          (hitCount * 10000) / successfulScenarios.length
        );
  const p95Ms = percentile95(durations);
  const fixtureShapePassed =
    scenarios.length === 20 &&
    new Set(scenarios.map((scenario) => scenario.id)).size ===
      scenarios.length &&
    successfulScenarios.length === 18 &&
    expectedErrorScenarios.length === 2;
  const passed =
    fixtureShapePassed &&
    successfulExecutionCount === successfulScenarios.length &&
    expectedErrorPassCount === expectedErrorScenarios.length &&
    hitRateBasisPoints >= HIT_RATE_GATE_BASIS_POINTS &&
    requiredHitViolationCount === 0 &&
    hardExclusionViolationCount === 0 &&
    statusViolationCount === 0 &&
    deterministic &&
    ratingOnlyInversionCount === 0 &&
    fallbackPassed &&
    !performanceFailed &&
    durations.length === PERFORMANCE_RUNS &&
    p95Ms < PERFORMANCE_P95_GATE_MS;

  return {
    fixtureId,
    totalScenarioCount: scenarios.length,
    hitRateScenarioCount: successfulScenarios.length,
    successfulExecutionCount,
    expectedErrorScenarioCount: expectedErrorScenarios.length,
    expectedErrorPassCount,
    hitRateBasisPoints,
    requiredHitViolationCount,
    hardExclusionViolationCount,
    statusViolationCount,
    deterministic,
    determinismRuns: DETERMINISM_RUNS,
    ratingOnlyInversionCount,
    fallbackPassed,
    performanceRuns: PERFORMANCE_RUNS,
    p95Ms,
    passed
  };
}
