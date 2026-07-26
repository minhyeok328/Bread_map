import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  migrateAppDatabase,
  openAppDatabase
} from "@bread-map/app-db";
import type { KakaoDiscoverySummary } from "@bread-map/contracts";
import {
  migrateRawDatabase,
  openRawDatabase
} from "@bread-map/raw-db";
import { z } from "zod";
import { createKakaoPlaceClient } from "../reviews/kakao-place-client.js";
import { runKakaoDiscovery } from "../reviews/run-kakao-discovery.js";

interface ParsedArguments {
  fixturePath?: string;
  live: boolean;
  appPath?: string;
  rawPath?: string;
  runId?: string;
}

export interface DiscoverKakaoBakeriesCommandOptions {
  argv: string[];
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  stdout?: (line: string) => void;
  now?: () => number;
}

const fixtureSchema = z.object({
  pages: z.array(z.unknown()).min(1)
});

function argumentValue(argv: string[], index: number): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("KAKAO_DISCOVERY_ARGUMENT_INVALID");
  }
  return value;
}

function parseArguments(argv: string[]): ParsedArguments {
  const parsed: ParsedArguments = { live: false };
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--fixture":
        parsed.fixturePath = argumentValue(argv, index);
        index += 1;
        break;
      case "--live":
        parsed.live = true;
        break;
      case "--app-db":
        parsed.appPath = argumentValue(argv, index);
        index += 1;
        break;
      case "--raw-db":
        parsed.rawPath = argumentValue(argv, index);
        index += 1;
        break;
      case "--run-id":
        parsed.runId = argumentValue(argv, index);
        index += 1;
        break;
      default:
        throw new Error("KAKAO_DISCOVERY_ARGUMENT_INVALID");
    }
  }
  if (parsed.fixturePath === undefined && !parsed.live) {
    throw new Error("KAKAO_DISCOVERY_MODE_REQUIRED");
  }
  if (parsed.fixturePath !== undefined && parsed.live) {
    throw new Error("KAKAO_DISCOVERY_MODE_CONFLICT");
  }
  return parsed;
}

function repositoryRoot(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../.."
  );
}

async function fixturePages(path: string): Promise<unknown[]> {
  try {
    const body = await readFile(resolve(path), "utf8");
    return fixtureSchema.parse(JSON.parse(body)).pages;
  } catch {
    throw new Error("KAKAO_DISCOVERY_FIXTURE_INVALID");
  }
}

function fixtureFetch(pages: unknown[]): typeof fetch {
  return async (input) => {
    const request = new Request(input);
    const pageNumber = Number(
      new URL(request.url).searchParams.get("page")
    );
    const page = pages[pageNumber - 1];
    return new Response(JSON.stringify(page), {
      status: page === undefined ? 404 : 200,
      headers: { "content-type": "application/json" }
    });
  };
}

export async function discoverKakaoBakeriesCommand({
  argv,
  env = process.env,
  fetchImpl,
  stdout = (line) => console.log(line),
  now = Date.now
}: DiscoverKakaoBakeriesCommandOptions): Promise<KakaoDiscoverySummary> {
  const parsed = parseArguments(argv);
  const root = repositoryRoot();
  let restApiKey: string;
  let policySnapshotId: string;
  let selectedFetch: typeof fetch | undefined;

  if (parsed.fixturePath !== undefined) {
    restApiKey = "fixture-only-key";
    policySnapshotId = "fixture-policy-v1";
    selectedFetch = fixtureFetch(
      await fixturePages(parsed.fixturePath)
    );
  } else {
    restApiKey = env.KAKAO_REST_API_KEY?.trim() ?? "";
    policySnapshotId =
      env.REVIEW_POLICY_SNAPSHOT_ID?.trim() ?? "";
    if (restApiKey === "" || policySnapshotId === "") {
      throw new Error("KAKAO_DISCOVERY_LIVE_CONFIG_REQUIRED");
    }
    selectedFetch = fetchImpl;
  }

  const appPath =
    parsed.appPath ??
    (parsed.fixturePath !== undefined
      ? ":memory:"
      : env.APP_SQLITE_PATH?.trim() ||
        join(root, "var", "app.sqlite"));
  const rawPath =
    parsed.rawPath ??
    (parsed.fixturePath !== undefined
      ? ":memory:"
      : env.RAW_SQLITE_PATH?.trim() ||
        join(root, "var", "raw.sqlite"));
  const appDatabase = openAppDatabase({ path: appPath });
  const rawDatabase = openRawDatabase({ path: rawPath });

  try {
    migrateAppDatabase(appDatabase, join(root, "drizzle", "app"));
    migrateRawDatabase(rawDatabase, join(root, "drizzle", "raw"));
    const client = createKakaoPlaceClient({
      restApiKey,
      ...(selectedFetch === undefined
        ? {}
        : { fetchImpl: selectedFetch })
    });
    const summary = await runKakaoDiscovery({
      appDatabase,
      rawDatabase,
      client,
      runId:
        parsed.runId ??
        (parsed.fixturePath === undefined
          ? `discovery_${now()}`
          : "fixture_discovery_run"),
      policySnapshotId,
      now
    });
    stdout(JSON.stringify(summary));
    return summary;
  } finally {
    appDatabase.close();
    rawDatabase.close();
  }
}

const invokedFile = process.argv[1];
if (
  invokedFile !== undefined &&
  pathToFileURL(resolve(invokedFile)).href === import.meta.url
) {
  discoverKakaoBakeriesCommand({
    argv: process.argv.slice(2)
  }).catch(() => {
    console.error("Kakao bakery discovery failed.");
    process.exitCode = 1;
  });
}
