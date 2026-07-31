import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  MachineReadableSearchQualityReport
} from "../packages/retrieval/src/search-quality-report.js";
import {
  restoreAppDatabase,
  type RestoreAppDatabaseOptions,
  type RestoreAppDatabaseReport
} from "../apps/worker/src/recovery/restore-app-database.js";
import {
  verifyReviewCheckpointResume,
  type ReviewCheckpointResumeReport,
  type VerifyReviewCheckpointResumeOptions
} from "../apps/worker/src/recovery/verify-review-resume.js";
import {
  auditLocalMvpRelease,
  assertLocalMvpReleaseAudit,
  type AuditLocalMvpReleaseOptions,
  type LocalMvpReleaseAuditReport
} from "./audit-local-mvp-release.js";
import {
  backupAppDatabase
} from "./backup-app-database.js";
import {
  prepareLocalMvpFixture,
  type LocalMvpFixtureReport,
  type PrepareLocalMvpFixtureOptions
} from "./prepare-local-mvp-fixture.js";

export interface CommandGateReport {
  status: "PASSED";
  durationMs: number;
  output: string;
}

export interface LocalMvpVerificationDependencies {
  runUnitTests(): Promise<CommandGateReport>;
  prepareFixture(
    options: PrepareLocalMvpFixtureOptions
  ): Promise<LocalMvpFixtureReport>;
  verifyReviewResume(
    options: VerifyReviewCheckpointResumeOptions
  ): Promise<ReviewCheckpointResumeReport>;
  backupApp(options: {
    appPath: string;
    outputPath: string;
  }): Promise<void>;
  restoreApp(
    options: RestoreAppDatabaseOptions
  ): Promise<RestoreAppDatabaseReport>;
  runSearchQuality(
    outputPath: string
  ): Promise<MachineReadableSearchQualityReport>;
  runBuild(): Promise<CommandGateReport>;
  runBrowserE2e(options: {
    appPath: string;
    authSecret: string;
  }): Promise<CommandGateReport>;
  auditRelease(
    options: AuditLocalMvpReleaseOptions
  ): Promise<LocalMvpReleaseAuditReport>;
}

export interface LocalMvpVerificationReport {
  schemaVersion: 1;
  status: "VERIFIED";
  runId: string;
  startedAt: string;
  finishedAt: string;
  gates: {
    unitTests: Omit<CommandGateReport, "output">;
    bootstrap: LocalMvpFixtureReport;
    reviewResume: ReviewCheckpointResumeReport;
    recovery: RestoreAppDatabaseReport;
    searchQuality: MachineReadableSearchQualityReport;
    productionBuild: Omit<CommandGateReport, "output">;
    browserE2e: Omit<CommandGateReport, "output">;
    releaseAudit: LocalMvpReleaseAuditReport;
  };
  cost: {
    openAiUsd: 0;
    externalNetworkCallCount: 0;
  };
  liveSmokes: {
    kakaoLogin: "NOT_RUN_CREDENTIALS_REQUIRED";
    kakaoMap: "NOT_RUN_CREDENTIALS_REQUIRED";
    kakaoReviewCollection: "SELECTOR_STOP_STATE_UNCONFIRMED";
    publicTunnel: "NOT_RUN_OPERATOR_ATTESTATION_REQUIRED";
  };
}

export interface RunLocalMvpVerificationOptions {
  workspaceRoot: string;
  runRoot: string;
  reportPath: string;
  runId: string;
  authSecret: string;
  now?: () => number;
  dependencies?: LocalMvpVerificationDependencies;
  progress?: (message: string) => void;
}

const LIVE_SMOKES = {
  kakaoLogin: "NOT_RUN_CREDENTIALS_REQUIRED",
  kakaoMap: "NOT_RUN_CREDENTIALS_REQUIRED",
  kakaoReviewCollection: "SELECTOR_STOP_STATE_UNCONFIRMED",
  publicTunnel: "NOT_RUN_OPERATOR_ATTESTATION_REQUIRED"
} as const;

const FAILURE_CODES = {
  unitTests: "LOCAL_MVP_UNIT_TESTS_FAILED",
  bootstrap: "LOCAL_MVP_BOOTSTRAP_FAILED",
  reviewResume: "LOCAL_MVP_REVIEW_RESUME_FAILED",
  recovery: "LOCAL_MVP_RECOVERY_FAILED",
  searchQuality: "LOCAL_MVP_SEARCH_QUALITY_FAILED",
  productionBuild: "LOCAL_MVP_BUILD_FAILED",
  browserE2e: "LOCAL_MVP_BROWSER_E2E_FAILED",
  releaseAudit: "LOCAL_MVP_RELEASE_AUDIT_FAILED"
} as const;

