# Local SQLite Storage Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 PostgreSQL·Prisma·Docker scaffold를 두 개의 로컬 SQLite 파일, Drizzle migration, app DB backup과 자동 접근 경계로 교체한다.

**Architecture:** 공용 `@bread-map/sqlite-core` package가 파일 열기·PRAGMA·backup만 소유하고, `@bread-map/app-db`와 `@bread-map/raw-db`가 각자의 Drizzle schema·migration·typed handle을 소유한다. web은 app DB package만 사용하며 raw DB package·경로·환경변수는 lint와 repository test로 차단한다.

**Tech Stack:** Node.js 24.18.0, pnpm 11.16.0, TypeScript 6.0.3, better-sqlite3 12.11.1, @types/better-sqlite3 7.6.13, Drizzle ORM 0.45.2, Drizzle Kit 0.31.10, Vitest 4.1.10

## Global Constraints

- 기준 설계는 [`../specs/2026-07-24-local-first-sqlite-web-design.md`](../specs/2026-07-24-local-first-sqlite-web-design.md)와 DR-032·DR-033이다.
- 프로젝트 `AGENTS.md`에 따라 inline main-agent 실행이 기본이다. Subagent는 이 계획의 독립 작업 하나가 실제로 통합 비용보다 유리할 때만 사용한다.
- 이 Feature에서는 제품 domain table을 만들지 않는다. 두 DB의 migration·연결·metadata·backup·접근 경계만 만든다.
- `app.sqlite` 기본 경로는 `var/app.sqlite`, `raw.sqlite` 기본 경로는 `var/raw.sqlite`다.
- runtime은 원격 URL을 받지 않는다. `APP_SQLITE_PATH`, `RAW_SQLITE_PATH`에는 로컬 filesystem path 또는 test의 `:memory:`만 허용한다.
- web은 `@bread-map/raw-db`, `RAW_SQLITE_PATH`, `raw.sqlite`를 참조할 수 없다.
- `raw.sqlite`는 backup command의 대상이 아니다.
- OpenAI·LangGraph dependency와 `OPENAI_API_KEY`는 로컬 MVP scaffold에서 제거한다.
- 기존 Prisma schema와 Compose는 새 DB의 targeted test와 전체 검증이 통과한 뒤 제거한다.
- 아래 commit은 모두 body 마지막에 `Refs: #2`를 포함한다.

---

## Task 1: Add the SQLite Core Package

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Create: `packages/sqlite-core/package.json`
- Create: `packages/sqlite-core/tsconfig.json`
- Create: `packages/sqlite-core/src/sqlite.test.ts`
- Create: `packages/sqlite-core/src/sqlite.ts`
- Create: `packages/sqlite-core/src/index.ts`
- Modify: `pnpm-lock.yaml`

### 1.1 Pin the approved dependency set

- [ ] `pnpm-workspace.yaml` catalog에 다음 exact version을 추가한다.

```yaml
  "@types/better-sqlite3": 7.6.13
  better-sqlite3: 12.11.1
  drizzle-kit: 0.31.10
  drizzle-orm: 0.45.2
```

- [ ] `allowBuilds`에 native addon만 명시적으로 추가한다.

```yaml
allowBuilds:
  better-sqlite3: true
```

- [ ] `packages/sqlite-core/package.json`을 만든다.

```json
{
  "name": "@bread-map/sqlite-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "catalog:"
  },
  "devDependencies": {
    "@types/better-sqlite3": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] `packages/sqlite-core/tsconfig.json`은 app/raw DB package와 같은 Node library 설정을 사용한다.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] root `package.json` devDependencies에 `drizzle-kit`, `@types/better-sqlite3`을 catalog로 추가하고 설치한다.

```powershell
corepack pnpm install
```

Expected: install이 Node 24.18.0에서 native addon을 설치하고 `pnpm-lock.yaml`만 의존성 해석 결과로 변경한다.

### 1.2 Write the failing connection tests

- [ ] `packages/sqlite-core/src/sqlite.test.ts`에 다음 행위를 검증한다.

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteFile, resolveSqlitePath } from "./sqlite.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("openSqliteFile", () => {
  it("creates a local SQLite file with the approved pragmas", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bread-map-sqlite-"));
    cleanupPaths.push(directory);
    const handle = openSqliteFile(join(directory, "app.sqlite"));

    expect(handle.client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(handle.client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(handle.client.pragma("busy_timeout", { simple: true })).toBe(5000);

    handle.close();
  });
});

describe("resolveSqlitePath", () => {
  it("uses the fallback for blank values and permits in-memory tests", () => {
    expect(resolveSqlitePath(" ", "var/app.sqlite")).toMatch(
      /var[\\/]app\.sqlite$/
    );
    expect(resolveSqlitePath(":memory:", "unused.sqlite")).toBe(":memory:");
  });

  it("rejects a remote database URL", () => {
    expect(() =>
      resolveSqlitePath("libsql://example.turso.io", "var/app.sqlite")
    ).toThrow("Local SQLite paths only");
  });
});
```

