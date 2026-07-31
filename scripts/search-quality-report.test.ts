import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  SearchEvaluationReport
} from "@bread-map/retrieval";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";
import {
  writeSearchQualityReport
} from "./search-quality-report.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-quality-report-")
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function passingReport(): SearchEvaluationReport {
  return {
    fixtureId: "search-evaluation-v1",
    totalScenarioCount: 20,
    hitRateScenarioCount: 18,
    successfulExecutionCount: 18,
    expectedErrorScenarioCount: 2,
    expectedErrorPassCount: 2,
    hitRateBasisPoints: 10_000,
    requiredHitViolationCount: 0,
    hardExclusionViolationCount: 0,
    statusViolationCount: 0,
    deterministic: true,
    determinismRuns: 100,
    ratingOnlyInversionCount: 0,
    fallbackPassed: true,
    performanceRuns: 100,
    p95Ms: 4,
    passed: true
  };
}

describe("search quality report", () => {
  it("writes the passing evaluation atomically in a stable schema", async () => {
    const outputPath = join(directory, "nested", "quality.json");

    await writeSearchQualityReport(outputPath, passingReport());

    const body = await readFile(outputPath, "utf8");
    expect(JSON.parse(body)).toEqual({
      schemaVersion: 1,
      gate: "search-quality",
      ...passingReport()
    });
    expect(body).not.toContain(directory);
    expect(body).not.toMatch(
      /origin|latitude|longitude|nickname|reviewBody|secret|token|sqlite/i
    );
  });

  it("rejects a failed or malformed evaluation", async () => {
    await expect(
      writeSearchQualityReport(join(directory, "failed.json"), {
        ...passingReport(),
        passed: false
      })
    ).rejects.toThrow("SEARCH_QUALITY_GATE_FAILED");
    await expect(
      writeSearchQualityReport(join(directory, "invalid.json"), {
        ...passingReport(),
        determinismRuns: 99
      })
    ).rejects.toThrow("SEARCH_QUALITY_REPORT_INVALID");
  });
});
