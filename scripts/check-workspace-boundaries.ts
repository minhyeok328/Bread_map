import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type DependencyMap = Record<string, string>;

export type PackageManifest = Partial<
  Record<
    "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies",
    DependencyMap
  >
>;

const dependencyGroups = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies"
] as const;

const forbiddenWebRuntimeReferences = [
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
  "resume-run",
  "/raw-db/src/",
  "packages/raw-db",
  "@bread-map/raw-db",
  "/worker/src/",
  "apps/worker",
  "@bread-map/worker",
  "publish-review",
  "publishReviewRun",
  "decryptRawReview",
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
] as const;

const forbiddenPublicSearchResultFields = [
  "distanceM",
  "internalRank",
  "adjustedRating",
  "completeness",
  "score",
  "origin"
] as const;

const allowedWebRetrievalImports = new Set([
  "executeSqliteStoreSearch",
  "resolveCurrentSqliteSearchDataVersion",
  "StoreSearchError"
]);

const forbiddenLocalMvpDependencies = [
  "openai",
  "@langchain/core",
  "@langchain/langgraph",
  "@langchain/openai",
  "prisma",
  "@prisma/client",
  "@prisma/adapter-pg",
  "pg",
  "@types/pg",
  "@auth/prisma-adapter"
] as const;

export function findForbiddenLocalMvpDependencies(
  manifest: PackageManifest
): string[] {
  return dependencyGroups.flatMap((group) =>
    forbiddenLocalMvpDependencies.flatMap((dependency) =>
      manifest[group]?.[dependency] === undefined
        ? []
        : [`${group}.${dependency}`]
    )
  );
}

export function findForbiddenWebDependencies(
  manifest: PackageManifest
): string[] {
  return dependencyGroups.flatMap((group) =>
    ["@bread-map/raw-db", "@bread-map/worker"].flatMap(
      (dependency) =>
        manifest[group]?.[dependency] === undefined
          ? []
          : [`${group}.${dependency}`]
    )
  );
}

export function findForbiddenWebRuntimeReferences(source: string): string[] {
  return forbiddenWebRuntimeReferences.filter((reference) => {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(reference)) {
      return new RegExp(`\\b${reference}\\b`).test(source);
    }
    return source.includes(reference);
  });
}

async function findTypeScriptSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return findTypeScriptSourceFiles(path);
      }
      if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
        return [path];
      }
      return [];
    })
  );

  return files.flat().sort();
}

export function findForbiddenWebRetrievalImports(
  source: string
): string[] {
  const violations = new Set<string>();
  const consumedImportRanges: Array<readonly [number, number]> = [];
  const imports =
    /import\s+(?:type\s+)?(\{[^;]*?\}|\*\s+as\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?:\s*,\s*\{[^;]*?\})?)\s+from\s+["'](@bread-map\/retrieval(?:\/[^"']*)?)["']/gu;

  for (const match of source.matchAll(imports)) {
    const clause = match[1]?.trim();
    const moduleSpecifier = match[2];
    if (match.index !== undefined) {
      consumedImportRanges.push([
        match.index,
        match.index + match[0].length
      ]);
    }
    if (moduleSpecifier !== "@bread-map/retrieval") {
      violations.add("RETRIEVAL_IMPORT_PATH");
      continue;
    }
    if (
      clause === undefined ||
      !clause.startsWith("{") ||
      !clause.endsWith("}")
    ) {
      violations.add("RETRIEVAL_IMPORT_STYLE");
      continue;
    }

    const importedNames = clause
      .slice(1, -1)
      .split(",")
      .map((entry) =>
        entry
          .trim()
          .replace(/^type\s+/u, "")
          .split(/\s+as\s+/u)[0]
          ?.trim()
      )
      .filter(
        (entry): entry is string =>
          entry !== undefined && entry.length > 0
      );
    for (const importedName of importedNames) {
      if (!allowedWebRetrievalImports.has(importedName)) {
        violations.add(importedName);
      }
    }
  }

  const residualSource = source.split("");
  for (const [start, end] of consumedImportRanges) {
    residualSource.fill(" ", start, end);
  }
  const residualImports =
    /(?:\b(?:import|require)\s*(?:\(\s*)?|\bfrom\s*)["'](@bread-map\/retrieval(?:\/[^"']*)?)["']/gu;
  for (const match of residualSource.join("").matchAll(residualImports)) {
    violations.add(
      match[1] === "@bread-map/retrieval"
        ? "RETRIEVAL_IMPORT_STYLE"
        : "RETRIEVAL_IMPORT_PATH"
    );
  }

  return [...violations];
}

