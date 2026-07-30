import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  migrateAppDatabase,
  openAppDatabase
} from "@bread-map/app-db";
import {
  publishSearchEvidence,
  type SearchEvidencePublishSummary
} from "../search-evidence/publish-search-evidence.js";

interface ParsedArguments {
  inputPath: string;
  appPath?: string;
}

export interface PublishSearchEvidenceCommandOptions {
  argv: string[];
  env?: Record<string, string | undefined>;
  stdout?: (line: string) => void;
  now?: () => number;
}

function readArgumentValue(
  argv: readonly string[],
  index: number
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("SEARCH_EVIDENCE_ARGUMENT_INVALID");
  }
  return value;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  let inputPath: string | undefined;
  let appPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--input":
        inputPath = readArgumentValue(argv, index);
        index += 1;
        break;
      case "--app-db":
        appPath = readArgumentValue(argv, index);
        index += 1;
        break;
      default:
        throw new Error("SEARCH_EVIDENCE_ARGUMENT_INVALID");
    }
  }
  if (inputPath === undefined) {
    throw new Error("SEARCH_EVIDENCE_INPUT_REQUIRED");
  }
  return appPath === undefined
    ? { inputPath }
    : { inputPath, appPath };
}

function repositoryRoot(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../.."
  );
}

async function loadJson(path: string): Promise<unknown> {
  let body: string;
  try {
    body = await readFile(resolve(path), "utf8");
  } catch {
    throw new Error("SEARCH_EVIDENCE_FILE_READ_FAILED");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("SEARCH_EVIDENCE_FILE_INVALID");
  }
}

export async function publishSearchEvidenceCommand({
  argv,
  env = process.env,
  stdout = (line) => console.log(line),
  now
}: PublishSearchEvidenceCommandOptions): Promise<SearchEvidencePublishSummary> {
  const parsed = parseArguments(argv);
  const root = repositoryRoot();
  const configuredAppPath =
    parsed.appPath ?? env.APP_SQLITE_PATH?.trim();
  const appPath =
    configuredAppPath === undefined ||
    configuredAppPath.length === 0
      ? join(root, "var", "app.sqlite")
      : configuredAppPath;
  const batch = await loadJson(parsed.inputPath);
  const database = openAppDatabase({ path: appPath });
  try {
    migrateAppDatabase(database, join(root, "drizzle", "app"));
    const summary = publishSearchEvidence({
      appDatabase: database,
      batch,
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
  publishSearchEvidenceCommand({
    argv: process.argv.slice(2)
  }).catch(() => {
    console.error("Search evidence publication failed.");
    process.exitCode = 1;
  });
}
