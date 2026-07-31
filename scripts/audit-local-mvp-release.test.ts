import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";
import {
  auditLocalMvpRelease,
  assertLocalMvpReleaseAudit
} from "./audit-local-mvp-release.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "bread-map-release-audit-")
  );
  await mkdir(join(directory, "apps", "web", "src", "chat"), {
    recursive: true
  });
  await mkdir(join(directory, ".next", "server"), {
    recursive: true
  });
  await mkdir(join(directory, ".next", "static"), {
    recursive: true
  });
  await writeFile(
    join(directory, "apps", "web", "package.json"),
    JSON.stringify({
      scripts: {
        dev: "next dev --hostname 127.0.0.1",
        start: "next start --hostname 127.0.0.1"
      }
    }),
    "utf8"
  );
  await writeFile(
    join(directory, "apps", "web", "src", "auth-config.ts"),
    'export const AUTH_ORIGIN = "http://127.0.0.1:3000";',
    "utf8"
  );
  await writeFile(
    join(directory, "apps", "web", "src", "chat", "shell.tsx"),
    "export const composer = { disabled: true };",
    "utf8"
  );
  await writeFile(
    join(directory, ".next", "server", "app.js"),
    "export const localOnly = true;",
    "utf8"
  );
  await writeFile(
    join(directory, ".next", "static", "client.js"),
    "globalThis.__breadMap = 'local';",
    "utf8"
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("local MVP release audit", () => {
  it("accepts clean source/build output, loopback scripts, ignored artifacts and redacted output", async () => {
    const report = await auditLocalMvpRelease({
      repositoryRoot: directory,
      buildRoot: join(directory, ".next"),
      capturedOutput: "verification completed with counts only",
      forbiddenOutputValues: [
        "sentinel-secret",
        "sentinel-nickname",
        "sentinel raw review",
        "sentinel-provider-token",
        join(directory, "run", "app.sqlite")
      ],
      isIgnored: async () => true
    });

    expect(report).toEqual({
      status: "VERIFIED",
      scannedSourceFileCount: 2,
      scannedBuildFileCount: 2,
      forbiddenReferenceCount: 0,
      loopbackBindVerified: true,
      fixedAuthOriginVerified: true,
      ignoredArtifactCount: 7,
      capturedOutputLeakCount: 0,
      findings: []
    });
    expect(() => assertLocalMvpReleaseAudit(report)).not.toThrow();
  });

  it("finds runtime OpenAI, chat/route APIs and an active chat submit path", async () => {
    await writeFile(
      join(directory, "apps", "web", "src", "chat", "shell.tsx"),
      'import OpenAI from "openai"; export const x = <form onSubmit={send} />;',
      "utf8"
    );
    await writeFile(
      join(directory, ".next", "server", "app.js"),
      'fetch("/api/chat"); fetch("/api/routes");',
      "utf8"
    );

    const report = await auditLocalMvpRelease({
      repositoryRoot: directory,
      buildRoot: join(directory, ".next"),
      capturedOutput: "",
      forbiddenOutputValues: [],
      isIgnored: async () => true
    });

    expect(report.status).toBe("FAILED");
    expect(report.forbiddenReferenceCount).toBe(4);
    expect(report.findings.map((finding) => finding.code)).toEqual([
      "OPENAI_RUNTIME_REFERENCE",
      "ACTIVE_CHAT_SUBMIT",
      "CHAT_API_ROUTE",
      "ROUTE_API_ROUTE"
    ]);
    expect(() => assertLocalMvpReleaseAudit(report)).toThrow(
      "LOCAL_MVP_RELEASE_AUDIT_FAILED"
    );
  });

  it("fails closed for leaked values or a nonignored artifact", async () => {
    let calls = 0;
    const report = await auditLocalMvpRelease({
      repositoryRoot: directory,
      buildRoot: join(directory, ".next"),
      capturedOutput: "log contains sentinel-secret",
      forbiddenOutputValues: ["sentinel-secret"],
      isIgnored: async () => {
        calls += 1;
        return calls !== 4;
      }
    });

    expect(report.status).toBe("FAILED");
    expect(report.capturedOutputLeakCount).toBe(1);
    expect(report.ignoredArtifactCount).toBe(6);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CAPTURED_OUTPUT_LEAK" }),
        expect.objectContaining({ code: "ARTIFACT_NOT_IGNORED" })
      ])
    );
  });
});
