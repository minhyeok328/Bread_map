import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createKakaoPlaceClient,
  type DiscoveryRect
} from "./kakao-place-client.js";

interface Fixture {
  pages: unknown[];
}

const rect: DiscoveryRect = {
  minLongitude: 126.7,
  minLatitude: 37.4,
  maxLongitude: 127.3,
  maxLatitude: 37.75
};

function loadFixture(): Fixture {
  return JSON.parse(
    readFileSync(
      resolve(
        "apps/worker/src/reviews/__fixtures__/kakao-place-pages.json"
      ),
      "utf8"
    )
  ) as Fixture;
}

function createClientForBody(
  body: unknown,
  status = 200
): ReturnType<typeof createKakaoPlaceClient> {
  return createKakaoPlaceClient({
    restApiKey: "fixture-rest-key",
    fetchImpl: async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" }
      })
  });
}

async function getSafeError(
  client: ReturnType<typeof createKakaoPlaceClient>,
  page = 1
): Promise<string> {
  const error = await client
    .searchPage({ query: "빵집", rect, page, size: 15 })
    .catch((reason: unknown) => reason);
  return String(error);
}

describe("Kakao place client", () => {
  it("rejects non-official endpoints before attaching credentials", () => {
    expect(() =>
      createKakaoPlaceClient({
        restApiKey: "fixture-rest-key",
        endpoint: "https://example.com/keyword.json"
      })
    ).toThrow("KAKAO_PLACE_CONFIGURATION_INVALID");
  });

  it("uses the official keyword endpoint and projects a valid page", async () => {
    const fixture = loadFixture();
    let capturedRequest: Request | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedRequest = new Request(input, init);
      return new Response(JSON.stringify(fixture.pages[0]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const client = createKakaoPlaceClient({
      restApiKey: "fixture-rest-key",
      fetchImpl
    });

    const page = await client.searchPage({
      query: "빵집",
      rect,
      page: 1,
      size: 15
    });

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.headers.get("Authorization")).toBe(
      "KakaoAK fixture-rest-key"
    );
    expect(capturedRequest?.url).toContain(
      "query=%EB%B9%B5%EC%A7%91"
    );
    expect(capturedRequest?.url).toContain("page=1");
    expect(capturedRequest?.url).toContain("size=15");
    expect(capturedRequest?.url).toContain(
      "rect=126.7%2C37.4%2C127.3%2C37.75"
    );
    expect(page.documents[0]).toEqual({
      id: "fixture-place-1",
      place_name: "Fixture Bakery",
      category_name: "음식점 > 간식 > 제과,베이커리",
      phone: "02-000-0000",
      address_name: "서울특별시 마포구 Fixture 1",
      road_address_name: "서울특별시 마포구 Fixture로 1",
      x: "126.9",
      y: "37.56",
      place_url: "https://place.map.kakao.com/fixture-place-1"
    });
  });

  it("returns non-sensitive transport and parse errors", async () => {
    const secret = "do-not-log-this-rest-key";
    const responseBody = '{"private":"full provider body"}';
    const accessDeniedClient = createKakaoPlaceClient({
      restApiKey: secret,
      fetchImpl: async () =>
        new Response(responseBody, { status: 429 })
    });
    const httpClient = createKakaoPlaceClient({
      restApiKey: secret,
      fetchImpl: async () =>
        new Response(responseBody, { status: 500 })
    });
    const invalidJsonClient = createKakaoPlaceClient({
      restApiKey: secret,
      fetchImpl: async () =>
        new Response("not-json", { status: 200 })
    });
    const networkClient = createKakaoPlaceClient({
      restApiKey: secret,
      fetchImpl: async () => {
        throw new Error("provider detail");
      }
    });

    for (const [client, code] of [
      [accessDeniedClient, "KAKAO_PLACE_ACCESS_DENIED"],
      [httpClient, "KAKAO_PLACE_HTTP_ERROR"],
      [invalidJsonClient, "KAKAO_PLACE_RESPONSE_INVALID"],
      [networkClient, "KAKAO_PLACE_NETWORK_ERROR"]
    ] as const) {
      const serialized = await getSafeError(client);
      expect(serialized).toContain(code);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("full provider body");
      expect(serialized).not.toContain("provider detail");
    }
  });

  it("rejects invalid fields, oversized pages and mismatched pagination", async () => {
    const validDocument = {
      id: "fixture",
      place_name: "Fixture Bakery",
      category_name: "음식점 > 간식 > 제과,베이커리",
      phone: "",
      address_name: "서울특별시 마포구 Fixture 1",
      road_address_name: "",
      x: "126.9",
      y: "37.56",
      place_url: "https://place.map.kakao.com/fixture"
    };
    const invalidField = {
      meta: { total_count: 1, pageable_count: 1, is_end: true },
      documents: [{ ...validDocument, place_name: 123 }]
    };
    const oversized = {
      meta: { total_count: 16, pageable_count: 16, is_end: false },
      documents: Array.from({ length: 16 }, (_, index) => ({
        ...validDocument,
        id: `fixture-${index}`
      }))
    };
    const mismatched = {
      meta: { total_count: 20, pageable_count: 20, is_end: false },
      documents: [validDocument]
    };

    expect(
      await getSafeError(createClientForBody(invalidField))
    ).toContain("KAKAO_PLACE_RESPONSE_INVALID");
    expect(
      await getSafeError(createClientForBody(oversized))
    ).toContain("KAKAO_PLACE_PAGINATION_INVALID");
    expect(
      await getSafeError(createClientForBody(mismatched), 2)
    ).toContain("KAKAO_PLACE_PAGE_MISMATCH");
  });

  it("rejects place locators outside the Kakao Maps origin", async () => {
    const client = createClientForBody({
      meta: { total_count: 1, pageable_count: 1, is_end: true },
      documents: [
        {
          id: "fixture",
          place_name: "Fixture Bakery",
          category_name: "음식점 > 간식 > 제과,베이커리",
          phone: "",
          address_name: "서울특별시 마포구 Fixture 1",
          road_address_name: "",
          x: "126.9",
          y: "37.56",
          place_url: "https://example.com/redirect"
        }
      ]
    });

    expect(await getSafeError(client)).toContain(
      "KAKAO_PLACE_RESPONSE_INVALID"
    );
  });
});
