import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findForbiddenLocalMvpDependencies,
  findForbiddenPublicSearchContractFields,
  findForbiddenWebDependencies,
  findForbiddenWebRetrievalImports,
  findForbiddenWebRuntimeReferences,
  findWebRuntimeSourceFiles
} from "./check-workspace-boundaries.js";

describe("findForbiddenWebDependencies", () => {
  it("rejects raw-db in any web dependency group", () => {
    const manifest = {
      dependencies: {
        "@bread-map/raw-db": "workspace:*"
      }
    };

    expect(findForbiddenWebDependencies(manifest)).toEqual([
      "dependencies.@bread-map/raw-db"
    ]);
  });

  it("allows the approved web package boundary", () => {
    const manifest = {
      dependencies: {
        "@bread-map/app-db": "workspace:*",
        "@bread-map/contracts": "workspace:*",
        "@bread-map/recommendation": "workspace:*"
      }
    };

    expect(findForbiddenWebDependencies(manifest)).toEqual([]);
  });
});

describe("findForbiddenWebRuntimeReferences", () => {
  it("includes build-time Next config files in the web runtime scan", async () => {
    const webRoot = await mkdtemp(join(tmpdir(), "bread-map-boundary-"));

    try {
      await mkdir(join(webRoot, "src"));
      await writeFile(join(webRoot, "src", "page.tsx"), "export default null;");
      await writeFile(
        join(webRoot, "next.config.ts"),
        "export default {};"
      );
      await writeFile(
        join(webRoot, "next.config.mjs"),
        "export default {};"
      );
      await writeFile(join(webRoot, "README.md"), "not executable");

      const files = await findWebRuntimeSourceFiles(webRoot);

      expect(files.map((path) => basename(path))).toEqual([
        "next.config.mjs",
        "next.config.ts",
        "page.tsx"
      ]);
    } finally {
      await rm(webRoot, { recursive: true, force: true });
    }
  });

  it.each([
    "RAW_SQLITE_PATH",
    "raw.sqlite",
    "KAKAO_REST_API_KEY",
    "REVIEW_ENCRYPTION_KEY_BASE64",
    "REVIEW_HMAC_KEY_BASE64",
    "collect-reviews",
    "run-review-batch",
    "review_seen_fingerprint",
    "review_store_sync_state",
    "review-sync-state",
    "acknowledge-expanded-volume-risk",
    "resume-run"
  ])("rejects %s in web source", (reference) => {
    expect(findForbiddenWebRuntimeReferences(reference)).toEqual([
      reference
    ]);
  });

  it("rejects the worker package in any web dependency group", () => {
    const manifest = {
      dependencies: {
        "@bread-map/worker": "workspace:*"
      }
    };

    expect(findForbiddenWebDependencies(manifest)).toEqual([
      "dependencies.@bread-map/worker"
    ]);
  });

  it("rejects direct imports of the worker-only review publisher", () => {
    const source =
      'import { publishReviewRun } from "../../../worker/src/reviews/publish-review";';

    expect(findForbiddenWebRuntimeReferences(source)).toEqual([
      "/worker/src/",
      "publish-review",
      "publishReviewRun"
    ]);
  });

  it("rejects cross-app worker imports even when sensitive symbols are aliased", () => {
    const source =
      'import * as unsafe from "../../../worker/src/reviews/encrypt-raw-review";';

    expect(findForbiddenWebRuntimeReferences(source)).toEqual([
      "/worker/src/"
    ]);
  });

  it.each([
    "sqlite-store-search-repository",
    "createSqliteStoreSearchRepository",
    "SqliteStoreSearchRepository",
    "StoreSearchRepository",
    "runSqliteSearchReadTransaction",
    "executeStoreSearch",
    "sqlite-review-repository",
    "createSqliteReviewRepository",
    "SqliteReviewRepository",
    "ReviewRepository",
    "searchStoreEvidence",
    "RecommendationCandidateFacts",
    "DerivedCandidateFacts",
    "RankableCandidate",
    "ReviewEvidenceFact",
    "internalRank",
    "adjustedRating"
  ])("rejects server-internal search symbol %s in web source", (reference) => {
    expect(findForbiddenWebRuntimeReferences(reference)).toEqual([
      reference
    ]);
  });

  it("rejects relative and package-alias imports of raw-db source", () => {
    const relativeImport =
      'import * as raw from "../../../packages/raw-db/src/index";';
    const packageImport =
      'import * as raw from "@bread-map/raw-db";';

    expect(
      findForbiddenWebRuntimeReferences(relativeImport)
    ).toEqual(["/raw-db/src/", "packages/raw-db"]);
    expect(
      findForbiddenWebRuntimeReferences(packageImport)
    ).toEqual(["@bread-map/raw-db"]);
  });
});