- [ ] test를 실행해 아직 module export가 없어 실패하는지 확인한다.

```powershell
corepack pnpm vitest run packages/sqlite-core/src/sqlite.test.ts
```

Expected: `openSqliteFile` 또는 `resolveSqlitePath`가 없다는 실패.

### 1.3 Implement the minimum file-opening API

- [ ] `packages/sqlite-core/src/sqlite.ts`에 다음 public contract를 구현한다.

```ts
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
```

- [ ] `packages/sqlite-core/src/index.ts`에서 public symbol만 export한다.

```ts
export {
  openSqliteFile,
  resolveSqlitePath,
  type OpenSqliteFileOptions,
  type SqliteFileHandle
} from "./sqlite.js";
```

- [ ] targeted test와 typecheck를 실행한다.

```powershell
corepack pnpm vitest run packages/sqlite-core/src/sqlite.test.ts
corepack pnpm --filter @bread-map/sqlite-core typecheck
```

Expected: 둘 다 exit code 0.

### 1.4 Commit

- [ ] 변경 파일만 stage하고 diff를 확인한다.

```powershell
git add pnpm-workspace.yaml package.json pnpm-lock.yaml packages/sqlite-core
git diff --cached --check
git diff --cached --stat
```

- [ ] commit한다.

```text
feat(database): add local SQLite core

Open local SQLite files with the approved WAL, foreign key, and lock timeout
settings while rejecting remote URLs at the foundation boundary.

Refs: #2
```

## Task 2: Replace App DB Prisma Client with Drizzle

**Files:**

- Modify: `packages/app-db/package.json`
- Delete after replacement passes: `packages/app-db/src/index.ts`
- Create: `packages/app-db/src/schema/storage-metadata.ts`
- Create: `packages/app-db/src/schema/index.ts`
- Create: `packages/app-db/src/database.ts`
- Create: `packages/app-db/src/migrate.ts`
- Create: `packages/app-db/src/database.test.ts`
- Create: `packages/app-db/src/index.ts`
- Create: `drizzle/app.config.ts`
- Create generated: `drizzle/app/0000_storage_metadata.sql`
- Create generated: `drizzle/app/meta/0000_snapshot.json`
- Create generated: `drizzle/app/meta/_journal.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

### 2.1 Write the failing app DB migration test

- [ ] `packages/app-db/src/database.test.ts`를 먼저 만든다.

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "./database.js";
import { migrateAppDatabase } from "./migrate.js";
import { appStorageMetadata } from "./schema/index.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("app database", () => {
  it("migrates a blank database and persists service metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bread-map-app-db-"));
    cleanupPaths.push(directory);
    const handle = openAppDatabase({ path: join(directory, "app.sqlite") });

    migrateAppDatabase(handle, resolve("drizzle/app"));
    handle.db.insert(appStorageMetadata).values({
      key: "schema_owner",
      value: "app-db",
      updatedAt: new Date(0)
    }).run();

    const rows = handle.db.select().from(appStorageMetadata).all();
    expect(rows).toEqual([
      {
        key: "schema_owner",
        value: "app-db",
        updatedAt: new Date(0)
      }
    ]);

    handle.close();
  });
});
```

- [ ] test를 실행해 Drizzle app DB API가 아직 없어 실패하는지 확인한다.

```powershell
corepack pnpm vitest run packages/app-db/src/database.test.ts
```

Expected: `database.js`, `migrate.js` 또는 schema module을 찾지 못해 실패.

### 2.2 Add schema, config and migration

- [ ] `packages/app-db/package.json` dependencies를 다음으로 교체한다.

