import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocaldataClient } from "./localdata-client.js";

interface Fixture {
  pages: unknown[];
}

function loadFixture(): Fixture {
  return JSON.parse(
    readFileSync(
      resolve(
        "apps/worker/src/catalog/__fixtures__/localdata-seoul.json"
      ),
      "utf8"
    )
  ) as Fixture;
}

describe("LOCALDATA client", () => {
  it("reads every fixture page using provider pagination parameters", async () => {
    const fixture = loadFixture();
    const requestedUrls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(
        typeof input === "string" ? input : input.toString()
      );
      requestedUrls.push(url);
      const pageNo = Number(url.searchParams.get("pageNo"));
      const page = fixture.pages[pageNo - 1];
      return new Response(JSON.stringify(page), {
        status: page === undefined ? 404 : 200,
        headers: { "content-type": "application/json" }
      });
    };
    const client = createLocaldataClient({
      serviceKey: "fixture-api-key",
      fetchImpl
    });

    const pages = await client.fetchAllPages({ numOfRows: 2 });

    expect(requestedUrls.map((url) => url.searchParams.get("pageNo"))).toEqual([
      "1",
      "2"
    ]);
    expect(
      requestedUrls.map((url) => url.searchParams.get("numOfRows"))
    ).toEqual(["2", "2"]);
    expect(
      requestedUrls.map((url) => url.searchParams.get("returnType"))
    ).toEqual(["json", "json"]);
    expect(pages.flatMap((page) => page.items)).toHaveLength(4);
  });

  it("returns a safe error without the API key or response body", async () => {
    const secret = "do-not-log-this-key";
    const fetchImpl: typeof fetch = async () =>
      new Response('{"private":"full response body"}', { status: 429 });
    const client = createLocaldataClient({
      serviceKey: secret,
      fetchImpl
    });

    const error = await client.fetchPage({
      pageNo: 1,
      numOfRows: 10
    }).catch((reason: unknown) => reason);
    const serialized = String(error);

    expect(serialized).toContain("LOCALDATA_HTTP_ERROR");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("full response body");
  });
});
