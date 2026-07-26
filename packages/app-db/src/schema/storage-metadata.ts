import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const appStorageMetadata = sqliteTable("storage_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});