```json
{
  "dependencies": {
    "@bread-map/sqlite-core": "workspace:*",
    "drizzle-orm": "catalog:"
  },
  "devDependencies": {
    "@types/better-sqlite3": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] `packages/app-db/src/schema/storage-metadata.ts`를 만든다.

```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const appStorageMetadata = sqliteTable("storage_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});
```

- [ ] `packages/app-db/src/schema/index.ts`에서 table을 export한다.

```ts
export { appStorageMetadata } from "./storage-metadata.js";
```

- [ ] `drizzle/app.config.ts`를 만든다.

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/app-db/src/schema/index.ts",
  out: "./drizzle/app"
});
```

- [ ] root scripts를 추가하고 migration을 생성한다.

```json
{
  "db:generate:app": "drizzle-kit generate --name=storage_metadata --config=drizzle/app.config.ts"
}
```

```powershell
corepack pnpm db:generate:app
```

Expected: `drizzle/app/0000_storage_metadata.sql`과 `drizzle/app/meta` 파일이 생성되고 SQL에 `storage_metadata` table이 한 번만 정의된다.

### 2.3 Implement the typed handle and migrator

- [ ] `packages/app-db/src/database.ts`를 만든다.

```ts
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

export const DEFAULT_APP_SQLITE_PATH = "var/app.sqlite";

export interface OpenAppDatabaseOptions {
  path?: string;
  readonly?: boolean;
}

export interface AppDatabaseHandle {
  readonly path: string;
  readonly client: Database.Database;
  readonly db: BetterSQLite3Database<typeof schema>;
  close(): void;
}

export function openAppDatabase(
  options: OpenAppDatabaseOptions = {}
): AppDatabaseHandle {
  const path = resolveSqlitePath(
    options.path ?? process.env.APP_SQLITE_PATH,
    DEFAULT_APP_SQLITE_PATH
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
```

- [ ] `packages/app-db/src/migrate.ts`를 만든다.

```ts
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { AppDatabaseHandle } from "./database.js";

export function migrateAppDatabase(
  handle: AppDatabaseHandle,
  migrationsFolder: string
): void {
  migrate(handle.db, { migrationsFolder });
}
```

- [ ] `packages/app-db/src/index.ts`의 Prisma export를 다음으로 완전히 교체한다.

```ts
export {
  DEFAULT_APP_SQLITE_PATH,
  openAppDatabase,
  type AppDatabaseHandle,
  type OpenAppDatabaseOptions
} from "./database.js";
export { migrateAppDatabase } from "./migrate.js";
export * from "./schema/index.js";
```

- [ ] 의존성을 설치하고 targeted test·typecheck를 실행한다.

```powershell
corepack pnpm install
corepack pnpm vitest run packages/app-db/src/database.test.ts
corepack pnpm --filter @bread-map/app-db typecheck
```

Expected: blank file migration, insert/select와 typecheck가 모두 통과한다.

### 2.4 Commit

- [ ] app DB 변경만 stage·검사·commit한다.

```powershell
git add package.json pnpm-lock.yaml packages/app-db drizzle/app.config.ts drizzle/app
git diff --cached --check
git diff --cached --stat
```

```text
feat(database): migrate app storage to Drizzle

Own the app SQLite schema, migrations, and typed connection inside the app-db
package with a stable local file boundary.

Refs: #2
```

## Task 3: Replace Raw DB Prisma Client and Strengthen the Web Boundary

**Files:**

- Modify: `packages/raw-db/package.json`
- Delete after replacement passes: `packages/raw-db/src/index.ts`
- Create: `packages/raw-db/src/schema/storage-metadata.ts`
- Create: `packages/raw-db/src/schema/index.ts`
- Create: `packages/raw-db/src/database.ts`
- Create: `packages/raw-db/src/migrate.ts`
- Create: `packages/raw-db/src/database.test.ts`
- Create: `packages/raw-db/src/index.ts`
- Create: `drizzle/raw.config.ts`
- Create generated: `drizzle/raw/0000_storage_metadata.sql`
- Create generated: `drizzle/raw/meta/0000_snapshot.json`
- Create generated: `drizzle/raw/meta/_journal.json`
- Modify: `scripts/check-workspace-boundaries.ts`
- Modify: `scripts/check-workspace-boundaries.test.ts`
- Modify: `eslint.config.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

### 3.1 Write failing raw DB and boundary tests

- [ ] raw DB test는 Task 2와 같은 blank migration 흐름을 사용하되 다음 구분값을 검증한다.

```ts
await handle.db.insert(rawStorageMetadata).values({
  key: "schema_owner",
  value: "raw-db",
  updatedAt: new Date(0)
});
```

- [ ] `scripts/check-workspace-boundaries.test.ts`에 web runtime reference 검사를 추가한다.

```ts
import {
  findForbiddenWebDependencies,
  findForbiddenWebRuntimeReferences
} from "./check-workspace-boundaries.js";

it("rejects raw SQLite paths and environment variables in web source", () => {
  expect(
    findForbiddenWebRuntimeReferences(
      "const path = process.env.RAW_SQLITE_PATH; // raw.sqlite"
    )
  ).toEqual(["RAW_SQLITE_PATH", "raw.sqlite"]);
});
```

- [ ] 두 test를 실행해 새 API가 없어 실패하는지 확인한다.

```powershell
corepack pnpm vitest run packages/raw-db/src/database.test.ts scripts/check-workspace-boundaries.test.ts
```

Expected: raw DB module과 boundary helper가 없어 실패.

### 3.2 Implement raw DB ownership

- [ ] `packages/raw-db/package.json` dependencies를 다음으로 교체한다.

```json
{
  "dependencies": {
    "@bread-map/sqlite-core": "workspace:*",
    "drizzle-orm": "catalog:"
  },
  "devDependencies": {
    "@types/better-sqlite3": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] `packages/raw-db/src/schema/storage-metadata.ts`를 만든다.

```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rawStorageMetadata = sqliteTable("storage_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});
```

- [ ] `packages/raw-db/src/schema/index.ts`에서 table을 export한다.

```ts
export { rawStorageMetadata } from "./storage-metadata.js";
```

- [ ] `packages/raw-db/src/database.ts`를 만든다.

```ts
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
```

- [ ] `packages/raw-db/src/migrate.ts`를 만든다.

```ts
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { RawDatabaseHandle } from "./database.js";

export function migrateRawDatabase(
  handle: RawDatabaseHandle,
  migrationsFolder: string
): void {
  migrate(handle.db, { migrationsFolder });
}
```

- [ ] `packages/raw-db/src/index.ts`를 다음 export로 완전히 교체한다.

```ts
export {
  DEFAULT_RAW_SQLITE_PATH,
  openRawDatabase,
  type OpenRawDatabaseOptions,
  type RawDatabaseHandle
} from "./database.js";
export { migrateRawDatabase } from "./migrate.js";
export * from "./schema/index.js";
```

- [ ] `drizzle/raw.config.ts`를 만든다.

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/raw-db/src/schema/index.ts",
  out: "./drizzle/raw"
});
```

- [ ] root script를 추가하고 migration을 생성한다.

```json
{
  "db:generate:raw": "drizzle-kit generate --name=storage_metadata --config=drizzle/raw.config.ts",
  "db:generate": "corepack pnpm db:generate:app && corepack pnpm db:generate:raw"
}
```

```powershell
corepack pnpm db:generate:raw
```

Expected: app migration과 독립된 `drizzle/raw/0000_storage_metadata.sql`이 생성된다.

### 3.3 Strengthen automated boundaries

- [ ] `scripts/check-workspace-boundaries.ts`에 순수 helper를 추가한다.

```ts
const forbiddenWebRuntimeReferences = ["RAW_SQLITE_PATH", "raw.sqlite"] as const;

