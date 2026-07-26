import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export interface OpenSqliteFileOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

export interface SqliteFileHandle {
  readonly path: string;
  readonly client: Database.Database;
  close(): void;
}

export async function backupSqliteFile(
  client: Database.Database,
  destination: string
): Promise<string> {
  const resolvedDestination = resolveSqlitePath(destination, destination);
  mkdirSync(dirname(resolvedDestination), { recursive: true });
  await client.backup(resolvedDestination);
  return resolvedDestination;
}

export function resolveSqlitePath(
  value: string | undefined,
  fallback: string
): string {
  const candidate = value?.trim() || fallback;

  if (candidate === ":memory:") {
    return candidate;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    throw new Error("Local SQLite paths only");
  }

  return resolve(candidate);
}

export function openSqliteFile(
  path: string,
  options: OpenSqliteFileOptions = {}
): SqliteFileHandle {
  const resolvedPath = resolveSqlitePath(path, path);
  const readonly = options.readonly === true;

  if (resolvedPath !== ":memory:" && !readonly) {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const client = new Database(resolvedPath, {
    readonly,
    fileMustExist: options.fileMustExist === true,
    timeout: 5000
  });

  client.pragma("foreign_keys = ON");
  client.pragma("busy_timeout = 5000");
  if (!readonly && resolvedPath !== ":memory:") {
    client.pragma("journal_mode = WAL");
    client.pragma("synchronous = NORMAL");
  }

  return {
    path: resolvedPath,
    client,
    close: () => client.close()
  };
}
