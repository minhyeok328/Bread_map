import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ReviewCollectionSummary } from "@bread-map/contracts";
import {
  migrateRawDatabase,
  openRawDatabase,
  type RawDatabaseHandle
} from "@bread-map/raw-db";
import {
  openReviewBrowserSession,
  type BrowserPageLike,
  type ReviewBrowserSession
} from "../reviews/browser-session.js";
import type {
  ReviewLocatorLike,
  ReviewPageLike,
  ReviewPageResult
} from "../reviews/extract-review-page.js";
import { extractReviewPage } from "../reviews/extract-review-page.js";
import {
  loadReviewDomContract,
  type ReviewDomContract
} from "../reviews/review-dom-contract.js";
import { loadReviewSecrets } from "../reviews/review-secrets.js";
import {
  runReviewBatch,
  type ReviewBatchTarget
} from "../reviews/run-review-batch.js";

interface ParsedArguments {
  fixturePath?: string;
  live: boolean;
  acknowledgePolicyRisk: boolean;
  onePage: boolean;
  pageCount: number;
  selectorContractPath?: string;
  rawPath?: string;
  runId?: string;
  discoveryRunId?: string;
}

export interface CollectReviewsCommandOptions {
  argv: string[];
  env?: Record<string, string | undefined>;
  stdout?: (line: string) => void;
  now?: () => number;
  asOfDate?: string;
}

export interface LiveNavigationResponse {
  status(): number;
  url(): string;
}

export interface LiveReviewPage
  extends BrowserPageLike,
    ReviewPageLike {
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded" }
  ): Promise<LiveNavigationResponse | null>;
}

export interface ReadLiveReviewPageOptions {
  page: LiveReviewPage;
  locator: string;
  pageNumber: number;
  contract: ReviewDomContract;
  asOfDate: string;
  assertSinglePage: () => void;
}

class FixtureLocator implements ReviewLocatorLike {
  constructor(
    private readonly countValue: number,
    private readonly value: string | null = null,
    private readonly children: Map<string, string | null>[] = []
  ) {}

  async count(): Promise<number> {
    return this.countValue;
  }

  async all(): Promise<ReviewLocatorLike[]> {
    return this.children.map(
      (fields) => new FixtureItemLocator(fields)
    );
  }

  locator(): ReviewLocatorLike {
    return new FixtureLocator(0);
  }

  async textContent(): Promise<string | null> {
    return this.value;
  }
}

class FixtureItemLocator implements ReviewLocatorLike {
  constructor(private readonly fields: Map<string, string | null>) {}

  async count(): Promise<number> {
    return 1;
  }

  async all(): Promise<ReviewLocatorLike[]> {
    return [this];
  }

  locator(selector: string): ReviewLocatorLike {
    if (!this.fields.has(selector)) {
      return new FixtureLocator(0);
    }
    return new FixtureLocator(1, this.fields.get(selector) ?? null);
  }

  async textContent(): Promise<string | null> {
    return null;
  }
}

function argumentValue(argv: string[], index: number): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("REVIEW_COLLECTION_ARGUMENT_INVALID");
  }
  return value;
}

function parseArguments(argv: string[]): ParsedArguments {
  const parsed: ParsedArguments = {
    live: false,
    acknowledgePolicyRisk: false,
    onePage: false,
    pageCount: 1
  };
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--fixture":
        parsed.fixturePath = argumentValue(argv, index);
        index += 1;
        break;
      case "--live":
        parsed.live = true;
        break;
      case "--acknowledge-policy-risk":
        parsed.acknowledgePolicyRisk = true;
        break;
      case "--one-page":
        parsed.onePage = true;
        break;
      case "--pages":
        parsed.pageCount = Number(argumentValue(argv, index));
        index += 1;
        break;
      case "--selector-contract":
        parsed.selectorContractPath = argumentValue(argv, index);
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
      case "--discovery-run":
        parsed.discoveryRunId = argumentValue(argv, index);
        index += 1;
        break;
      default:
        throw new Error("REVIEW_COLLECTION_ARGUMENT_INVALID");
    }
  }
  if (parsed.fixturePath === undefined && !parsed.live) {
    throw new Error("REVIEW_COLLECTION_MODE_REQUIRED");
  }
  if (parsed.fixturePath !== undefined && parsed.live) {
    throw new Error("REVIEW_COLLECTION_MODE_CONFLICT");
  }
  if (parsed.live && !parsed.acknowledgePolicyRisk) {
    throw new Error("REVIEW_POLICY_ACKNOWLEDGEMENT_REQUIRED");
  }
  if (parsed.live && !parsed.onePage) {
    throw new Error("REVIEW_ONE_PAGE_ACKNOWLEDGEMENT_REQUIRED");
  }
  if (
    !Number.isInteger(parsed.pageCount) ||
    parsed.pageCount !== 1
  ) {
    throw new Error("REVIEW_PAGE_LIMIT_EXCEEDED");
  }
  if (parsed.selectorContractPath === undefined && !parsed.live) {
    throw new Error("REVIEW_SELECTOR_CONTRACT_REQUIRED");
  }
  return parsed;
}

