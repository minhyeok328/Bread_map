import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backupSqliteFile } from "../packages/sqlite-core/src/index.js";
import { openAppDatabase } from "../packages/app-db/src/index.js";

export interface BackupAppDatabaseOptions {
  appPath?: string;
  outputPath: string;
}

export async function backupAppDatabase(
  options: BackupAppDatabaseOptions
): Promise<{ outputPath: string }> {
  const app = openAppDatabase(
    options.appPath === undefined ? {} : { path: options.appPath }
  );
  try {
    return {
      outputPath: await backupSqliteFile(app.client, options.outputPath)
    };
  } finally {
    app.close();
  }
}

function readOutputPath(arguments_: string[]): string | undefined {
  const outputIndex = arguments_.indexOf("--output");
  return outputIndex === -1 ? undefined : arguments_[outputIndex + 1];
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1];

if (
  invokedFile !== undefined &&
  pathToFileURL(resolve(invokedFile)).href === pathToFileURL(currentFile).href
) {
  const outputPath = readOutputPath(process.argv.slice(2));
  if (outputPath === undefined || outputPath.trim() === "") {
    console.error(
      "Usage: pnpm db:backup:app -- --output <path>"
    );
    process.exitCode = 1;
  } else {
    try {
      const result = await backupAppDatabase({ outputPath });
      console.log(result.outputPath);
    } catch {
      console.error("App database backup failed.");
      process.exitCode = 1;
    }
  }
}
