import type { AppDatabaseHandle } from "@bread-map/app-db";
import {
  parseStoreSearchRequest,
  type StoreSearchRequest,
  type StructuredSearchInput,
  type StructuredSearchResult
} from "@bread-map/contracts";
import {
  executeSqliteStoreSearch,
  resolveCurrentSqliteSearchDataVersion,
  StoreSearchError
} from "@bread-map/retrieval";
import { ZodError } from "zod";
import {
  InvalidJsonError,
  jsonError,
  readJsonBody,
  requireMutationOrigin
} from "./api-response.js";
import type {
  PrincipalResolver
} from "./authenticated-request.js";

export interface StoreSearchService {
  search(input: unknown): StructuredSearchResult;
}

export interface StoreSearchServiceDependencies {
  now: () => number;
  resolveCurrentDataVersion: (
    requestTimeMs: number
  ) => string;
  executeSearch: (
    input: StructuredSearchInput,
    requestTimeMs: number
  ) => StructuredSearchResult;
}

export interface StoreSearchRouteDependencies {
  resolvePrincipal: PrincipalResolver;
  service: StoreSearchService;
}

function toStructuredInput(
  request: StoreSearchRequest,
  dataSnapshotVersion: string
): StructuredSearchInput {
  return {
    ...request.query,
    dataSnapshotVersion
  };
}

export function createStoreSearchService(
  dependencies: StoreSearchServiceDependencies
): StoreSearchService {
  return {
    search(input) {
      const request = parseStoreSearchRequest(input);
      const requestTimeMs = dependencies.now();
      const dataSnapshotVersion =
        request.dataSnapshotVersion ??
        dependencies.resolveCurrentDataVersion(requestTimeMs);

      return dependencies.executeSearch(
        toStructuredInput(request, dataSnapshotVersion),
        requestTimeMs
      );
    }
  };
}

export function createSqliteStoreSearchService(
  appDatabase: AppDatabaseHandle,
  now: () => number = Date.now
): StoreSearchService {
  return createStoreSearchService({
    now,
    resolveCurrentDataVersion(requestTimeMs) {
      return resolveCurrentSqliteSearchDataVersion({
        appDatabase,
        requestTimeMs
      });
    },
    executeSearch(input, requestTimeMs) {
      return executeSqliteStoreSearch({
        appDatabase,
        input,
        requestTimeMs
      });
    }
  });
}

export function storeSearchErrorResponse(
  error: unknown
): Response {
  if (
    error instanceof InvalidJsonError ||
    error instanceof ZodError
  ) {
    return jsonError(400, "SEARCH_INPUT_INVALID");
  }

  if (error instanceof StoreSearchError) {
    switch (error.code) {
      case "SEARCH_INPUT_INVALID":
        return jsonError(400, error.code);
      case "SEARCH_DATA_VERSION_MISMATCH":
        return jsonError(409, error.code);
      case "SEARCH_DATA_STALE":
      case "SEARCH_DATA_UNAVAILABLE":
      case "SEARCH_DATABASE_UNAVAILABLE":
        return jsonError(503, error.code);
    }
  }

  return jsonError(500, "INTERNAL_ERROR");
}

export function createStoreSearchRouteHandlers(
  dependencies: StoreSearchRouteDependencies
) {
  return {
    async POST(request: Request): Promise<Response> {
      const originFailure = requireMutationOrigin(request);
      if (originFailure !== null) {
        return originFailure;
      }

      const principal =
        await dependencies.resolvePrincipal(request);
      if (principal === null) {
        return jsonError(401, "AUTHENTICATION_REQUIRED");
      }

      try {
        return Response.json(
          dependencies.service.search(
            await readJsonBody(request)
          )
        );
      } catch (error) {
        return storeSearchErrorResponse(error);
      }
    }
  };
}
