import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverKakaoBakeriesCommand } from "./discover-kakao-bakeries.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("discover Kakao bakeries command", () => {
  it("runs the synthetic fixture and emits summary JSON only", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "bread-map-discovery-command-")
    );
    cleanupPaths.push(directory);
    const lines: string[] = [];
    const secret = "must-not-appear";

    const summary = await discoverKakaoBakeriesCommand({
      argv: [
        "--fixture",
        resolve(
          "apps/worker/src/reviews/__fixtures__/kakao-place-pages.json"
        ),
        "--app-db",
        join(directory, "app.sqlite"),
        "--raw-db",
        join(directory, "raw.sqlite")
      ],
      env: {
        KAKAO_REST_API_KEY: secret,
        REVIEW_POLICY_SNAPSHOT_ID: "private-policy-value"
      },
      stdout: (line) => lines.push(line),
      now: () => 1_000
    });

    expect(summary).toMatchObject({
      runId: "fixture_discovery_run",
      status: "COMPLETE",
      observedCount: 1,
      unmatchedCount: 1
    });
    expect(lines).toEqual([JSON.stringify(summary)]);
    expect(lines[0]).not.toContain(secret);
    expect(lines[0]).not.toContain("private-policy-value");
    expect(lines[0]).not.toContain("fixture-place-1");
    expect(lines[0]).not.toContain("place.map.kakao.com");
  });

  it("requires exactly one mode and live-only secrets", async () => {
    await expect(
      discoverKakaoBakeriesCommand({ argv: [] })
    ).rejects.toThrow("KAKAO_DISCOVERY_MODE_REQUIRED");
    await expect(
      discoverKakaoBakeriesCommand({
        argv: ["--fixture", "fixture.json", "--live"]
      })
    ).rejects.toThrow("KAKAO_DISCOVERY_MODE_CONFLICT");
    await expect(
      discoverKakaoBakeriesCommand({
        argv: ["--live"],
        env: {}
      })
    ).rejects.toThrow("KAKAO_DISCOVERY_LIVE_CONFIG_REQUIRED");
    await expect(
      discoverKakaoBakeriesCommand({
        argv: ["--live"],
        env: { KAKAO_REST_API_KEY: "fixture" }
      })
    ).rejects.toThrow("KAKAO_DISCOVERY_LIVE_CONFIG_REQUIRED");
  });
});
