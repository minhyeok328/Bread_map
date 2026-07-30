import {
  accounts,
  favorites,
  searchHistories,
  selectionHistories,
  sessions,
  stores,
  users,
  type AppDatabaseHandle
} from "@bread-map/app-db";
import {
  parseFavoriteMutation,
  parseHistoryDelete,
  parseHistoryMutation,
  parseHistoryQuery,
  searchHistoryFiltersSchema,
  type HistoryDelete,
  type HistoryMutation,
  type HistoryQuery,
  type SearchHistoryFilters
} from "@bread-map/contracts";
import { and, desc, eq } from "drizzle-orm";

type AppDatabase = AppDatabaseHandle["db"];

export class UserNotActiveError extends Error {
  constructor() {
    super("active user required");
    this.name = "UserNotActiveError";
  }
}

export class StoreNotAvailableError extends Error {
  constructor() {
    super("public store required");
    this.name = "StoreNotAvailableError";
  }
}

export interface FavoriteRecord {
  favoriteId: string;
  storeId: string;
  createdAtMs: number;
}

export interface FavoriteMutationResult {
  created: boolean;
  favorite: FavoriteRecord;
}

export interface SearchHistoryRecord {
  kind: "search";
  historyId: string;
  filters: SearchHistoryFilters;
  dataSnapshotVersion: string;
  recommendationVersion: "recommendation-v1";
  resultCount: number;
  createdAtMs: number;
}

export interface SelectionHistoryRecord {
  kind: "selection";
  historyId: string;
  storeId: string;
  sourceSurface: "LIST" | "MAP" | "SEARCH";
  createdAtMs: number;
}

export type UserHistoryRecord =
  | SearchHistoryRecord
  | SelectionHistoryRecord;

export interface UserRepositoryOptions {
  now?: () => number;
}

function isPublicStore(
  database: AppDatabase,
  storeId: string
): boolean {
  return (
    database
      .select({ storeId: stores.storeId })
      .from(stores)
      .where(
        and(
          eq(stores.storeId, storeId),
          eq(stores.catalogStatus, "published"),
          eq(stores.businessStatus, "active")
        )
      )
      .get() !== undefined
  );
}

function assertActiveUser(
  database: AppDatabase,
  userId: string
): void {
  const user = database
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (user?.status !== "ACTIVE") {
    throw new UserNotActiveError();
  }
}