export function findForbiddenWebRuntimeReferences(source: string): string[] {
  return forbiddenWebRuntimeReferences.filter((reference) =>
    source.includes(reference)
  );
}
```

- [ ] CLI 실행부는 `apps/web/src` 아래 `.ts`·`.tsx` 파일을 재귀적으로 읽고, runtime reference가 하나라도 있으면 file path와 reference를 출력한 뒤 exit code 1을 설정한다.

- [ ] ESLint `no-restricted-imports`에 deep import뿐 아니라 `@bread-map/raw-db`가 이미 차단되는지 유지하고, global ignore에서 Prisma generated client 경로를 제거하는 작업은 Task 6까지 미룬다.

- [ ] targeted tests·typecheck·lint를 실행한다.

```powershell
corepack pnpm vitest run packages/raw-db/src/database.test.ts scripts/check-workspace-boundaries.test.ts
corepack pnpm --filter @bread-map/raw-db typecheck
corepack pnpm check:boundaries
```

Expected: 모두 exit code 0이고 현재 web source에 raw reference가 없다.

### 3.4 Commit

- [ ] raw DB와 boundary 변경만 commit한다.

```powershell
git add package.json pnpm-lock.yaml packages/raw-db drizzle/raw.config.ts drizzle/raw scripts/check-workspace-boundaries.ts scripts/check-workspace-boundaries.test.ts eslint.config.mjs
git diff --cached --check
git diff --cached --stat
```

```text
feat(database): isolate encrypted raw storage