function repositoryRoot(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../.."
  );
}

function selectorAttribute(selector: string): string {
  const match = /^\[([a-z0-9-]+)\]$/iu.exec(selector);
  if (match?.[1] === undefined) {
    throw new Error("REVIEW_FIXTURE_INVALID");
  }
  return match[1];
}

function fixtureText(html: string, selector: string): string | null {
  const attribute = selectorAttribute(selector);
  const match = new RegExp(
    `<[^>]+${attribute}(?:=(?:"[^"]*"|'[^']*'))?[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "iu"
  ).exec(html);
  return match?.[1]?.replace(/<[^>]*>/gu, "").trim() ?? null;
}

function fixturePage(
  html: string,
  contract: ReviewDomContract
): ReviewPageLike {
  const itemAttribute = selectorAttribute(contract.reviewItem);
  const items = [
    ...html.matchAll(
      new RegExp(
        `<article[^>]+${itemAttribute}[^>]*>([\\s\\S]*?)<\\/article>`,
        "giu"
      )
    )
  ].map((match) => {
    const item = match[1] ?? "";
    return new Map<string, string | null>([
      [contract.body, fixtureText(item, contract.body)],
      [contract.rating, fixtureText(item, contract.rating)],
      [
        contract.publishedDate,
        fixtureText(item, contract.publishedDate)
      ],
      [contract.nickname, fixtureText(item, contract.nickname)]
    ]);
  });
  return {
    locator(selector: string): ReviewLocatorLike {
      if (selector === contract.reviewItem) {
        return new FixtureLocator(items.length, null, items);
      }
      const attribute = selectorAttribute(selector);
      return new FixtureLocator(
        html.includes(attribute) ? 1 : 0,
        fixtureText(html, selector)
      );
    }
  };
}

function seedFixtureTarget(rawDatabase: RawDatabaseHandle): void {
  rawDatabase.client
    .prepare(
      `INSERT INTO kakao_discovery_run (
         run_id, query, region_code, category_tag, status, active_slot,
         policy_snapshot_id, started_at_ms, finished_at_ms, expires_at_ms
       ) VALUES (
         'fixture_discovery', '빵집', 'SEOUL', '제과,베이커리',
         'COMPLETE', NULL, 'fixture-policy-v1', 0, 1, 34560000000
       )`
    )
    .run();
  rawDatabase.client
    .prepare(
      `INSERT INTO kakao_place_observation (
         observation_id, run_id, observation_key, display_name,
         normalized_name, category_name, category_tag, road_address,
         lot_address, phone, latitude_e7, longitude_e7, tile_key,
         page_number, match_status, matched_store_id, match_signals_json,
         observed_at_ms, expires_at_ms
       ) VALUES (
         'fixture_observation', 'fixture_discovery', ?,
         'Fixture Bakery', 'fixturebakery', '제과,베이커리',
         '제과,베이커리', '서울특별시 마포구 Fixture로 1', NULL,
         NULL, 375600000, 1269000000, '0', 1,
         'MATCHED_ELIGIBLE', 'fixture_store', '{}', 0, 34560000000
       )`
    )
    .run(Buffer.alloc(32, 1));
  rawDatabase.client
    .prepare(
      `INSERT INTO kakao_place_locator (
         locator_id, observation_id, provider, place_id, place_url,
         created_at_ms, delete_by_ms
       ) VALUES (
         'fixture_locator', 'fixture_observation', 'KAKAO',
         'fixture_place', 'https://place.map.kakao.com/fixture_place',
         0, 2592000000
       )`
    )
    .run();
}

function latestCompleteDiscovery(
  rawDatabase: RawDatabaseHandle
): string {
  const row = rawDatabase.client
    .prepare(
      `SELECT run_id
         FROM kakao_discovery_run
        WHERE status = 'COMPLETE'
        ORDER BY finished_at_ms DESC, run_id DESC
        LIMIT 1`
    )
    .get() as { run_id: string } | undefined;
  if (row === undefined) {
    throw new Error("REVIEW_DISCOVERY_RUN_REQUIRED");
  }
  return row.run_id;
}

function isKakaoPlaceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "place.map.kakao.com"
    );
  } catch {
    return false;
  }
}

export async function readLiveReviewPage({
  page,
  locator,
  pageNumber,
  contract,
  asOfDate,
  assertSinglePage
}: ReadLiveReviewPageOptions): Promise<ReviewPageResult> {
  if (pageNumber !== 1 || !isKakaoPlaceUrl(locator)) {
    return {
      status: "STOP_PROVIDER",
      reasonCode: "DOM_CONTRACT_CHANGED"
    };
  }

  let response: LiveNavigationResponse | null;
  try {
    response = await page.goto(locator, {
      waitUntil: "domcontentloaded"
    });
    assertSinglePage();
  } catch {
    return {
      status: "STOP_PROVIDER",
      reasonCode: "ACCESS_DENIED"
    };
  }
  if (
    response === null ||
    !isKakaoPlaceUrl(response.url()) ||
    response.status() < 200 ||
    response.status() >= 400
  ) {
    return {
      status: "STOP_PROVIDER",
      reasonCode: "ACCESS_DENIED"
    };
  }

  const result = await extractReviewPage(page, contract, {
    asOfDate,
    startIndex: 0,
    previousOldestPublishedDate: null
  });
  return result.status === "OK"
    ? { ...result, hasNext: false }
    : result;
}

export async function collectReviewsCommand({
  argv,
  env = process.env,
  stdout = (line) => console.log(line),
  now = Date.now,
  asOfDate = new Date().toISOString().slice(0, 10)
}: CollectReviewsCommandOptions): Promise<ReviewCollectionSummary> {
  const parsed = parseArguments(argv);
  const root = repositoryRoot();
  const contractPath =
    parsed.selectorContractPath ??
    env.KAKAO_REVIEW_SELECTOR_CONTRACT_PATH?.trim();
  if (contractPath === undefined || contractPath === "") {
    throw new Error("REVIEW_SELECTOR_CONTRACT_REQUIRED");
  }
  const contract = await loadReviewDomContract(contractPath);

  if (parsed.fixturePath !== undefined) {
    const html = await readFile(resolve(parsed.fixturePath), "utf8");
    const extracted = await extractReviewPage(
      fixturePage(html, contract),
      contract,
      {
        asOfDate,
        startIndex: 0,
        previousOldestPublishedDate: null
      }
    );
    const rawDatabase = openRawDatabase({ path: ":memory:" });
    try {
      migrateRawDatabase(rawDatabase, join(root, "drizzle", "raw"));
      seedFixtureTarget(rawDatabase);
      const summary = await runReviewBatch({
        rawDatabase,
        runId: parsed.runId ?? "fixture_review_run",
        discoveryRunId: "fixture_discovery",
        catalogSnapshotId: "fixture_catalog",
        policySnapshotId: "fixture-policy-v1",
        selectorContractVersion: contract.version,
        asOfDate,
        secrets: {
          encryptionKey: Buffer.alloc(32, 1),
          hmacKey: Buffer.alloc(32, 2),
          keyVersion: "fixture-key-v1"
        },
        now,
        pageSourceFactory: () => ({
          async readPage(): Promise<ReviewPageResult> {
            return extracted.status === "OK"
              ? { ...extracted, hasNext: false }
              : extracted;
          }
        })
      });
      stdout(JSON.stringify(summary));
      return summary;
    } finally {
      rawDatabase.close();
    }
  }

  const policySnapshotId =
    env.REVIEW_POLICY_SNAPSHOT_ID?.trim() ?? "";
  if (policySnapshotId === "") {
    throw new Error("REVIEW_LIVE_CONFIG_REQUIRED");
  }
  const secrets = loadReviewSecrets(env);
  const rawPath =
    parsed.rawPath ??
    (env.RAW_SQLITE_PATH?.trim() ||
      join(root, "var", "raw.sqlite"));
  const rawDatabase = openRawDatabase({ path: rawPath });
  let session: ReviewBrowserSession | undefined;

  try {
    migrateRawDatabase(rawDatabase, join(root, "drizzle", "raw"));
    const openedSession = await openReviewBrowserSession();
    session = openedSession;
    const discoveryRunId =
      parsed.discoveryRunId ?? latestCompleteDiscovery(rawDatabase);
    const page = openedSession.page as LiveReviewPage;
    const summary = await runReviewBatch({
      rawDatabase,
      runId: parsed.runId ?? `reviews_${now()}`,
      discoveryRunId,
      catalogSnapshotId: discoveryRunId,
      policySnapshotId,
      selectorContractVersion: contract.version,
      asOfDate,
      secrets,
      now,
      pageSourceFactory: (target: ReviewBatchTarget) => ({
        async readPage(pageNumber): Promise<ReviewPageResult> {
          return readLiveReviewPage({
            page,
            locator: target.locator,
            pageNumber,
            contract,
            asOfDate,
            assertSinglePage: () =>
              openedSession.assertSinglePage()
          });
        }
      })
    });
    stdout(JSON.stringify(summary));
    return summary;
  } finally {
    try {
      await session?.close();
    } finally {
      rawDatabase.close();
    }
  }
}

const invokedFile = process.argv[1];
if (
  invokedFile !== undefined &&
  pathToFileURL(resolve(invokedFile)).href === import.meta.url
) {
  collectReviewsCommand({ argv: process.argv.slice(2) }).catch(
    () => {
      console.error("Review collection failed.");
      process.exitCode = 1;
    }
  );
}
