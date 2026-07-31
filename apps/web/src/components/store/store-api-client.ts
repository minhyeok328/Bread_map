import {
  storeDetailResponseSchema,
  structuredSearchResultSchema,
  type StoreDetailResponse,
  type StoreSearchRequest,
  type StructuredSearchResult
} from "@bread-map/contracts";

const publicServerErrorCodes = new Set([
  "AUTHENTICATION_REQUIRED",
  "ORIGIN_REQUIRED",
  "RESOURCE_NOT_FOUND",
  "SEARCH_INPUT_INVALID",
  "SEARCH_DATA_VERSION_MISMATCH",
  "SEARCH_DATA_STALE",
  "SEARCH_DATA_UNAVAILABLE",
  "SEARCH_DATABASE_UNAVAILABLE",
  "INTERNAL_ERROR"
]);

export type PublicApiErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "ORIGIN_REQUIRED"
  | "RESOURCE_NOT_FOUND"
  | "SEARCH_INPUT_INVALID"
  | "SEARCH_DATA_VERSION_MISMATCH"
  | "SEARCH_DATA_STALE"
  | "SEARCH_DATA_UNAVAILABLE"
  | "SEARCH_DATABASE_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "INVALID_RESPONSE"
  | "NETWORK_UNAVAILABLE"
  | "REQUEST_ABORTED"
  | "REQUEST_FAILED"
  | "SNAPSHOT_MISMATCH"
  | "STORE_ID_MISMATCH";

export class PublicApiError extends Error {
  readonly code: PublicApiErrorCode;
  readonly status: number | undefined;

  constructor(
    code: PublicApiErrorCode,
    status?: number
  ) {
    super(`Public API request failed: ${code}`);
    this.name = "PublicApiError";
    this.code = code;
    this.status = status;
  }
}

export interface PublicRequestOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

interface PublicErrorEnvelope {
  error?: {
    code?: unknown;
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException &&
      error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

async function performFetch(
  input: string,
  init: RequestInit,
  options: PublicRequestOptions
): Promise<Response> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  try {
    return await fetchImplementation(input, {
      ...init,
      ...(options.signal === undefined
        ? {}
        : { signal: options.signal })
    });
  } catch (error) {
    throw new PublicApiError(
      isAbortError(error)
        ? "REQUEST_ABORTED"
        : "NETWORK_UNAVAILABLE"
    );
  }
}

async function readUnknownJson(
  response: Response
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PublicApiError(
      response.ok ? "INVALID_RESPONSE" : "REQUEST_FAILED",
      response.status
    );
  }
}

function errorCodeFromResponse(
  body: unknown
): PublicApiErrorCode {
  const code = (body as PublicErrorEnvelope | null)?.error?.code;
  return typeof code === "string" &&
    publicServerErrorCodes.has(code)
    ? (code as PublicApiErrorCode)
    : "REQUEST_FAILED";
}

async function requireSuccessfulJson(
  response: Response
): Promise<unknown> {
  const body = await readUnknownJson(response);
  if (!response.ok) {
    throw new PublicApiError(
      errorCodeFromResponse(body),
      response.status
    );
  }
  return body;
}

export async function searchStores(
  request: StoreSearchRequest,
  options: PublicRequestOptions = {}
): Promise<StructuredSearchResult> {
  const response = await performFetch(
    "/api/stores",
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    },
    options
  );
  const parsed = structuredSearchResultSchema.safeParse(
    await requireSuccessfulJson(response)
  );
  if (!parsed.success) {
    throw new PublicApiError(
      "INVALID_RESPONSE",
      response.status
    );
  }
  return parsed.data;
}

export async function readStoreDetail(
  storeId: string,
  dataSnapshotVersion: string,
  options: PublicRequestOptions = {}
): Promise<StoreDetailResponse> {
  const query = new URLSearchParams({
    dataSnapshotVersion,
    reviewPage: "1",
    reviewLimit: "10"
  });
  const response = await performFetch(
    `/api/stores/${encodeURIComponent(storeId)}?${query.toString()}`,
    {
      method: "GET",
      credentials: "same-origin"
    },
    options
  );
  const parsed = storeDetailResponseSchema.safeParse(
    await requireSuccessfulJson(response)
  );
  if (!parsed.success) {
    throw new PublicApiError(
      "INVALID_RESPONSE",
      response.status
    );
  }
  if (
    parsed.data.metadata.dataSnapshotVersion !==
    dataSnapshotVersion
  ) {
    throw new PublicApiError(
      "SNAPSHOT_MISMATCH",
      response.status
    );
  }
  if (parsed.data.store.storeId !== storeId) {
    throw new PublicApiError(
      "STORE_ID_MISMATCH",
      response.status
    );
  }
  return parsed.data;
}