type VerificationGate = keyof typeof FAILURE_CODES;

function publicCommandReport(
  report: CommandGateReport
): Omit<CommandGateReport, "output"> {
  return {
    status: report.status,
    durationMs: report.durationMs
  };
}

async function writeJsonAtomically(
  path: string,
  value: unknown
): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    await rm(path, { force: true });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function runChildProcess(options: {
  command: string;
  arguments: readonly string[];
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<CommandGateReport> {
  return new Promise((resolvePromise, reject) => {
    const startedAt = performance.now();
    const child = spawn(options.command, options.arguments, {
      cwd: options.cwd,
      env: options.environment ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? 240_000);
    timeout.unref?.();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("LOCAL_MVP_CHILD_PROCESS_FAILED"));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (timedOut || code !== 0) {
        reject(new Error("LOCAL_MVP_CHILD_PROCESS_FAILED"));
        return;
      }
      resolvePromise({
        status: "PASSED",
        durationMs: Math.ceil(performance.now() - startedAt),
        output
      });
    });
  });
}

function pnpmInvocation(
  workspaceRoot: string,
  arguments_: readonly string[],
  environment?: NodeJS.ProcessEnv
): Promise<CommandGateReport> {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli === undefined || pnpmCli.length === 0) {
    throw new Error("LOCAL_MVP_PNPM_RUNTIME_REQUIRED");
  }
  return runChildProcess({
    command: process.execPath,
    arguments: [pnpmCli, ...arguments_],
    cwd: workspaceRoot,
    ...(environment === undefined ? {} : { environment })
  });
}

function defaultDependencies(
  workspaceRoot: string
): LocalMvpVerificationDependencies {
  const vitestCli = resolve(
    workspaceRoot,
    "node_modules",
    "vitest",
    "vitest.mjs"
  );
  const focusedUnitFiles = [
    "apps/worker/src/recovery/restore-app-database.test.ts",
    "apps/worker/src/recovery/verify-review-resume.test.ts",
    "apps/web/src/auth-error.test.ts",
    "scripts/audit-local-mvp-release.test.ts",
    "scripts/prepare-local-mvp-fixture.test.ts",
    "scripts/search-quality-report.test.ts",
    "scripts/verify-local-mvp.test.ts"
  ];
  return {
    runUnitTests: () =>
      runChildProcess({
        command: process.execPath,
        arguments: [vitestCli, "run", ...focusedUnitFiles],
        cwd: workspaceRoot
      }),
    prepareFixture: prepareLocalMvpFixture,
    verifyReviewResume: verifyReviewCheckpointResume,
    async backupApp(options) {
      await backupAppDatabase(options);
    },
    restoreApp: restoreAppDatabase,
    async runSearchQuality(outputPath) {
      await runChildProcess({
        command: process.execPath,
        arguments: [
          vitestCli,
          "run",
          "packages/retrieval/src/search-evaluation.test.ts"
        ],
        cwd: workspaceRoot,
        environment: {
          ...process.env,
          LOCAL_MVP_SEARCH_QUALITY_REPORT_PATH: outputPath
        }
      });
      return JSON.parse(
        await readFile(outputPath, "utf8")
      ) as MachineReadableSearchQualityReport;
    },
    runBuild: () => pnpmInvocation(workspaceRoot, ["build"]),
    runBrowserE2e({ appPath, authSecret }) {
      return pnpmInvocation(
        workspaceRoot,
        [
          "--filter",
          "@bread-map/web",
          "exec",
          "playwright",
          "test",
          "--config",
          "playwright.local-mvp.config.ts"
        ],
        {
          ...process.env,
          LOCAL_MVP_APP_SQLITE_PATH: appPath,
          LOCAL_MVP_AUTH_SECRET: authSecret
        }
      );
    },
    auditRelease: auditLocalMvpRelease
  };
}

