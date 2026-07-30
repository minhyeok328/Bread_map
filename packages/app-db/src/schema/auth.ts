import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "user",
  {
    id: text("user_id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    status: text("status").notNull().default("ACTIVE"),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .$defaultFn(() => Date.now()),
    deletedAtMs: integer("deleted_at_ms")
  },
  (table) => [
    index("user_status_idx").on(table.status),
    check(
      "user_status_allowed",
      sql`${table.status} in ('ACTIVE', 'DELETING')`
    ),
    check(
      "user_deletion_state_consistent",
      sql`(${table.status} = 'ACTIVE' and ${table.deletedAtMs} is null)
        or (${table.status} = 'DELETING' and ${table.deletedAtMs} is not null)`
    )
  ]
);

export const accounts = sqliteTable(
  "account",
  {
    accountId: text("account_id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade"
      }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .$defaultFn(() => Date.now())
  },
  (table) => [
    uniqueIndex("account_provider_identity_unique").on(
      table.provider,
      table.providerAccountId
    ),
    uniqueIndex("account_user_provider_unique").on(
      table.userId,
      table.provider
    ),
    index("account_user_idx").on(table.userId),
    check("account_type_allowed", sql`${table.type} = 'oauth'`),
    check(
      "account_provider_allowed",
      sql`${table.provider} = 'kakao'`
    )
  ]
);

export const sessions = sqliteTable(
  "session",
  {
    sessionId: text("session_id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade"
      }),
    sessionToken: text("session_token_hash").notNull(),
    authenticatedAtMs: integer("authenticated_at_ms").notNull(),
    expires: integer("expires_at_ms", {
      mode: "timestamp_ms"
    }).notNull(),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .$defaultFn(() => Date.now())
  },
  (table) => [
    uniqueIndex("session_token_hash_unique").on(table.sessionToken),
    index("session_user_expiry_idx").on(table.userId, table.expires),
    check(
      "session_token_hash_format",
      sql`length(${table.sessionToken}) = 64
        and ${table.sessionToken} not glob '*[^0-9a-f]*'`
    ),
    check(
      "session_expiry_after_authentication",
      sql`${table.expires} > ${table.authenticatedAtMs}`
    )
  ]
);
