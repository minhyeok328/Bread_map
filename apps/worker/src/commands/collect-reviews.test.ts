import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectReviewsCommand,
  readLiveReviewPage
} from "./collect-reviews.js";
import { loadReviewDomContract } from "../reviews/review-dom-contract.js";

const fixturePath = resolve(
  "apps/worker/src/reviews/__fixtures__/review-page-v1.html"
);
const contractPath = resolve(
  "apps/worker/src/reviews/__fixtures__/selector-contract-v1.json"
);

describe("collect reviews command", () => {
  it("runs a deterministic fixture without exposing review data", async () => {
    const lines: string[] = [];

    const summary = await collectReviewsCommand({
      argv: [
        "--fixture",
        fixturePath,
        "--selector-contract",
        contractPath
      ],
      stdout: (line) => lines.push(line),
      asOfDate: "2026-07-26",
      now: () => 1_000
    });

    expect(summary).toMatchObject({
      status: "SUCCEEDED",
      storeCount: 1,
      collectedCount: 20,
      failedStoreCount: 0
    });
    expect(lines).toEqual([JSON.stringify(summary)]);
    expect(lines[0]).not.toContain("Fixture review");
    expect(lines[0]).not.toContain("fixture-user");
    expect(lines[0]).not.toContain("data-bread-map");
  });

  it("rejects unsafe live modes before opening a browser", async () => {
    await expect(
      collectReviewsCommand({ argv: [] })
    ).rejects.toThrow("REVIEW_COLLECTION_MODE_REQUIRED");
    await expect(
      collectReviewsCommand({
        argv: [
          "--fixture",
          fixturePath,
          "--selector-contract",
          contractPath,
          "--live"
        ]
      })
    ).rejects.toThrow("REVIEW_COLLECTION_MODE_CONFLICT");
    await expect(
      collectReviewsCommand({
        argv: ["--live", "--one-page"]
      })
    ).rejects.toThrow("REVIEW_POLICY_ACKNOWLEDGEMENT_REQUIRED");
    await expect(
      collectReviewsCommand({
        argv: [
          "--live",
          "--acknowledge-policy-risk",
          "--one-page",
          "--pages",
          "2"
        ]
      })
    ).rejects.toThrow("REVIEW_PAGE_LIMIT_EXCEEDED");
    await expect(
      collectReviewsCommand({
        argv: ["--fixture", fixturePath]
      })
    ).rejects.toThrow("REVIEW_SELECTOR_CONTRACT_REQUIRED");
  });

  it("stops the provider on HTTP denial without reading the DOM", async () => {
    const contract = await loadReviewDomContract(contractPath);
    const locator = {
      count: async () => {
        throw new Error("DOM must not be read after access denial");
      },
      all: async () => [],
      locator: () => locator,
      textContent: async () => null
    };
    const page = {
      close: async () => undefined,
      goto: async () => ({
        status: () => 429,
        url: () => "https://place.map.kakao.com/fixture"
      }),
      locator: () => locator
    };

    await expect(
      readLiveReviewPage({
        page,
        locator: "https://place.map.kakao.com/fixture",
        pageNumber: 1,
        contract,
        asOfDate: "2026-07-26",
        assertSinglePage: () => undefined
      })
    ).resolves.toEqual({
      status: "STOP_PROVIDER",
      reasonCode: "ACCESS_DENIED"
    });
  });

  it("rejects a locator outside the Kakao Maps origin before navigation", async () => {
    const contract = await loadReviewDomContract(contractPath);
    let navigated = false;
    const locator = {
      count: async () => 0,
      all: async () => [],
      locator: () => locator,
      textContent: async () => null
    };
    const page = {
      close: async () => undefined,
      goto: async () => {
        navigated = true;
        return null;
      },
      locator: () => locator
    };

    await expect(
      readLiveReviewPage({
        page,
        locator: "https://example.com/redirect",
        pageNumber: 1,
        contract,
        asOfDate: "2026-07-26",
        assertSinglePage: () => undefined
      })
    ).resolves.toEqual({
      status: "STOP_PROVIDER",
      reasonCode: "DOM_CONTRACT_CHANGED"
    });
    expect(navigated).toBe(false);
  });
});
