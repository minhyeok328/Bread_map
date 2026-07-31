import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

export type LocalMvpAuditFindingCode =
  | "OPENAI_RUNTIME_REFERENCE"
  | "CHAT_API_ROUTE"
  | "ROUTE_API_ROUTE"
  | "ACTIVE_CHAT_SUBMIT"
  | "LOOPBACK_BIND_MISSING"
  | "FIXED_AUTH_ORIGIN_MISSING"
  | "ARTIFACT_NOT_IGNORED"
  | "CAPTURED_OUTPUT_LEAK";

export interface LocalMvpAuditFinding {
  code: LocalMvpAuditFindingCode;
  scope: "source" | "build" | "config" | "ignore" | "output";
  file: string | null;
}

export interface LocalMvpReleaseAuditReport {
  status: "VERIFIED" | "FAILED";
  scannedSourceFileCount: number;
  scannedBuildFileCount: number;
  forbiddenReferenceCount: number;
  loopbackBindVerified: boolean;
  fixedAuthOriginVerified: boolean;
  ignoredArtifactCount: number;
  capturedOutputLeakCount: number;
  findings: LocalMvpAuditFinding[];
}

export interface AuditLocalMvpReleaseOptions {
  repositoryRoot: string;
  buildRoot: string;
  capturedOutput: string;
  forbiddenOutputValues: readonly string[];
  isIgnored?: (relativePath: string) => Promise<boolean>;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs"
]);

const IGNORED_ARTIFACT_FIXTURES = [
  "var/local-mvp-verification/run/app.sqlite",
  "var/local-mvp-verification/run/app.sqlite-wal",
  "var/local-mvp-verification/run/app.sqlite-shm",
  "var/local-mvp-verification/run/restored-app.sqlite",
  "backups/app.sqlite",
  ".env.local",
  "test-results/local-mvp/report.json"
] as const;

async function listTextFiles(
  root: string,
  excludeTests: boolean
): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (
        !entry.isFile() ||
        !SOURCE_EXTENSIONS.has(extname(entry.name)) ||
        (excludeTests && /\.(?:test|spec)\.[^.]+$/u.test(entry.name))
      ) {
        continue;
      }
      files.push(path);
    }
  }
  await visit(root);
  return files;
}

function relativeFile(repositoryRoot: string, path: string): string {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

async function scanFiles(
  repositoryRoot: string,
  files: readonly string[],
  scope: "source" | "build"
): Promise<LocalMvpAuditFinding[]> {
  const findings: LocalMvpAuditFinding[] = [];
  for (const path of files) {
    const body = await readFile(path, "utf8");
    const file = relativeFile(repositoryRoot, path);
    if (
      /(?:from\s*["']openai["']|require\(\s*["']openai["']\s*\)|\bnew\s+OpenAI\b|api\.openai\.com)/iu.test(
        body
      )
    ) {
      findings.push({
        code: "OPENAI_RUNTIME_REFERENCE",
        scope,
        file
      });
    }
    if (
      file.includes("/chat/") &&
      /(?:\bonSubmit\s*=|addEventListener\(\s*["']submit["'])/u.test(
        body
      )
    ) {
      findings.push({ code: "ACTIVE_CHAT_SUBMIT", scope, file });
    }
    if (/\/api\/chat(?:\b|\/)/u.test(body)) {
      findings.push({ code: "CHAT_API_ROUTE", scope, file });
    }
    if (/\/api\/routes(?:\b|\/)/u.test(body)) {
      findings.push({ code: "ROUTE_API_ROUTE", scope, file });
    }
  }
  return findings;
}

async function readUtf8OrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function defaultIgnoreChecker(
  repositoryRoot: string
): (relativePath: string) => Promise<boolean> {
  return async (relativePath) => {
    const result = spawnSync(
      "git",
      ["check-ignore", "--quiet", "--", relativePath],
      {
        cwd: repositoryRoot,
        stdio: "ignore",
        windowsHide: true
      }
    );
    return result.status === 0;
  };
}

function normalizedLeakText(value: string): string {
  return value.replaceAll("\\", "/").toLocaleLowerCase("en-US");
}

export async function auditLocalMvpRelease(
  options: AuditLocalMvpReleaseOptions
): Promise<LocalMvpReleaseAuditReport> {
  const sourceFiles = await listTextFiles(
    join(options.repositoryRoot, "apps", "web", "src"),
    true
  );
  const buildFiles = await listTextFiles(options.buildRoot, false);
  const findings = [
    ...(await scanFiles(
      options.repositoryRoot,
      sourceFiles,
      "source"
    )),
    ...(await scanFiles(
      options.repositoryRoot,
      buildFiles,
      "build"
    ))
  ];
  const forbiddenReferenceCount = findings.length;

  const packageBody = await readUtf8OrEmpty(
    join(options.repositoryRoot, "apps", "web", "package.json")
  );
  let loopbackBindVerified = false;
  try {
    const manifest = JSON.parse(packageBody) as {
      scripts?: Record<string, unknown>;
    };
    loopbackBindVerified = ["dev", "start"].every((name) => {
      const value = manifest.scripts?.[name];
      return (
        typeof value === "string" &&
        /--hostname\s+127\.0\.0\.1(?:\s|$)/u.test(value)
      );
    });
  } catch {
    loopbackBindVerified = false;
  }
  if (!loopbackBindVerified) {
    findings.push({
      code: "LOOPBACK_BIND_MISSING",
      scope: "config",
      file: "apps/web/package.json"
    });
  }

  const authConfigBody = await readUtf8OrEmpty(
    join(
      options.repositoryRoot,
      "apps",
      "web",
      "src",
      "auth-config.ts"
    )
  );
  const fixedAuthOriginVerified =
    authConfigBody.includes(
      'AUTH_ORIGIN = "http://127.0.0.1:3000"'
    );
  if (!fixedAuthOriginVerified) {
    findings.push({
      code: "FIXED_AUTH_ORIGIN_MISSING",
      scope: "config",
      file: "apps/web/src/auth-config.ts"
    });
  }

  const isIgnored =
    options.isIgnored ?? defaultIgnoreChecker(options.repositoryRoot);
  let ignoredArtifactCount = 0;
  for (const artifact of IGNORED_ARTIFACT_FIXTURES) {
    if (await isIgnored(artifact)) {
      ignoredArtifactCount += 1;
    } else {
      findings.push({
        code: "ARTIFACT_NOT_IGNORED",
        scope: "ignore",
        file: artifact
      });
    }
  }

  const normalizedOutput = normalizedLeakText(
    options.capturedOutput
  );
  let capturedOutputLeakCount = 0;
  for (const value of new Set(options.forbiddenOutputValues)) {
    if (
      value.length >= 4 &&
      normalizedOutput.includes(normalizedLeakText(value))
    ) {
      capturedOutputLeakCount += 1;
      findings.push({
        code: "CAPTURED_OUTPUT_LEAK",
        scope: "output",
        file: null
      });
    }
  }

  return {
    status: findings.length === 0 ? "VERIFIED" : "FAILED",
    scannedSourceFileCount: sourceFiles.length,
    scannedBuildFileCount: buildFiles.length,
    forbiddenReferenceCount,
    loopbackBindVerified,
    fixedAuthOriginVerified,
    ignoredArtifactCount,
    capturedOutputLeakCount,
    findings
  };
}

export function assertLocalMvpReleaseAudit(
  report: LocalMvpReleaseAuditReport
): void {
  if (report.status !== "VERIFIED") {
    throw new Error("LOCAL_MVP_RELEASE_AUDIT_FAILED");
  }
}
