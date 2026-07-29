import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectReviewsCommand,
  readLiveReviewPage,
  type LivePaginationState
} from "./collect-reviews.js";
import { loadReviewDomContract } from "../reviews/review-dom-contract.js";

const fixturePath = resolve(
  "apps/worker/src/reviews/__fixtures__/review-page-v1.html"
);
const contractPath = resolve(
  "apps/worker/src/reviews/__fixtures__/selector-contract-v2.json"
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
      collectedCount: 21,
      initialBackfillStoreCount: 1,
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
          "--run-budget-minutes",
          "60"
        ]
      })
    ).rejects.toThrow(
      "REVIEW_EXPANDED_VOLUME_ACKNOWLEDGEMENT_REQUIRED"
    );
    await expect(
      collectReviewsCommand({
        argv: [
          "--live",
          "--acknowledge-policy-risk",
          "--acknowledge-expanded-volume-risk",
          "--one-page"
        ]
      })
    ).rejects.toThrow("REVIEW_RUN_BUDGET_REQUIRED");
    await expect(
      collectReviewsCommand({
        argv: [
          "--live",
          "--acknowledge-policy-risk",
          "--acknowledge-expanded-volume-risk",
          "--one-page",
          "--pages",
          "2"
        ]
      })
    ).rejects.toThrow("REVIEW_PAGE_COUNT_OPTION_FORBIDDEN");
    for (const minutes of ["0", "481"]) {
      await expect(
        collectReviewsCommand({
          argv: [
            "--live",
            "--acknowledge-policy-risk",
            "--acknowledge-expanded-volume-risk",
            "--one-page",
            "--run-budget-minutes",
            minutes
          ]
        })
      ).rejects.toThrow("REVIEW_RUN_BUDGET_INVALID");
    }
    await expect(
      collectReviewsCommand({
        argv: [
          "--live",
          "--acknowledge-policy-risk",
          "--acknowledge-expanded-volume-risk",
          "--one-page",
          "--run-budget-minutes",
          "60",
          "--run-id",
          "new_run",
          "--resume-run",
          "existing_run"
        ]
      })
    ).rejects.toThrow("REVIEW_RUN_ID_CONFLICT");
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
      textContent: async () => null,
      click: async () => undefined
    };
    const page = {
      close: async () => undefined,
      on: () => undefined,
      url: () => "https://place.map.kakao.com/fixture",
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
      reasonCode: "RATE_LIMITED"
    });
  });

  it("rejects a locator outside the Kakao Maps origin before navigation", async () => {
    const contract = await loadReviewDomContract(contractPath);
    let navigated = false;
    const locator = {
      count: async () => 0,
      all: async () => [],
      locator: () => locator,
      textContent: async () => null,
      click: async () => undefined
    };
    const page = {
      close: async () => undefined,
      on: () => undefined,
      url: () => "https://example.com/redirect",
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
      reasonCode: "EXTERNAL_REDIRECT"
    });
    expect(navigated).toBe(false);
  });

  it("paginates append DOM on the same page with a fixed delay", async () => {
    const contract = await loadReviewDomContract(contractPath);
    const delays: number[] = [];
    let nextAvailable = true;
    let gotoCount = 0;
    let clickCount = 0;
    const reviews = [
      {
        body: "First fixture",
        rating: "5.0",
        date: "2026-07-20",
        nickname: "one"
      }
    ];
    const emptyLocator = {
      count: async () => 0,
      all: async () => [],
      locator: () => emptyLocator,
      textContent: async () => null,
      click: async () => undefined
    };
    const itemLocator = (review: (typeof reviews)[number]) => ({
      count: async () => 1,
      all: async () => [],
      locator: (selector: string) => {
        const value =
          selector === contract.body
            ? review.body
            : selector === contract.rating
              ? review.rating
              : selector === contract.publishedDate
                ? review.date
                : selector === contract.nickname
                  ? review.nickname
                  : null;
        return {
          ...emptyLocator,
          count: async () => (value === null ? 0 : 1),
          textContent: async () => value
        };
      },
      textContent: async () => null,
      click: async () => undefined
    });
    const page = {
      close: async () => undefined,
      on: () => undefined,
      url: () => "https://place.map.kakao.com/fixture",
      goto: async () => {
        gotoCount += 1;
        return {
          status: () => 200,
          url: () => "https://place.map.kakao.com/fixture"
        };
      },
      locator: (selector: string) => {
        if (selector === contract.reviewItem) {
          return {
            ...emptyLocator,
            count: async () => reviews.length,
            all: async () => reviews.map(itemLocator)
          };
        }
        if (selector === contract.nextButton) {
          return {
            ...emptyLocator,
            count: async () => (nextAvailable ? 1 : 0),
            click: async () => {
              clickCount += 1;
              reviews.push({
                body: "Second fixture",
                rating: "4.0",
                date: "2026-07-19",
                nickname: "two"
              });
              nextAvailable = false;
            }
          };
        }
        return emptyLocator;
      }
    };
    const paginationState: LivePaginationState = {
      loadedItemCount: 0,
      previousOldestPublishedDate: null,
      previousPageSignature: null,
      openedLocator: false
    };

    const first = await readLiveReviewPage({
      page,
      locator: "https://place.map.kakao.com/fixture",
      pageNumber: 1,
      contract,
      asOfDate: "2026-07-29",
      assertSinglePage: () => undefined,
      paginationState,
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      }
    });
    const second = await readLiveReviewPage({
      page,
      locator: "https://place.map.kakao.com/fixture",
      pageNumber: 2,
      contract,
      asOfDate: "2026-07-29",
      assertSinglePage: () => undefined,
      paginationState,
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      }
    });

    expect(first).toMatchObject({
      status: "OK",
      boundary: "MORE",
      totalItemCount: 1
    });
    expect(second).toMatchObject({
      status: "OK",
      boundary: "DOM_END",
      totalItemCount: 2
    });
    if (second.status === "OK") {
      expect(second.reviews).toHaveLength(1);
    }
    expect(gotoCount).toBe(1);
    expect(clickCount).toBe(1);
    expect(delays).toEqual([3_000]);
  });
});
