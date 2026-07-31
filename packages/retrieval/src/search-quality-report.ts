import {
  mkdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname } from "node:path";
import type {
  SearchEvaluationReport
} from "./search-evaluation.js";

export interface MachineReadableSearchQualityReport
  extends SearchEvaluationReport {
  schemaVersion: 1;
  gate: "search-quality";
}

function assertValidReport(
  report: SearchEvaluationReport
): void {
  if (
    report.fixtureId !== "search-evaluation-v1" ||
    report.totalScenarioCount !== 20 ||
    report.hitRateScenarioCount !== 18 ||
    report.successfulExecutionCount !== 18 ||
    report.expectedErrorScenarioCount !== 2 ||
    report.expectedErrorPassCount !== 2 ||
    report.determinismRuns !== 100 ||
    report.performanceRuns !== 100 ||
    !Number.isFinite(report.p95Ms) ||
    report.p95Ms < 0
  ) {
    throw new Error("SEARCH_QUALITY_REPORT_INVALID");
  }
  if (
    !report.passed ||
    report.hitRateBasisPoints < 8_500 ||
    report.requiredHitViolationCount !== 0 ||
    report.hardExclusionViolationCount !== 0 ||
    report.statusViolationCount !== 0 ||
    !report.deterministic ||
    report.ratingOnlyInversionCount !== 0 ||
    !report.fallbackPassed ||
    report.p95Ms >= 1_500
  ) {
    throw new Error("SEARCH_QUALITY_GATE_FAILED");
  }
}

export async function writeSearchQualityReport(
  outputPath: string,
  report: SearchEvaluationReport
): Promise<MachineReadableSearchQualityReport> {
  assertValidReport(report);
  const machineReport: MachineReadableSearchQualityReport = {
    schemaVersion: 1,
    gate: "search-quality",
    ...report
  };
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(machineReport, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    await rm(outputPath, { force: true });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return machineReport;
}