Give raw SQLite its own Drizzle history and fail repository checks when web
code references the raw package, path, or environment variable.

Refs: #2
```

## Task 4: Add Migrate and App Backup Commands

**Files:**

- Modify: `packages/sqlite-core/src/sqlite.test.ts`
- Modify: `packages/sqlite-core/src/sqlite.ts`
- Modify: `packages/sqlite-core/src/index.ts`
- Create: `scripts/migrate-databases.test.ts`
- Create: `scripts/migrate-databases.ts`
- Create: `scripts/backup-app-database.test.ts`
- Create: `scripts/backup-app-database.ts`
- Modify: `package.json`

### 4.1 Write failing backup and migration command tests

- [ ] sqlite core test에 online backup round trip을 추가한다.

```ts
it("creates a readable online backup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bread-map-backup-"));
  cleanupPaths.push(directory);
  const source = openSqliteFile(join(directory, "app.sqlite"));
  source.client.exec("CREATE TABLE sample (value TEXT NOT NULL)");
  source.client.prepare("INSERT INTO sample VALUES (?)").run("bread");

  const backupPath = join(directory, "backups", "app.sqlite");
  await backupSqliteFile(source.client, backupPath);
  const backup = openSqliteFile(backupPath, {
    readonly: true,
    fileMustExist: true
  });

  expect(
    backup.client.prepare("SELECT value FROM sample").get()
  ).toEqual({ value: "bread" });

  backup.close();
  source.close();
});
```

- [ ] command tests는 임시 app/raw path와 임시 backup output을 인자로 전달하고 다음 결과를 검증한다.

```ts
expect(result).toEqual({
  appDatabasePath: appPath,
  rawDatabasePath: rawPath
});
expect(backupResult.outputPath).toBe(backupPath);
```

- [ ] tests를 실행해 helper와 command API가 없어 실패하는지 확인한다.

```powershell
corepack pnpm vitest run packages/sqlite-core/src/sqlite.test.ts scripts/migrate-databases.test.ts scripts/backup-app-database.test.ts
```

Expected: `backupSqliteFile`, `migrateDatabases`, `backupAppDatabase`가 없어 실패.

### 4.2 Implement online backup

- [ ] sqlite core에 다음 API를 추가한다.

```ts
export async function backupSqliteFile(
  client: Database.Database,
  destination: string
): Promise<string> {
  const resolvedDestination = resolveSqlitePath(destination, destination);
  mkdirSync(dirname(resolvedDestination), { recursive: true });
  await client.backup(resolvedDestination);
  return resolvedDestination;
}
```

- [ ] `packages/sqlite-core/src/index.ts`에서 `backupSqliteFile`을 export한다.

### 4.3 Implement callable command functions

- [ ] `scripts/migrate-databases.ts`는 test 가능한 함수와 CLI를 분리한다.

```ts
export interface MigrateDatabasePaths {
  appPath?: string;
  rawPath?: string;
}

export function migrateDatabases(
  paths: MigrateDatabasePaths = {}
): {
  appDatabasePath: string;
  rawDatabasePath: string;
} {
  const app = openAppDatabase({ path: paths.appPath });
  const raw = openRawDatabase({ path: paths.rawPath });
  try {
    migrateAppDatabase(app, resolve("drizzle/app"));
    migrateRawDatabase(raw, resolve("drizzle/raw"));
    return {
      appDatabasePath: app.path,
      rawDatabasePath: raw.path
    };
  } finally {
    raw.close();
    app.close();
  }
}
```

- [ ] `scripts/backup-app-database.ts`는 raw DB option을 받지 않는다.

```ts
export interface BackupAppDatabaseOptions {
  appPath?: string;
  outputPath: string;
}