export function findForbiddenPublicSearchContractFields(
  source: string
): string[] {
  const publicResultStart = source.indexOf(
    "export const structuredSearchItemSchema"
  );
  const publicResultEnd = source.indexOf(
    "export function parseStructuredSearchInput"
  );
  if (
    publicResultStart < 0 ||
    publicResultEnd <= publicResultStart
  ) {
    return ["PUBLIC_SEARCH_RESULT_REGION_MISSING"];
  }
  const publicResultSource = source.slice(
    publicResultStart,
    publicResultEnd
  );
  return forbiddenPublicSearchResultFields.filter((field) =>
    new RegExp(`\\b${field}\\s*:`).test(publicResultSource)
  );
}

export async function findWebRuntimeSourceFiles(
  webPackageRoot: string
): Promise<string[]> {
  const rootEntries = await readdir(webPackageRoot, { withFileTypes: true });
  const configFiles = rootEntries.flatMap((entry) =>
    entry.isFile() && /^next\.config\.(?:ts|js|mjs|cjs)$/.test(entry.name)
      ? [join(webPackageRoot, entry.name)]
      : []
  );
  const sourceFiles = await findTypeScriptSourceFiles(
    join(webPackageRoot, "src")
  );

  return [...configFiles, ...sourceFiles].sort();
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1];

if (
  invokedFile !== undefined &&
  pathToFileURL(resolve(invokedFile)).href === pathToFileURL(currentFile).href
) {
  const repositoryRoot = resolve(dirname(currentFile), "..");
  const manifestPath = resolve(repositoryRoot, "apps/web/package.json");
  const webPackageRoot = resolve(repositoryRoot, "apps/web");
  const publicSearchContractPath = resolve(
    repositoryRoot,
    "packages/contracts/src/search.ts"
  );
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8")
  ) as PackageManifest;
  const dependencyViolations = findForbiddenWebDependencies(manifest);
  const workspaceManifestPaths = [
    resolve(repositoryRoot, "package.json"),
    manifestPath,
    resolve(repositoryRoot, "apps/worker/package.json"),
    resolve(repositoryRoot, "packages/app-db/package.json"),
    resolve(repositoryRoot, "packages/contracts/package.json"),
    resolve(repositoryRoot, "packages/raw-db/package.json"),
    resolve(repositoryRoot, "packages/recommendation/package.json"),
    resolve(repositoryRoot, "packages/retrieval/package.json"),
    resolve(repositoryRoot, "packages/sqlite-core/package.json"),
    resolve(repositoryRoot, "packages/testkit/package.json")
  ];
  const localMvpViolations = await Promise.all(
    workspaceManifestPaths.map(async (path) => ({
      path,
      violations: findForbiddenLocalMvpDependencies(
        JSON.parse(await readFile(path, "utf8")) as PackageManifest
      )
    }))
  );
  const sourceFiles = await findWebRuntimeSourceFiles(webPackageRoot);
  const runtimeViolations = (
    await Promise.all(
      sourceFiles.map(async (path) => {
        const source = await readFile(path, "utf8");
        return {
          path,
          references: [
            ...findForbiddenWebRuntimeReferences(source),
            ...findForbiddenWebRetrievalImports(source)
          ]
        };
      })
    )
  ).filter(({ references }) => references.length > 0);
  const publicSearchContractViolations =
    findForbiddenPublicSearchContractFields(
      await readFile(publicSearchContractPath, "utf8")
    );

  if (dependencyViolations.length > 0) {
    console.error(
      `apps/web contains forbidden raw database dependencies: ${dependencyViolations.join(", ")}`
    );
    process.exitCode = 1;
  }
  for (const violation of runtimeViolations) {
    console.error(
      `${relative(repositoryRoot, violation.path)} contains forbidden raw database references: ${violation.references.join(", ")}`
    );
    process.exitCode = 1;
  }
  for (const violation of localMvpViolations) {
    if (violation.violations.length > 0) {
      console.error(
        `${relative(repositoryRoot, violation.path)} contains forbidden local MVP dependencies: ${violation.violations.join(", ")}`
      );
      process.exitCode = 1;
    }
  }
  if (publicSearchContractViolations.length > 0) {
    console.error(
      `packages/contracts/src/search.ts contains forbidden public search result fields: ${publicSearchContractViolations.join(", ")}`
    );
    process.exitCode = 1;
  }
}
