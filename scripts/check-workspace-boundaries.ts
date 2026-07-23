import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

export function findForbiddenWebDependencies(
  manifest: PackageManifest
): string[] {
  return dependencyGroups.flatMap((group) =>
    manifest[group]?.["@bread-map/raw-db"]
      ? [`${group}.@bread-map/raw-db`]
      : []
  );
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1];

if (
  invokedFile !== undefined &&
  pathToFileURL(resolve(invokedFile)).href === pathToFileURL(currentFile).href
) {
  const repositoryRoot = resolve(dirname(currentFile), "..");
  const manifestPath = resolve(repositoryRoot, "apps/web/package.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8")
  ) as PackageManifest;
  const violations = findForbiddenWebDependencies(manifest);

  if (violations.length > 0) {
    console.error(
      `apps/web contains forbidden raw database dependencies: ${violations.join(", ")}`
    );
    process.exitCode = 1;
  }
}