export async function runLocalMvpVerification(
  options: RunLocalMvpVerificationOptions
): Promise<LocalMvpVerificationReport> {
  const now = options.now ?? Date.now;
  const dependencies =
    options.dependencies ?? defaultDependencies(options.workspaceRoot);
  const progress = options.progress ?? (() => undefined);
  const startedAt = new Date(now()).toISOString();
  const runDirectory = join(options.runRoot, options.runId);
  const appPath = join(runDirectory, "app.sqlite");
  const rawPath = join(runDirectory, "raw.sqlite");
  const snapshotPath = join(runDirectory, "snapshot.sqlite");
  const restoredPath = join(runDirectory, "restored-app.sqlite");
  const qualityPath = join(runDirectory, "search-quality.json");
  const appMigrationsDirectory = resolve(
    options.workspaceRoot,
    "drizzle/app"
  );
  const rawMigrationsDirectory = resolve(
    options.workspaceRoot,
    "drizzle/raw"
  );
  let currentGate: VerificationGate = "unitTests";
  await mkdir(options.runRoot, { recursive: true });
  await mkdir(runDirectory, { recursive: false });

  try {
    progress("unit-tests");
    const unitTests = await dependencies.runUnitTests();

    currentGate = "bootstrap";
    progress("bootstrap");
    const bootstrap = await dependencies.prepareFixture({
      appPath,
      rawPath,
      appMigrationsDirectory,
      rawMigrationsDirectory,
      catalogFixturePath: resolve(
        options.workspaceRoot,
        "apps/worker/src/catalog/__fixtures__/localdata-seoul.json"
      )
    });

    currentGate = "reviewResume";
    progress("review-resume");
    const reviewResume = await dependencies.verifyReviewResume({
      rawPath,
      migrationsDirectory: rawMigrationsDirectory
    });

    currentGate = "recovery";
    progress("backup-restore");
    await dependencies.backupApp({
      appPath,
      outputPath: snapshotPath
    });
    const recovery = await dependencies.restoreApp({
      snapshotPath,
      destinationPath: restoredPath,
      migrationsDirectory: appMigrationsDirectory,
      requestTimeMs: Date.parse("2026-07-30T12:00:00+09:00"),
      expectedExcludedStoreIds: ["store_hidden"]
    });

    currentGate = "searchQuality";
    progress("search-quality");
    const searchQuality =
      await dependencies.runSearchQuality(qualityPath);
    if (searchQuality.passed !== true) {
      throw new Error("LOCAL_MVP_SEARCH_QUALITY_FAILED");
    }

    currentGate = "productionBuild";
    progress("production-build");
    const productionBuild = await dependencies.runBuild();

    currentGate = "browserE2e";
    progress("browser-e2e");
    const browserE2e = await dependencies.runBrowserE2e({
      appPath,
      authSecret: options.authSecret
    });

    currentGate = "releaseAudit";
    progress("release-audit");
    const releaseAudit = await dependencies.auditRelease({
      repositoryRoot: options.workspaceRoot,
      buildRoot: resolve(
        options.workspaceRoot,
        "apps/web/.next"
      ),
      capturedOutput: [
        unitTests.output,
        productionBuild.output,
        browserE2e.output
      ].join("\n"),
      forbiddenOutputValues: [
        options.authSecret,
        appPath,
        rawPath,
        "synthetic-author-1",
        "sanitized fixture review 1",
        "encrypted-fixture-"
      ]
    });
    assertLocalMvpReleaseAudit(releaseAudit);

    const report: LocalMvpVerificationReport = {
      schemaVersion: 1,
      status: "VERIFIED",
      runId: options.runId,
      startedAt,
      finishedAt: new Date(now()).toISOString(),
      gates: {
        unitTests: publicCommandReport(unitTests),
        bootstrap,
        reviewResume,
        recovery,
        searchQuality,
        productionBuild: publicCommandReport(productionBuild),
        browserE2e: publicCommandReport(browserE2e),
        releaseAudit
      },
      cost: {
        openAiUsd: 0,
        externalNetworkCallCount: 0
      },
      liveSmokes: LIVE_SMOKES
    };
    await writeJsonAtomically(options.reportPath, report);
    await rm(runDirectory, { recursive: true, force: true });
    return report;
  } catch (error) {
    void error;
    await writeJsonAtomically(options.reportPath, {
      schemaVersion: 1,
      status: "FAILED",
      runId: options.runId,
      startedAt,
      finishedAt: new Date(now()).toISOString(),
      failureCode: FAILURE_CODES[currentGate],
      cost: {
        openAiUsd: 0,
        externalNetworkCallCount: 0
      },
      liveSmokes: LIVE_SMOKES
    });
    throw new Error("LOCAL_MVP_VERIFICATION_FAILED");
  }
}

const invokedFile = process.argv[1];
if (
  invokedFile !== undefined &&
  pathToFileURL(resolve(invokedFile)).href === import.meta.url
) {
  const workspaceRoot = resolve(import.meta.dirname, "..");
  runLocalMvpVerification({
    workspaceRoot,
    runRoot: resolve(
      workspaceRoot,
      "var/local-mvp-verification"
    ),
    reportPath: resolve(
      workspaceRoot,
      "test-results/local-mvp/report.json"
    ),
    runId: randomUUID(),
    authSecret: randomBytes(48).toString("base64url"),
    progress: (gate) => console.log(`local-mvp gate: ${gate}`)
  })
    .then(() => console.log("Local MVP verification passed."))
    .catch(() => {
      console.error("Local MVP verification failed.");
      process.exitCode = 1;
    });
}
