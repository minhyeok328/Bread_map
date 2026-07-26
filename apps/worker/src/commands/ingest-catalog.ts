import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  migrateAppDatabase,
  openAppDatabase
} from "@bread-map/app-db";
import {
  localdataPageResponseSchema,
  type IngestionSummary
} from "@bread-map/contracts";
import { z } from "zod";
import { createLocaldataClient } from "../catalog/localdata-client.js";
import { runLocaldataIngestion } from "../catalog/run-ingestion.js";

const fixtureSchema = z.object({
  basisDate: z.string(),
  pages: z.array(z.unknown()).min(1)
});

interface ParsedArguments {
  fixturePath?: string;
  live: boolean;
  appPath?: string;
  basisDate?: string;
  pageSize?: number;
}

export interface IngestCatalogCommandOptions {
  argv: string[];
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  stdout?: (line: string) => void;
  now?: () => number;
}

function readArgumentValue(
  argv: string[],
  index: number
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("INGEST_ARGUMENT_INVALID");
  }
  return value;
}

function parseArguments(argv: string[]): ParsedArguments {
  const parsed: ParsedArguments = {
    live: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--fixture":
        parsed.fixturePath = readArgumentValue(argv, index);
        index += 1;
        break;
      case "--live":
        parsed.live = true;
        break;
      case "--app-db":
        parsed.appPath = readArgumentValue(argv, index);
        index += 1;
        break;
      case "--basis-date":
        parsed.basisDate = readArgumentValue(argv, index);
        index += 1;
        break;
      case "--page-size": {
        const value = readArgumentValue(argv, index);
        parsed.pageSize = Number(value);
        index += 1;
        break;
      }
      default:
        throw new Error("INGEST_ARGUMENT_INVALID");
    }
  }

  if (parsed.fixturePath === undefined && !parsed.live) {
    throw new Error("INGEST_MODE_REQUIRED");
  }
  if (parsed.fixturePath !== undefined && parsed.live) {
    throw new Error("INGEST_MODE_CONFLICT");
  }

  return parsed;
}

async function loadFixture(path: string): Promise<{
  basisDate: string;
  pages: unknown[];
}> {
  let body: string;
  try {
    body = await readFile(resolve(path), "utf8");
  } catch {
    throw new Error("LOCALDATA_FIXTURE_READ_FAILED");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    throw new Error("LOCALDATA_FIXTURE_INVALID");
  }

  const parsed = fixtureSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("LOCALDATA_FIXTURE_INVALID");
  }
  return parsed.data;
}

function createFixtureFetch(pages: unknown[]): typeof fetch {
  return async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input.toString()
    );
    const pageNo = Number(url.searchParams.get("pageNo"));
    const page = pages[pageNo - 1];
    return new Response(JSON.stringify(page), {
      status: page === undefined ? 404 : 200,
      headers: { "content-type": "application/json" }
    });
  };
}

function repositoryRoot(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../.."
  );
}

export async function ingestCatalogCommand({
  argv,
  env = process.env,
  fetchImpl,
  stdout = (line) => console.log(line),
  now
}: IngestCatalogCommandOptions): Promise<IngestionSummary> {
  const parsed = parseArguments(argv);
  const root = repositoryRoot();
  let basisDate: string;
  let serviceKey: string;
  let selectedFetch: typeof fetch | undefined;
  let pageSize: number;

  if (parsed.fixturePath !== undefined) {
    const fixture = await loadFixture(parsed.fixturePath);
    const firstPage = localdataPageResponseSchema.safeParse(
      fixture.pages[0]
    );
    if (!firstPage.success) {
      throw new Error("LOCALDATA_FIXTURE_INVALID");
    }
    basisDate = fixture.basisDate;
    serviceKey = "fixture-only-key";
    selectedFetch = createFixtureFetch(fixture.pages);
    pageSize = parsed.pageSize ?? firstPage.data.numOfRows;
  } else {
    serviceKey = env.DATA_GO_KR_SERVICE_KEY?.trim() ?? "";
    if (serviceKey.length === 0) {
      throw new Error("DATA_GO_KR_SERVICE_KEY_REQUIRED");
    }
    if (parsed.basisDate === undefined) {
      throw new Error("LOCALDATA_BASIS_DATE_REQUIRED");
    }
    basisDate = parsed.basisDate;
    selectedFetch = fetchImpl;
    pageSize = parsed.pageSize ?? 500;
  }

  const configuredAppPath =
    parsed.appPath ?? env.APP_SQLITE_PATH?.trim();
  const appPath =
    configuredAppPath === undefined || configuredAppPath.length === 0
      ? join(root, "var", "app.sqlite")
      : configuredAppPath;
  const database = openAppDatabase({ path: appPath });

  try {
    migrateAppDatabase(database, join(root, "drizzle", "app"));
    const clientOptions =
      selectedFetch === undefined
        ? { serviceKey }
        : { serviceKey, fetchImpl: selectedFetch };
    const summary = await runLocaldataIngestion({
      appDatabase: database,
      client: createLocaldataClient(clientOptions),
      basisDate,
      pageSize,
      ...(now === undefined ? {} : { now })
    });
    stdout(JSON.stringify(summary));
    return summary;
  } finally {
    database.close();
  }
}

const invokedFile = process.argv[1];
if (
  invokedFile !== undefined &&
  pathToFileURL(resolve(invokedFile)).href === import.meta.url
) {
  ingestCatalogCommand({ argv: process.argv.slice(2) }).catch(() => {
    console.error("Catalog ingestion failed.");
    process.exitCode = 1;
  });
}
