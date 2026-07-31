import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";
import {
  verifyReviewCheckpointResume
} from "./verify-review-resume.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-review-resume-gate-")
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("file-backed review checkpoint recovery", () => {
  it("closes after a committed interruption and resumes without duplicates", async () => {
    const report = await verifyReviewCheckpointResume({
      rawPath: join(directory, "raw.sqlite"),
      migrationsDirectory: resolve("drizzle/raw")
    });

    expect(report).toEqual({
      status: "VERIFIED",
      interruptionStatus: "PAUSED_BUDGET",
      interruptedAfterPage: 2,
      resumedFromPage: 3,
      finalStatus: "COMPLETE",
      encryptedReviewCount: 3,
      uniqueFingerprintCount: 3,
      duplicateCount: 0,
      finalCheckpointCount: 1
    });
  });
});