export function createUserRepository(
  database: AppDatabase,
  options: UserRepositoryOptions = {}
) {
  const now = options.now ?? Date.now;

  return {
    listFavorites(userId: string): FavoriteRecord[] {
      assertActiveUser(database, userId);

      return database
        .select({
          favoriteId: favorites.favoriteId,
          storeId: favorites.storeId,
          createdAtMs: favorites.createdAtMs
        })
        .from(favorites)
        .innerJoin(stores, eq(stores.storeId, favorites.storeId))
        .where(
          and(
            eq(favorites.userId, userId),
            eq(stores.catalogStatus, "published"),
            eq(stores.businessStatus, "active")
          )
        )
        .orderBy(
          desc(favorites.createdAtMs),
          desc(favorites.favoriteId)
        )
        .all();
    },
    addFavorite(
      userId: string,
      requestedStoreId: string
    ): FavoriteMutationResult | null {
      const { storeId } = parseFavoriteMutation({
        storeId: requestedStoreId
      });
      assertActiveUser(database, userId);

      if (!isPublicStore(database, storeId)) {
        return null;
      }

      const existing = database
        .select({
          favoriteId: favorites.favoriteId,
          storeId: favorites.storeId,
          createdAtMs: favorites.createdAtMs
        })
        .from(favorites)
        .where(
          and(
            eq(favorites.userId, userId),
            eq(favorites.storeId, storeId)
          )
        )
        .get();

      if (existing !== undefined) {
        return {
          created: false,
          favorite: existing
        };
      }

      const favorite = database
        .insert(favorites)
        .values({
          userId,
          storeId,
          createdAtMs: now()
        })
        .onConflictDoNothing()
        .returning({
          favoriteId: favorites.favoriteId,
          storeId: favorites.storeId,
          createdAtMs: favorites.createdAtMs
        })
        .get();

      if (favorite !== undefined) {
        return {
          created: true,
          favorite
        };
      }

      const concurrent = database
        .select({
          favoriteId: favorites.favoriteId,
          storeId: favorites.storeId,
          createdAtMs: favorites.createdAtMs
        })
        .from(favorites)
        .where(
          and(
            eq(favorites.userId, userId),
            eq(favorites.storeId, storeId)
          )
        )
        .get();

      return concurrent === undefined
        ? null
        : {
            created: false,
            favorite: concurrent
          };
    },
    removeFavorite(
      userId: string,
      requestedStoreId: string
    ): boolean {
      const { storeId } = parseFavoriteMutation({
        storeId: requestedStoreId
      });
      assertActiveUser(database, userId);

      const result = database
        .delete(favorites)
        .where(
          and(
            eq(favorites.userId, userId),
            eq(favorites.storeId, storeId)
          )
        )
        .run();

      return result.changes === 1;
    },
    listHistory(
      userId: string,
      request: HistoryQuery
    ): UserHistoryRecord[] {
      const query = parseHistoryQuery(request);
      assertActiveUser(database, userId);

      if (query.kind === "search") {
        return database
          .select({
            historyId: searchHistories.searchHistoryId,
            filtersJson: searchHistories.displayFiltersJson,
            dataSnapshotVersion:
              searchHistories.dataSnapshotVersion,
            recommendationVersion:
              searchHistories.recommendationVersion,
            resultCount: searchHistories.resultCount,
            createdAtMs: searchHistories.createdAtMs
          })
          .from(searchHistories)
          .where(eq(searchHistories.userId, userId))
          .orderBy(
            desc(searchHistories.createdAtMs),
            desc(searchHistories.searchHistoryId)
          )
          .limit(query.limit)
          .all()
          .map((row) => ({
            kind: "search" as const,
            historyId: row.historyId,
            filters: searchHistoryFiltersSchema.parse(
              JSON.parse(row.filtersJson)
            ),
            dataSnapshotVersion: row.dataSnapshotVersion,
            recommendationVersion:
              row.recommendationVersion as "recommendation-v1",
            resultCount: row.resultCount,
            createdAtMs: row.createdAtMs
          }));
      }

      return database
        .select({
          historyId: selectionHistories.selectionHistoryId,
          storeId: selectionHistories.storeId,
          sourceSurface: selectionHistories.sourceSurface,
          createdAtMs: selectionHistories.createdAtMs
        })
        .from(selectionHistories)
        .innerJoin(
          stores,
          eq(stores.storeId, selectionHistories.storeId)
        )
        .where(
          and(
            eq(selectionHistories.userId, userId),
            eq(stores.catalogStatus, "published"),
            eq(stores.businessStatus, "active")
          )
        )
        .orderBy(
          desc(selectionHistories.createdAtMs),
          desc(selectionHistories.selectionHistoryId)
        )
        .limit(query.limit)
        .all()
        .map((row) => ({
          kind: "selection" as const,
          historyId: row.historyId,
          storeId: row.storeId,
          sourceSurface:
            row.sourceSurface as SelectionHistoryRecord["sourceSurface"],
          createdAtMs: row.createdAtMs
        }));
    },
    addHistory(
      userId: string,
      request: HistoryMutation
    ): UserHistoryRecord {
      const mutation = parseHistoryMutation(request);
      assertActiveUser(database, userId);

      if (mutation.kind === "search") {
        const created = database
          .insert(searchHistories)
          .values({
            userId,
            displayFiltersJson: JSON.stringify(mutation.filters),
            dataSnapshotVersion: mutation.dataSnapshotVersion,
            recommendationVersion:
              mutation.recommendationVersion,
            resultCount: mutation.resultCount,
            createdAtMs: now()
          })
          .returning({
            historyId: searchHistories.searchHistoryId,
            createdAtMs: searchHistories.createdAtMs
          })
          .get();

        return {
          kind: "search",
          historyId: created.historyId,
          filters: mutation.filters,
          dataSnapshotVersion: mutation.dataSnapshotVersion,
          recommendationVersion:
            mutation.recommendationVersion,
          resultCount: mutation.resultCount,
          createdAtMs: created.createdAtMs
        };
      }

      if (!isPublicStore(database, mutation.storeId)) {
        throw new StoreNotAvailableError();
      }

      const created = database
        .insert(selectionHistories)
        .values({
          userId,
          storeId: mutation.storeId,
          sourceSurface: mutation.sourceSurface,
          createdAtMs: now()
        })
        .returning({
          historyId: selectionHistories.selectionHistoryId,
          createdAtMs: selectionHistories.createdAtMs
        })
        .get();

      return {
        kind: "selection",
        historyId: created.historyId,
        storeId: mutation.storeId,
        sourceSurface: mutation.sourceSurface,
        createdAtMs: created.createdAtMs
      };
    },
    deleteHistory(
      userId: string,
      request: HistoryDelete
    ): boolean {
      const deletion = parseHistoryDelete(request);
      assertActiveUser(database, userId);

      const result =
        deletion.kind === "search"
          ? database
              .delete(searchHistories)
              .where(
                and(
                  eq(searchHistories.userId, userId),
                  eq(
                    searchHistories.searchHistoryId,
                    deletion.historyId
                  )
                )
              )
              .run()
          : database
              .delete(selectionHistories)
              .where(
                and(
                  eq(selectionHistories.userId, userId),
                  eq(
                    selectionHistories.selectionHistoryId,
                    deletion.historyId
                  )
                )
              )
              .run();

      return result.changes === 1;
    },
    withdraw(userId: string): {
      provider: "kakao";
      providerAccountId: string;
    } | null {
      return database.transaction((transaction) => {
        const user = transaction
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, userId))
          .get();
        const account = transaction
          .select({
            provider: accounts.provider,
            providerAccountId: accounts.providerAccountId
          })
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, userId),
              eq(accounts.provider, "kakao")
            )
          )
          .get();

        if (user?.status !== "ACTIVE" || account === undefined) {
          return null;
        }

        const deletedAtMs = now();
        transaction
          .update(users)
          .set({
            status: "DELETING",
            updatedAtMs: deletedAtMs,
            deletedAtMs
          })
          .where(
            and(
              eq(users.id, userId),
              eq(users.status, "ACTIVE")
            )
          )
          .run();
        transaction
          .delete(sessions)
          .where(eq(sessions.userId, userId))
          .run();
        transaction
          .delete(favorites)
          .where(eq(favorites.userId, userId))
          .run();
        transaction
          .delete(searchHistories)
          .where(eq(searchHistories.userId, userId))
          .run();
        transaction
          .delete(selectionHistories)
          .where(eq(selectionHistories.userId, userId))
          .run();
        transaction
          .delete(accounts)
          .where(eq(accounts.userId, userId))
          .run();
        transaction
          .delete(users)
          .where(eq(users.id, userId))
          .run();

        return {
          provider: "kakao" as const,
          providerAccountId: account.providerAccountId
        };
      });
    }
  };
}