describe("findForbiddenWebRetrievalImports", () => {
  it("allows only the Feature 8 safe SQLite facade and error type", () => {
    const source = `
      import {
        executeSqliteStoreSearch,
        resolveCurrentSqliteSearchDataVersion,
        StoreSearchError
      } from "@bread-map/retrieval";
    `;

    expect(findForbiddenWebRetrievalImports(source)).toEqual([]);
  });

  it("rejects namespace, default, and internal named retrieval imports", () => {
    expect(
      findForbiddenWebRetrievalImports(
        'import * as retrieval from "@bread-map/retrieval";'
      )
    ).toEqual(["RETRIEVAL_IMPORT_STYLE"]);
    expect(
      findForbiddenWebRetrievalImports(
        'import retrieval from "@bread-map/retrieval";'
      )
    ).toEqual(["RETRIEVAL_IMPORT_STYLE"]);
    expect(
      findForbiddenWebRetrievalImports(`
        import {
          executeSqliteStoreSearch,
          createSqliteReviewRepository as unsafeReview
        } from "@bread-map/retrieval";
      `)
    ).toEqual(["createSqliteReviewRepository"]);
  });

  it("rejects deep, dynamic, side-effect, and require retrieval access", () => {
    expect(
      findForbiddenWebRetrievalImports(
        'import { unsafe } from "@bread-map/retrieval/internal";'
      )
    ).toEqual(["RETRIEVAL_IMPORT_PATH"]);
    expect(
      findForbiddenWebRetrievalImports(
        'const retrieval = await import("@bread-map/retrieval");'
      )
    ).toEqual(["RETRIEVAL_IMPORT_STYLE"]);
    expect(
      findForbiddenWebRetrievalImports(
        'import "@bread-map/retrieval";'
      )
    ).toEqual(["RETRIEVAL_IMPORT_STYLE"]);
    expect(
      findForbiddenWebRetrievalImports(
        'const retrieval = require("@bread-map/retrieval");'
      )
    ).toEqual(["RETRIEVAL_IMPORT_STYLE"]);
  });
});

describe("findForbiddenLocalMvpDependencies", () => {
  it("rejects deferred AI and legacy database dependencies", () => {
    expect(
      findForbiddenLocalMvpDependencies({
        dependencies: {
          openai: "catalog:",
          "@prisma/client": "catalog:"
        }
      })
    ).toEqual(["dependencies.openai", "dependencies.@prisma/client"]);
  });
});

describe("findForbiddenPublicSearchContractFields", () => {
  it("detects exact distance, origin and internal scores in public search results", () => {
    const source = `
      export const structuredSearchItemSchema = z.object({
        distanceM: z.number(),
        internalRank: z.number(),
        adjustedRating: z.number(),
        completeness: z.number(),
        score: z.number(),
        origin: z.object({})
      });
      export function parseStructuredSearchInput() {}
    `;

    expect(findForbiddenPublicSearchContractFields(source)).toEqual([
      "distanceM",
      "internalRank",
      "adjustedRating",
      "completeness",
      "score",
      "origin"
    ]);
  });

  it("keeps the checked-in public search result free of banned fields", async () => {
    const source = await readFile(
      join(
        process.cwd(),
        "packages",
        "contracts",
        "src",
        "search.ts"
      ),
      "utf8"
    );

    expect(findForbiddenPublicSearchContractFields(source)).toEqual([]);
  });
});
