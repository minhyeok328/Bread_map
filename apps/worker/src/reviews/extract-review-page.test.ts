import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  extractReviewPage,
  type ReviewLocatorLike,
  type ReviewPageLike
} from "./extract-review-page.js";
import {
  loadReviewDomContract,
  type ReviewDomContract
} from "./review-dom-contract.js";

class FakeLocator implements ReviewLocatorLike {
  constructor(
    private readonly countValue: number,
    private readonly textValue: string | null = null,
    private readonly children: Map<string, string | null>[] = []
  ) {}

  async count(): Promise<number> {
    return this.countValue;
  }

  async all(): Promise<ReviewLocatorLike[]> {
    return this.children.map(
      (child) => new FakeItemLocator(child)
    );
  }

  locator(): ReviewLocatorLike {
    return new FakeLocator(0);
  }

  async textContent(): Promise<string | null> {
    return this.textValue;
  }
}

class FakeItemLocator implements ReviewLocatorLike {
  constructor(private readonly fields: Map<string, string | null>) {}

  async count(): Promise<number> {
    return 1;
  }

  async all(): Promise<ReviewLocatorLike[]> {
    return [this];
  }

  locator(selector: string): ReviewLocatorLike {
    if (!this.fields.has(selector)) {
      return new FakeLocator(0);
    }
    return new FakeLocator(1, this.fields.get(selector) ?? null);
  }

  async textContent(): Promise<string | null> {
    return null;
  }
}

function selectorAttribute(selector: string): string {
  const match = /^\[([a-z0-9-]+)\]$/iu.exec(selector);
  if (match?.[1] === undefined) {
    throw new Error("unsupported synthetic selector");
  }
  return match[1];
}

function textForAttribute(
  html: string,
  selector: string
): string | null {
  const attribute = selectorAttribute(selector);
  const match = new RegExp(
    `<[^>]+${attribute}(?:=(?:"[^"]*"|'[^']*'))?[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "iu"
  ).exec(html);
  return match?.[1]?.replace(/<[^>]*>/gu, "").trim() ?? null;
}

function fakePageFromHtml(
  html: string,
  contract: ReviewDomContract
): ReviewPageLike {
  const itemAttribute = selectorAttribute(contract.reviewItem);
  const itemPattern = new RegExp(
    `<article[^>]+${itemAttribute}[^>]*>([\\s\\S]*?)<\\/article>`,
    "giu"
  );
  const items = [...html.matchAll(itemPattern)].map((match) => {
    const itemHtml = match[1] ?? "";
    return new Map<string, string | null>([
      [contract.body, textForAttribute(itemHtml, contract.body)],
      [contract.rating, textForAttribute(itemHtml, contract.rating)],
      [
        contract.publishedDate,
        textForAttribute(itemHtml, contract.publishedDate)
      ],
      [
        contract.nickname,
        textForAttribute(itemHtml, contract.nickname)
      ]
    ]);
  });

  return {
    locator(selector: string): ReviewLocatorLike {
      if (selector === contract.reviewItem) {
        return new FakeLocator(items.length, null, items);
      }
      const attribute = selectorAttribute(selector);
      return new FakeLocator(
        html.includes(attribute) ? 1 : 0,
        textForAttribute(html, selector)
      );
    }
  };
}

function oneReviewHtml(input: {
  body?: string;
  rating?: string;
  date?: string;
  nickname?: string;
}): string {
  const body =
    input.body === undefined
      ? ""
      : `<p data-bread-map-review-body>${input.body}</p>`;
  const rating =
    input.rating === undefined
      ? ""
      : `<span data-bread-map-review-rating>${input.rating}</span>`;
  const date =
    input.date === undefined
      ? ""
      : `<time data-bread-map-review-date>${input.date}</time>`;
  const nickname =
    input.nickname === undefined
      ? ""
      : `<span data-bread-map-review-nickname>${input.nickname}</span>`;
  return `<article data-bread-map-review-item>${body}${rating}${date}${nickname}</article>`;
}

let contract: ReviewDomContract;

beforeAll(async () => {
  contract = await loadReviewDomContract(
    resolve(
      "apps/worker/src/reviews/__fixtures__/selector-contract-v1.json"
    )
  );
});

describe("review page extraction", () => {
  it("extracts memory-only fields and stops at twenty reviews", async () => {
    const html = await readFile(
      resolve(
        "apps/worker/src/reviews/__fixtures__/review-page-v1.html"
      ),
      "utf8"
    );

    const result = await extractReviewPage(
      fakePageFromHtml(html, contract),
      contract,
      { asOfDate: "2026-07-26", maxReviews: 20 }
    );

    expect(result.status).toBe("OK");
    if (result.status === "OK") {
      expect(result.reviews).toHaveLength(20);
      expect(result.reviews[0]).toEqual({
        body: "Fixture review 01",
        ratingBasisPoints: 5000,
        publishedDate: "2026-07-20",
        nickname: "fixture-user-01"
      });
      expect(result.hasNext).toBe(true);
    }
  });

  it("stops when it reaches a review older than twelve months", async () => {
    const html = [
      oneReviewHtml({
        body: "Recent review",
        rating: "4.0",
        date: "2026-07-01",
        nickname: "recent-user"
      }),
      oneReviewHtml({
        body: "Old review",
        rating: "3.0",
        date: "2025-06-25",
        nickname: "old-user"
      }),
      oneReviewHtml({
        body: "Never reached",
        rating: "5.0",
        date: "2025-06-20",
        nickname: "older-user"
      })
    ].join("");

    const result = await extractReviewPage(
      fakePageFromHtml(html, contract),
      contract,
      { asOfDate: "2026-07-26", maxReviews: 20 }
    );

    expect(result).toEqual({
      status: "OK",
      reviews: [
        {
          body: "Recent review",
          ratingBasisPoints: 4000,
          publishedDate: "2026-07-01",
          nickname: "recent-user"
        }
      ],
      hasNext: false
    });
  });

  it.each([
    [
      "<div data-bread-map-login-wall></div>",
      "LOGIN_REQUIRED"
    ],
    ["<div data-bread-map-captcha></div>", "CAPTCHA"],
    [
      "<div data-bread-map-access-denial></div>",
      "ACCESS_DENIED"
    ]
  ] as const)("stops on provider gate %s", async (html, reasonCode) => {
    await expect(
      extractReviewPage(
        fakePageFromHtml(html, contract),
        contract,
        { asOfDate: "2026-07-26", maxReviews: 20 }
      )
    ).resolves.toEqual({
      status: "STOP_PROVIDER",
      reasonCode
    });
  });

  it.each([
    "<main></main>",
    oneReviewHtml({
      rating: "5.0",
      date: "2026-07-01",
      nickname: "fixture"
    }),
    oneReviewHtml({
      body: "Missing date",
      rating: "5.0",
      nickname: "fixture"
    })
  ])("fails closed when the DOM contract changes", async (html) => {
    await expect(
      extractReviewPage(
        fakePageFromHtml(html, contract),
        contract,
        { asOfDate: "2026-07-26", maxReviews: 20 }
      )
    ).resolves.toEqual({
      status: "STOP_PROVIDER",
      reasonCode: "DOM_CONTRACT_CHANGED"
    });
  });
});
