import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { AppDatabaseHandle } from "./database.js";

export function migrateAppDatabase(
  handle: AppDatabaseHandle,
  migrationsFolder: string
): void {
  migrate(handle.db, { migrationsFolder });
}
