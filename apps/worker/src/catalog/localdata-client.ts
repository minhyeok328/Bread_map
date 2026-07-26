import {
  localdataPageResponseSchema,
  type LocaldataPage
} from "@bread-map/contracts";

export const LOCALDATA_BAKERIES_INFO_URL =
  "https://apis.data.go.kr/1741000/bakeries/info";

export type LocaldataClientErrorCode =
  | "LOCALDATA_NETWORK_ERROR"
  | "LOCALDATA_HTTP_ERROR"
  | "LOCALDATA_RESPONSE_INVALID"
  | "LOCALDATA_PAGE_MISMATCH"
  | "LOCALDATA_PAGINATION_INVALID";

export class LocaldataClientError extends Error {
  readonly code: LocaldataClientErrorCode;

  constructor(code: LocaldataClientErrorCode) {
    super(code);
    this.name = "LocaldataClientError";
    this.code = code;
  }
}

export interface FetchLocaldataPageOptions {
  pageNo: number;
  numOfRows: number;
}

export interface FetchAllLocaldataPagesOptions {
  numOfRows: number;
}

export interface LocaldataClient {
  fetchPage(options: FetchLocaldataPageOptions): Promise<LocaldataPage>;
  fetchAllPages(
    options: FetchAllLocaldataPagesOptions
  ): Promise<LocaldataPage[]>;
}

export interface CreateLocaldataClientOptions {
  serviceKey: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export function createLocaldataClient(
  options: CreateLocaldataClientOptions
): LocaldataClient {
  const serviceKey = options.serviceKey.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? LOCALDATA_BAKERIES_INFO_URL;

  async function fetchPage({
    pageNo,
    numOfRows
  }: FetchLocaldataPageOptions): Promise<LocaldataPage> {
    const url = new URL(endpoint);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));
    url.searchParams.set("returnType", "json");

    let response: Response;
    try {
      response = await fetchImpl(url);
    } catch {
      throw new LocaldataClientError("LOCALDATA_NETWORK_ERROR");
    }

    if (!response.ok) {
      throw new LocaldataClientError("LOCALDATA_HTTP_ERROR");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LocaldataClientError("LOCALDATA_RESPONSE_INVALID");
    }

    const parsed = localdataPageResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new LocaldataClientError("LOCALDATA_RESPONSE_INVALID");
    }
    if (parsed.data.pageNo !== pageNo) {
      throw new LocaldataClientError("LOCALDATA_PAGE_MISMATCH");
    }
    if (
      parsed.data.numOfRows !== numOfRows ||
      parsed.data.items.length > numOfRows
    ) {
      throw new LocaldataClientError("LOCALDATA_PAGINATION_INVALID");
    }

    return parsed.data;
  }

  async function fetchAllPages({
    numOfRows
  }: FetchAllLocaldataPagesOptions): Promise<LocaldataPage[]> {
    const pages: LocaldataPage[] = [];
    let pageNo = 1;
    let expectedTotalCount: number | undefined;

    while (true) {
      const page = await fetchPage({ pageNo, numOfRows });
      expectedTotalCount ??= page.totalCount;
      if (page.totalCount !== expectedTotalCount) {
        throw new LocaldataClientError(
          "LOCALDATA_PAGINATION_INVALID"
        );
      }
      pages.push(page);

      if (pageNo * numOfRows >= expectedTotalCount) {
        break;
      }
      pageNo += 1;
    }

    const rowCount = pages.reduce(
      (count, page) => count + page.items.length,
      0
    );
    if (rowCount !== expectedTotalCount) {
      throw new LocaldataClientError("LOCALDATA_PAGINATION_INVALID");
    }

    return pages;
  }

  return { fetchPage, fetchAllPages };
}
