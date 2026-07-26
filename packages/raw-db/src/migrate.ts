import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { RawDatabaseHandle } from "./database.js";

export function migrateRawDatabase(
  handle: RawDatabaseHandle,
  migrationsFolder: string
): void {
  migrate(handle.db, { migrationsFolder });
}