export async function backupAppDatabase(
  options: BackupAppDatabaseOptions
): Promise<{ outputPath: string }> {
  const app = openAppDatabase({ path: options.appPath });
  try {
    return {
      outputPath: await backupSqliteFile(app.client, options.outputPath)
    };
  } finally {
    app.close();
  }
}
```

- [ ] 두 CLI는 성공 시 path만 출력하고 DB content, environment와 stack을 출력하지 않는다. root scripts를 추가한다.

```json
{
  "db:migrate": "tsx scripts/migrate-databases.ts",
  "db:backup:app": "tsx scripts/backup-app-database.ts"
}
```

`db:backup:app`은 `--output <path>` 필수 인자를 요구하고 누락 시 usage와 exit code 1을 반환한다.

- [ ] targeted test 후 실제 기본 경로 migration과 명시적 backup을 실행한다.

```powershell
corepack pnpm vitest run packages/sqlite-core/src/sqlite.test.ts scripts/migrate-databases.test.ts scripts/backup-app-database.test.ts
corepack pnpm db:migrate
corepack pnpm db:backup:app -- --output backups/app-foundation.sqlite
```

Expected: `var/app.sqlite`, `var/raw.sqlite`, `backups/app-foundation.sqlite`가 생성되고 backup test가 새 readonly 연결에서 통과한다.

### 4.4 Commit

- [ ] runtime DB 파일은 stage하지 않고 source만 commit한다.

```powershell
git status --short
git add package.json packages/sqlite-core/src scripts/migrate-databases.ts scripts/migrate-databases.test.ts scripts/backup-app-database.ts scripts/backup-app-database.test.ts
git diff --cached --check
git diff --cached --stat
```

```text
feat(database): add migration and app backup commands

Migrate both local database files from one command and create a consistent
online snapshot of app storage without backing up raw review data.

Refs: #2
```

## Task 5: Remove Deferred and Legacy Runtime Dependencies

**Files:**

- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `apps/web/package.json`
- Modify: `apps/worker/package.json`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `eslint.config.mjs`
- Modify: `pnpm-lock.yaml`

### 5.1 Add a failing manifest policy test

- [ ] `scripts/check-workspace-boundaries.test.ts`에 local MVP 금지 dependency 검사를 추가한다.

```ts
it("rejects deferred AI and legacy database dependencies", () => {
  expect(
    findForbiddenLocalMvpDependencies({
      dependencies: {
        openai: "catalog:",
        "@prisma/client": "catalog:"
      }
    })
  ).toEqual(["dependencies.openai", "dependencies.@prisma/client"]);
});
```

금지 목록:

```ts
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
```

- [ ] test가 helper 부재로 실패하는지 확인한다.

```powershell
corepack pnpm vitest run scripts/check-workspace-boundaries.test.ts
```

### 5.2 Remove forbidden dependencies and Prisma scripts

- [ ] root `package.json`에서 `prisma:*` scripts와 `prisma` devDependency를 제거한다.
- [ ] `apps/web/package.json`에서 `@auth/prisma-adapter`, LangChain 3개 package와 `openai`를 제거한다.
- [ ] `apps/worker/package.json`에서 LangChain 3개 package와 `openai`를 제거한다.
- [ ] `pnpm-workspace.yaml` catalog와 `allowBuilds`에서 Prisma·PG·OpenAI·LangChain 항목을 제거한다.
- [ ] `build`와 `typecheck`는 migration을 자동 실행하지 않고 workspace 명령만 수행하게 한다.

```json
{
  "build": "corepack pnpm -r --if-present build",
  "typecheck": "corepack pnpm -r --if-present typecheck"
}
```

- [ ] policy helper를 구현하고 root, web, worker, app-db, raw-db manifest를 CLI 실행부에서 검사한다.

### 5.3 Replace environment and ignore policy

- [ ] `.env.example`의 PostgreSQL 변수와 `OPENAI_API_KEY`를 제거하고 다음을 추가한다.

```dotenv
# Local SQLite files. Defaults are used when blank.
APP_SQLITE_PATH=./var/app.sqlite

# Worker only. Never expose this variable to apps/web.
RAW_SQLITE_PATH=./var/raw.sqlite
```

- [ ] Kakao·Auth.js·공공데이터 변수는 후속 Feature용으로 유지한다.
- [ ] `.gitignore`에 다음 runtime 데이터를 추가한다.

```gitignore
# Local SQLite data and snapshots
var/
backups/
*.sqlite
*.sqlite-wal
*.sqlite-shm
```

- [ ] Prisma generated ignore 두 줄은 Task 6에서 실제 폴더 삭제와 함께 제거한다.
- [ ] install과 boundary test를 실행한다.

```powershell
corepack pnpm install
corepack pnpm vitest run scripts/check-workspace-boundaries.test.ts
corepack pnpm check:boundaries
git status --short
```

Expected: lockfile에 금지 package가 direct workspace dependency로 남지 않고 runtime DB·backup은 untracked 목록에 나타나지 않는다.

### 5.4 Commit

- [ ] manifest, lockfile, environment·ignore policy만 commit한다.

```powershell
git add package.json pnpm-workspace.yaml pnpm-lock.yaml apps/web/package.json apps/worker/package.json .env.example .gitignore scripts/check-workspace-boundaries.ts scripts/check-workspace-boundaries.test.ts
git diff --cached --check
git diff --cached --stat
```

```text
chore(database): remove deferred database and AI runtimes

