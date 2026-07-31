import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import type {
  LocalMvpReleaseAuditReport
} from "./audit-local-mvp-release.js";
import {
  runLocalMvpVerification,
  type LocalMvpVerificationDependencies
} from "./verify-local-mvp.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-verifier-")
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const auditReport: LocalMvpReleaseAuditReport = {
  status: "VERIFIED",
  scannedSourceFileCount: 10,
  scannedBuildFileCount: 20,
  forbiddenReferenceCount: 0,
  loopbackBindVerified: true,
  fixedAuthOriginVerified: true,
  ignoredArtifactCount: 7,
  capturedOutputLeakCount: 0,
  findings: []
};

function dependencies(
  order: string[]
): LocalMvpVerificationDependencies {
  return {
    runUnitTests: vi.fn(async () => {
      order.push("unit");
      return { status: "PASSED", durationMs: 1, output: "unit ok" };
    }),
    prepareFixture: vi.fn(async () => {
      order.push("bootstrap");
      return {
        status: "VERIFIED",
        appMigrationCount: 6,
        rawMigrationCount: 3,
        catalogIngest: {
          readCount: 4,
          insertedCount: 3,
          updatedCount: 0,
          rejectedCount: 1,
          stagingRowCount: 3
        },
        search: {
          dataSnapshotVersion: `search-data-v1_${"a".repeat(64)}`,
          resultCount: 2,
          deterministic: true
        }
      };
    }),
    verifyReviewResume: vi.fn(async () => {
      order.push("review-resume");
      return {
        status: "VERIFIED",
        interruptionStatus: "PAUSED_BUDGET",
        interruptedAfterPage: 2,
        resumedFromPage: 3,
        finalStatus: "COMPLETE",
        encryptedReviewCount: 3,
        uniqueFingerprintCount: 3,
        duplicateCount: 0,
        finalCheckpointCount: 1
      };
    }),
    backupApp: vi.fn(async () => {
      order.push("backup");
    }),
    restoreApp: vi.fn(async () => {
      order.push("restore");
      return {
        status: "VERIFIED",
        snapshotFile: "snapshot.sqlite",
        destinationFile: "restored-app.sqlite",
        integrityCheck: "ok",
        foreignKeyViolationCount: 0,
        migrationCount: 6,
        applicationTableCount: 20,
        applicationRowCount: 40,
        reviewDocumentCount: 5,
        ftsDocumentCount: 5,
        logicalChecksum: "b".repeat(64),
        logicalChecksumMatchesSnapshot: true,
        representativeSearch: {
          dataSnapshotVersion: `search-data-v1_${"a".repeat(64)}`,
          resultCount: 2,
          deterministic: true,
          excludedStoreViolationCount: 0
        },
        swapCandidate: true
      };
    }),
    runSearchQuality: vi.fn(async () => {
      order.push("quality");
      return {
        schemaVersion: 1,
        gate: "search-quality",
        fixtureId: "search-evaluation-v1",
        totalScenarioCount: 20,
        hitRateScenarioCount: 18,
        successfulExecutionCount: 18,
        expectedErrorScenarioCount: 2,
        expectedErrorPassCount: 2,
        hitRateBasisPoints: 8_888,
        requiredHitViolationCount: 0,
        hardExclusionViolationCount: 0,
        statusViolationCount: 0,
        deterministic: true,
        determinismRuns: 100,
        ratingOnlyInversionCount: 0,
        fallbackPassed: true,
        performanceRuns: 100,
        p95Ms: 7,
        passed: true
      };
    }),
    runBuild: vi.fn(async () => {
      order.push("build");
      return { status: "PASSED", durationMs: 2, output: "build ok" };
    }),
    runBrowserE2e: vi.fn(async () => {
      order.push("browser");
      return { status: "PASSED", durationMs: 3, output: "6 passed" };
    }),
    auditRelease: vi.fn(async () => {
      order.push("audit");
      return auditReport;
    })
  };
}

describe("one-command local MVP verifier", () => {
  it("runs gates in order, writes a redacted report and cleans successful artifacts", async () => {
    const order: string[] = [];
    const reportPath = join(directory, "reports", "report.json");
    const runRoot = join(directory, "runs");

    const report = await runLocalMvpVerification({
      workspaceRoot: directory,
      runRoot,
      reportPath,
      runId: "run-success",
      authSecret: "sentinel-auth-secret",
      now: (() => {
        let value = Date.parse("2026-07-31T00:00:00.000Z");
        return () => (value += 1_000);
      })(),
      dependencies: dependencies(order)
    });

    expect(order).toEqual([
      "unit",
      "bootstrap",
      "review-resume",
      "backup",
      "restore",
      "quality",
      "build",
      "browser",
      "audit"
    ]);
    expect(report.status).toBe("VERIFIED");
    expect(report.cost).toEqual({
      openAiUsd: 0,
      externalNetworkCallCount: 0
    });
    expect(report.liveSmokes).toEqual({
      kakaoLogin: "NOT_RUN_CREDENTIALS_REQUIRED",
      kakaoMap: "NOT_RUN_CREDENTIALS_REQUIRED",
      kakaoReviewCollection: "SELECTOR_STOP_STATE_UNCONFIRMED",
      publicTunnel: "NOT_RUN_OPERATOR_ATTESTATION_REQUIRED"
    });
    const body = await readFile(reportPath, "utf8");
    expect(JSON.parse(body)).toEqual(report);
    expect(body).not.toContain(directory);
    expect(body).not.toContain("sentinel-auth-secret");
    expect(existsSync(join(runRoot, "run-success"))).toBe(false);
  });

  it("fails closed, skips later gates, writes a safe failure report and retains the run directory", async () => {
    const order: string[] = [];
    const mocked = dependencies(order);
    mocked.runBuild = vi.fn(async () => {
      order.push("build");
      throw new Error(`native build failed at ${directory}`);
    });
    const reportPath = join(directory, "report.json");
    const runRoot = join(directory, "runs");

    await expect(
      runLocalMvpVerification({
        workspaceRoot: directory,
        runRoot,
        reportPath,
        runId: "run-failed",
        authSecret: "sentinel-auth-secret",
        now: () => Date.parse("2026-07-31T00:00:00.000Z"),
        dependencies: mocked
      })
    ).rejects.toThrow("LOCAL_MVP_VERIFICATION_FAILED");

    expect(order).toEqual([
      "unit",
      "bootstrap",
      "review-resume",
      "backup",
      "restore",
      "quality",
      "build"
    ]);
    const body = await readFile(reportPath, "utf8");
    expect(JSON.parse(body)).toMatchObject({
      schemaVersion: 1,
      status: "FAILED",
      failureCode: "LOCAL_MVP_BUILD_FAILED"
    });
    expect(body).not.toContain(directory);
    expect(body).not.toContain("sentinel-auth-secret");
    expect(existsSync(join(runRoot, "run-failed"))).toBe(true);
  });
});
