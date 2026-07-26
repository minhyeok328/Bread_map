import { z } from "zod";

export const KAKAO_KEYWORD_SEARCH_ENDPOINT =
  "https://dapi.kakao.com/v2/local/search/keyword.json";

export interface DiscoveryRect {
  minLongitude: number;
  minLatitude: number;
  maxLongitude: number;
  maxLatitude: number;
}

export interface KakaoPlaceDocument {
  id: string;
  place_name: string;
  category_name: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  place_url: string;
}

export interface KakaoPlacePage {
  meta: {
    total_count: number;
    pageable_count: number;
    is_end: boolean;
  };
  documents: KakaoPlaceDocument[];
}

export interface CreateKakaoPlaceClientOptions {
  restApiKey: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export interface KakaoPlaceClient {
  searchPage(input: {
    query: "빵집";
    rect: DiscoveryRect;
    page: number;
    size: 15;
  }): Promise<KakaoPlacePage>;
}

export type KakaoPlaceClientErrorCode =
  | "KAKAO_PLACE_CONFIGURATION_INVALID"
  | "KAKAO_PLACE_REQUEST_INVALID"
  | "KAKAO_PLACE_NETWORK_ERROR"
  | "KAKAO_PLACE_ACCESS_DENIED"
  | "KAKAO_PLACE_HTTP_ERROR"
  | "KAKAO_PLACE_RESPONSE_INVALID"
  | "KAKAO_PLACE_PAGE_MISMATCH"
  | "KAKAO_PLACE_PAGINATION_INVALID";

export class KakaoPlaceClientError extends Error {
  readonly code: KakaoPlaceClientErrorCode;

  constructor(code: KakaoPlaceClientErrorCode) {
    super(code);
    this.name = "KakaoPlaceClientError";
    this.code = code;
  }
}

const coordinateTextSchema = z.string().refine(
  (value) => value.trim() !== "" && Number.isFinite(Number(value)),
  "coordinate"
);

const kakaoPlaceDocumentSchema = z.object({
  id: z.string().min(1),
  place_name: z.string().min(1),
  category_name: z.string().min(1),
  phone: z.string(),
  address_name: z.string(),
  road_address_name: z.string(),
  x: coordinateTextSchema,
  y: coordinateTextSchema,
  place_url: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname === "place.map.kakao.com"
      );
    })
});

const kakaoPlacePageSchema = z.object({
  meta: z.object({
    total_count: z.number().int().nonnegative(),
    pageable_count: z.number().int().nonnegative(),
    is_end: z.boolean()
  }),
  documents: z.array(kakaoPlaceDocumentSchema)
});

function isValidRect(rect: DiscoveryRect): boolean {
  const values = [
    rect.minLongitude,
    rect.minLatitude,
    rect.maxLongitude,
    rect.maxLatitude
  ];
  return (
    values.every(Number.isFinite) &&
    rect.minLongitude < rect.maxLongitude &&
    rect.minLatitude < rect.maxLatitude &&
    rect.minLongitude >= -180 &&
    rect.maxLongitude <= 180 &&
    rect.minLatitude >= -90 &&
    rect.maxLatitude <= 90
  );
}

function assertValidRequest(input: {
  query: "빵집";
  rect: DiscoveryRect;
  page: number;
  size: 15;
}): void {
  if (
    input.query !== "빵집" ||
    !Number.isInteger(input.page) ||
    input.page < 1 ||
    input.page > 45 ||
    input.size !== 15 ||
    !isValidRect(input.rect)
  ) {
    throw new KakaoPlaceClientError(
      "KAKAO_PLACE_REQUEST_INVALID"
    );
  }
}

function validatePagination(
  page: KakaoPlacePage,
  requestedPage: number,
  requestedSize: number
): void {
  if (
    page.meta.pageable_count > page.meta.total_count ||
    page.documents.length > requestedSize
  ) {
    throw new KakaoPlaceClientError(
      "KAKAO_PLACE_PAGINATION_INVALID"
    );
  }

  const pageStart = (requestedPage - 1) * requestedSize;
  const expectedCount = Math.min(
    requestedSize,
    Math.max(0, page.meta.pageable_count - pageStart)
  );
  const expectedIsEnd =
    requestedPage * requestedSize >= page.meta.pageable_count;

  if (
    page.documents.length !== expectedCount ||
    page.meta.is_end !== expectedIsEnd
  ) {
    throw new KakaoPlaceClientError("KAKAO_PLACE_PAGE_MISMATCH");
  }
}

export function createKakaoPlaceClient({
  restApiKey,
  fetchImpl = fetch,
  endpoint = KAKAO_KEYWORD_SEARCH_ENDPOINT
}: CreateKakaoPlaceClientOptions): KakaoPlaceClient {
  const normalizedKey = restApiKey.trim();
  let normalizedEndpoint: URL;
  try {
    normalizedEndpoint = new URL(endpoint);
  } catch {
    throw new KakaoPlaceClientError(
      "KAKAO_PLACE_CONFIGURATION_INVALID"
    );
  }
  if (
    normalizedKey === "" ||
    normalizedEndpoint.href !== KAKAO_KEYWORD_SEARCH_ENDPOINT
  ) {
    throw new KakaoPlaceClientError(
      "KAKAO_PLACE_CONFIGURATION_INVALID"
    );
  }

  async function searchPage(
    input: Parameters<KakaoPlaceClient["searchPage"]>[0]
  ): Promise<KakaoPlacePage> {
    assertValidRequest(input);
    const url = new URL(normalizedEndpoint);
    url.searchParams.set("query", input.query);
    url.searchParams.set(
      "rect",
      [
        input.rect.minLongitude,
        input.rect.minLatitude,
        input.rect.maxLongitude,
        input.rect.maxLatitude
      ].join(",")
    );
    url.searchParams.set("page", String(input.page));
    url.searchParams.set("size", String(input.size));
    const request = new Request(url, {
      headers: {
        Authorization: `KakaoAK ${normalizedKey}`
      }
    });

    let response: Response;
    try {
      response = await fetchImpl(request);
    } catch {
      throw new KakaoPlaceClientError("KAKAO_PLACE_NETWORK_ERROR");
    }
    if ([401, 403, 429].includes(response.status)) {
      throw new KakaoPlaceClientError(
        "KAKAO_PLACE_ACCESS_DENIED"
      );
    }
    if (!response.ok) {
      throw new KakaoPlaceClientError("KAKAO_PLACE_HTTP_ERROR");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new KakaoPlaceClientError(
        "KAKAO_PLACE_RESPONSE_INVALID"
      );
    }
    const parsed = kakaoPlacePageSchema.safeParse(body);
    if (!parsed.success) {
      throw new KakaoPlaceClientError(
        "KAKAO_PLACE_RESPONSE_INVALID"
      );
    }

    validatePagination(parsed.data, input.page, input.size);
    return parsed.data;
  }

  return { searchPage };
}