Drop PostgreSQL, Prisma, LangGraph, and OpenAI dependencies from the local MVP
foundation while keeping future Kakao integration variables documented.

Refs: #2
```

## Task 6: Prove the Replacement, Then Remove PostgreSQL Scaffold

**Files:**

- Delete: `prisma/app/schema.prisma`
- Delete: `prisma/app/migrations/migration_lock.toml`
- Delete: `prisma/raw/schema.prisma`
- Delete: `prisma/raw/migrations/migration_lock.toml`
- Delete: `infra/compose.yaml`
- Modify: `infra/docker/README.md`
- Modify: `eslint.config.mjs`
- Modify: `docs/10-delivery/technology-stack.md`
- Modify: `docs/10-delivery/directory-structure.md`
- Modify: `docs/10-delivery/local-development.md`
- Modify: `docs/10-delivery/README.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`
- Modify: `docs/README.md`

### 6.1 Run the replacement gate before deletion

- [ ] migration output을 깨끗한 별도 test path에서 다시 만든다.

```powershell
$env:APP_SQLITE_PATH = "var/foundation-verification/app.sqlite"
$env:RAW_SQLITE_PATH = "var/foundation-verification/raw.sqlite"
corepack pnpm db:migrate
corepack pnpm db:backup:app -- --output var/foundation-verification/backups/app.sqlite
```

- [ ] targeted storage 검증을 실행한다.

```powershell
corepack pnpm vitest run packages/sqlite-core/src/sqlite.test.ts packages/app-db/src/database.test.ts packages/raw-db/src/database.test.ts scripts/check-workspace-boundaries.test.ts scripts/migrate-databases.test.ts scripts/backup-app-database.test.ts
```

Expected: 모든 test 통과. 이 단계가 실패하면 Prisma·Compose 파일을 삭제하지 않고 원인을 수정한다.

### 6.2 Remove only the superseded scaffold

- [ ] 위 gate 통과 후 정확히 다음 파일을 삭제한다.

```text
prisma/app/schema.prisma
prisma/app/migrations/migration_lock.toml
prisma/raw/schema.prisma
prisma/raw/migrations/migration_lock.toml
infra/compose.yaml
```

- [ ] `eslint.config.mjs`에서 두 Prisma generated ignore를 제거한다.
- [ ] `infra/docker/README.md`는 다음처럼 deployment 비목표를 명시한다.

```md
# Docker image definitions

Docker is not required for the local SQLite MVP. Production image definitions
belong to a later deployment Feature and this directory intentionally contains
no active Dockerfile.
```

### 6.3 Update owning delivery documents

- [ ] `technology-stack.md`에서 현재 DB/ORM을 SQLite·better-sqlite3·Drizzle로 바꾸고 PostgreSQL·Prisma·Docker를 superseded history로 이동한다.
- [ ] `directory-structure.md`의 `prisma/`와 `infra/compose.yaml`을 `drizzle/app`, `drizzle/raw`, `packages/sqlite-core`, `var/`로 교체한다.
- [ ] `local-development.md`의 Docker 절차를 삭제하고 설치 → `db:migrate` → `dev` → `db:backup:app` 순서를 기록한다.
- [ ] 환경변수 표에서 `APP_SQLITE_PATH`는 web·worker, `RAW_SQLITE_PATH`는 worker-only로 표시한다.
- [ ] `README.md`와 readiness checklist에서 현재 마스터 계획과 Feature 1 상세 계획을 우선 링크한다.
- [ ] 과거 계획 문서는 삭제하거나 내용을 다시 쓰지 않고 “이력”으로 유지한다.

### 6.4 Run the one full-scope verification

- [ ] 환경변수를 제거하고 repository 기본 상태를 검증한다.

```powershell
Remove-Item Env:APP_SQLITE_PATH -ErrorAction SilentlyContinue
Remove-Item Env:RAW_SQLITE_PATH -ErrorAction SilentlyContinue
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Expected:

- install: lockfile 변경 없이 exit code 0
- typecheck: 모든 workspace package exit code 0
- lint: raw DB 경계와 금지 dependency 검사를 포함해 exit code 0
- test: storage·backup·boundary test 모두 통과
- build: Next.js와 library build 통과, DB 파일 생성 없음

