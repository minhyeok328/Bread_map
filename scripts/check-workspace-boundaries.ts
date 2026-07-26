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
  "run-review-batch"
] as const;

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
    manifest[group]?.["@bread-map/raw-db"]
      ? [`${group}.@bread-map/raw-db`]
      : []
  );
}

export function findForbiddenWebRuntimeReferences(source: string): string[] {
  return forbiddenWebRuntimeReferences.filter((reference) =>
    source.includes(reference)
  );
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

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1];

if (
  invokedFile !== undefined &&
  pathToFileURL(resolve(invokedFile)).href === pathToFileURL(currentFile).href
) {
  const repositoryRoot = resolve(dirname(currentFile), "..");
  const manifestPath = resolve(repositoryRoot, "apps/web/package.json");
  const webSourceRoot = resolve(repositoryRoot, "apps/web/src");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8")
  ) as PackageManifest;
  const dependencyViolations = findForbiddenWebDependencies(manifest);
  const workspaceManifestPaths = [
    resolve(repositoryRoot, "package.json"),
    manifestPath,
    resolve(repositoryRoot, "apps/worker/package.json"),
    resolve(repositoryRoot, "packages/app-db/package.json"),
    resolve(repositoryRoot, "packages/raw-db/package.json")
  ];
  const localMvpViolations = await Promise.all(
    workspaceManifestPaths.map(async (path) => ({
      path,
      violations: findForbiddenLocalMvpDependencies(
        JSON.parse(await readFile(path, "utf8")) as PackageManifest
      )
    }))
  );
  const sourceFiles = await findTypeScriptSourceFiles(webSourceRoot);
  const runtimeViolations = (
    await Promise.all(
      sourceFiles.map(async (path) => ({
        path,
        references: findForbiddenWebRuntimeReferences(
          await readFile(path, "utf8")
        )
      }))
    )
  ).filter(({ references }) => references.length > 0);

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
}
