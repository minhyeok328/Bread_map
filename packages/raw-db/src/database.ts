import type Database from "better-sqlite3";
import {
  openSqliteFile,
  resolveSqlitePath
} from "@bread-map/sqlite-core";
import {
  drizzle,
  type BetterSQLite3Database
} from "drizzle-orm/better-sqlite3";
import * as schema from "./schema/index.js";

export const DEFAULT_RAW_SQLITE_PATH = "var/raw.sqlite";

export interface OpenRawDatabaseOptions {
  path?: string;
  readonly?: boolean;
}

export interface RawDatabaseHandle {
  readonly path: string;
  readonly client: Database.Database;
  readonly db: BetterSQLite3Database<typeof schema>;
  close(): void;
}

export function openRawDatabase(
  options: OpenRawDatabaseOptions = {}
): RawDatabaseHandle {
  const path = resolveSqlitePath(
    options.path ?? process.env.RAW_SQLITE_PATH,
    DEFAULT_RAW_SQLITE_PATH
  );
  const readonly = options.readonly === true;
  const file = openSqliteFile(path, {
    readonly,
    fileMustExist: readonly
  });

  return {
    path: file.path,
    client: file.client,
    db: drizzle({ client: file.client, schema }),
    close: file.close
  };
}