- [ ] migration drift를 검사한다.

```powershell
corepack pnpm exec drizzle-kit check --config=drizzle/app.config.ts
corepack pnpm exec drizzle-kit check --config=drizzle/raw.config.ts
```

Expected: 두 migration folder 모두 conflict 없음.

### 6.5 Commit

- [ ] 삭제와 문서 갱신을 함께 검토한다.

```powershell
git add -u prisma infra/compose.yaml
git add infra/docker/README.md eslint.config.mjs docs/README.md docs/10-delivery
git diff --cached --check
git diff --cached --name-status
```

```text
docs(database): complete the local SQLite transition

Remove the verified PostgreSQL scaffold and make the delivery documentation,
directory ownership, and local commands match the approved SQLite foundation.

Refs: #2
```

## Task 7: Final Feature Audit

**Files:**

- Verify only; change files only if a failed acceptance check identifies a direct defect.

### 7.1 Confirm acceptance criteria

- [ ] default migration creates exactly `var/app.sqlite` and `var/raw.sqlite`.
- [ ] app and raw handles use separate schema types and migration folders.
- [ ] `PRAGMA foreign_keys`, `journal_mode`, `busy_timeout` match approved values.
- [ ] app backup is readable from a new readonly connection.
- [ ] no raw backup command exists.
- [ ] web cannot depend on raw DB or reference raw path/environment.
- [ ] no direct Prisma, PostgreSQL, LangGraph or OpenAI dependency remains.
- [ ] `.env.example` does not ask for `OPENAI_API_KEY`.
- [ ] `git status --short --ignored` confirms SQLite files and backups are ignored.
- [ ] full verification from Task 6 remains green without Docker or external API keys.

### 7.2 Check dependency and source residue

- [ ] focused searches must return no active runtime residue.

```powershell
rg -n '"(prisma|@prisma/client|@prisma/adapter-pg|pg|openai|@langchain/)' package.json pnpm-workspace.yaml apps packages
rg -n 'APP_DATABASE_URL|RAW_DATABASE_URL|OPENAI_API_KEY' .env.example apps packages scripts
rg -n 'infra/compose.yaml|docker compose|PostgreSQL|Prisma' docs/10-delivery infra
```

Expected:

- 첫 두 명령은 exit code 1이며 match 없음.
- 마지막 명령은 superseded history 설명 외 active instruction match 없음.

### 7.3 Review generated and hand-written migration state

- [ ] `drizzle/app/0000_storage_metadata.sql`은 app metadata table만 만든다.
- [ ] `drizzle/raw/0000_storage_metadata.sql`은 raw metadata table만 만든다.
- [ ] 두 `_journal.json`의 migration entry가 각 한 개다.
- [ ] migration을 두 번 실행해도 error와 duplicate table이 없다.

```powershell
corepack pnpm db:migrate
corepack pnpm db:migrate
```

Expected: 두 실행 모두 exit code 0.

### 7.4 Final report

- [ ] 사용자에게 다음만 간결히 보고한다.

1. PostgreSQL scaffold가 두 로컬 SQLite foundation으로 교체됐는지
2. migration·backup·web/raw 경계 검증 결과
3. full verification의 명령별 성공 여부
4. 설치되지 않은 외부 key가 없는지
5. 다음 독립 Feature가 “Seoul source ingestion”이며 새 Codex 작업을 권장한다는 점

## References

- [Drizzle SQLite driver documentation](https://orm.drizzle.team/docs/sqlite/get-started-sqlite)
- [Drizzle Kit overview and multiple configs](https://orm.drizzle.team/docs/kit-overview)
- [better-sqlite3 project and WAL guidance](https://github.com/WiseLibs/better-sqlite3)
- [better-sqlite3 backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [better-sqlite3 12.1.0 Node 24 prebuild fix](https://github.com/WiseLibs/better-sqlite3/issues/1384)

## Plan Completion Checklist

- [ ] PostgreSQL removal happens only after SQLite targeted verification.
- [ ] every code task starts with an observable failing test.
- [ ] every package, migration, command and document has an exact owner path.
- [ ] app/raw type names and environment names are consistent throughout.
- [ ] backup is app-only and web/raw separation is enforced twice.
- [ ] no unresolved marker, omitted implementation or unbounded retry remains.
- [ ] commit boundaries are small, ordered and linked with `Refs: #2`.
