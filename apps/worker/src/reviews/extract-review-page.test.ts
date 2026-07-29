import { resolve } from "node:path";
import {
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it
} from "vitest";
import {
  extractReviewPage,
  type ExtractReviewPageOptions,
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
      "apps/worker/src/reviews/__fixtures__/selector-contract-v2.json"
    )
  );
});

describe("review page extraction", () => {
  it("extracts every ordered item without a count cap", async () => {
    expectTypeOf<ExtractReviewPageOptions>().not.toHaveProperty(
      "maxReviews"
    );
    const html = [
      ...Array.from({ length: 25 }, (_, index) =>
        oneReviewHtml({
          body: `Fixture review ${index + 1}`,
          rating: "5.0",
          date: "2026-07-20",
          nickname: `fixture-user-${index + 1}`
        })
      ),
      "<button data-bread-map-review-next></button>"
    ].join("");
    const result = await extractReviewPage(
      fakePageFromHtml(html, contract),
      contract,
      {
        asOfDate: "2026-07-26",
        startIndex: 0,
        previousOldestPublishedDate: null
      }
    );

    expect(result).toMatchObject({
      status: "OK",
      boundary: "MORE",
      totalItemCount: 25,
      newestPublishedDate: "2026-07-20",
      oldestPublishedDate: "2026-07-20"
    });
    if (result.status === "OK") {
      expect(result.reviews).toHaveLength(25);
    }
  });

  it("returns only newly appended ordered items", async () => {
    const html = [
      oneReviewHtml({
        body: "First",
        rating: "5.0",
        date: "2026-07-20",
        nickname: "one"
      }),
      oneReviewHtml({
        body: "Second",
        rating: "4.0",
        date: "2026-07-19",
        nickname: "two"
      }),
      oneReviewHtml({
        body: "Newly appended",
        rating: "3.0",
        date: "2026-07-18",
        nickname: "three"
      }),
      "<button data-bread-map-review-next></button>"
    ].join("");

    const result = await extractReviewPage(
      fakePageFromHtml(html, contract),
      contract,
      {
        asOfDate: "2026-07-26",
        startIndex: 2,
        previousOldestPublishedDate: "2026-07-19"
      }
    );

    expect(result).toMatchObject({
      status: "OK",
      boundary: "MORE",
      totalItemCount: 3,
      newestPublishedDate: "2026-07-18",
      oldestPublishedDate: "2026-07-18"
    });
    if (result.status === "OK") {
      expect(result.reviews).toHaveLength(1);
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
      }),
      "<button data-bread-map-review-next></button>"
    ].join("");

    const result = await extractReviewPage(
      fakePageFromHtml(html, contract),
      contract,
      {
        asOfDate: "2026-07-26",
        startIndex: 0,
        previousOldestPublishedDate: null
      }
    );

    expect(result).toMatchObject({
      status: "OK",
      boundary: "CUTOFF",
      totalItemCount: 3,
      newestPublishedDate: "2026-07-01",
      oldestPublishedDate: "2026-07-01"
    });
    if (result.status === "OK") {
      expect(result.reviews).toHaveLength(1);
    }
  });

  it("returns DOM_END when no next control remains", async () => {
    const result = await extractReviewPage(
      fakePageFromHtml(
        oneReviewHtml({
          body: "Only",
          rating: "4.0",
          date: "2026-07-01",
          nickname: "fixture"
        }),
        contract
      ),
      contract,
      {
        asOfDate: "2026-07-26",
        startIndex: 0,
        previousOldestPublishedDate: null
      }
    );

    expect(result).toMatchObject({
      status: "OK",
      boundary: "DOM_END",
      totalItemCount: 1
    });
  });

  it("accepts an empty terminal DOM as no reviews", async () => {
    await expect(
      extractReviewPage(fakePageFromHtml("<main></main>", contract), contract, {
        asOfDate: "2026-07-26",
        startIndex: 0,
        previousOldestPublishedDate: null
      })
    ).resolves.toEqual({
      status: "OK",
      reviews: [],
      boundary: "DOM_END",
      totalItemCount: 0,
      newestPublishedDate: null,
      oldestPublishedDate: null,
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
        {
          asOfDate: "2026-07-26",
          startIndex: 0,
          previousOldestPublishedDate: null
        }
      )
    ).resolves.toEqual({
      status: "STOP_PROVIDER",
      reasonCode
    });
  });

  it.each([
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
        {
          asOfDate: "2026-07-26",
          startIndex: 0,
          previousOldestPublishedDate: null
        }
      )
    ).resolves.toEqual({
      status: "STOP_PROVIDER",
      reasonCode: "DOM_CONTRACT_CHANGED"
    });
  });

  it.each([
    [
      [
        oneReviewHtml({
          body: "Older first",
          rating: "4.0",
          date: "2026-07-01",
          nickname: "one"
        }),
        oneReviewHtml({
          body: "Newer second",
          rating: "4.0",
          date: "2026-07-02",
          nickname: "two"
        })
      ].join(""),
      null
    ],
    [
      oneReviewHtml({
        body: "Newer than prior page",
        rating: "4.0",
        date: "2026-07-20",
        nickname: "one"
      }),
      "2026-07-19"
    ]
  ] as const)(
    "fails closed when review order increases",
    async (html, previousOldestPublishedDate) => {
      await expect(
        extractReviewPage(
          fakePageFromHtml(html, contract),
          contract,
          {
            asOfDate: "2026-07-26",
            startIndex: 0,
            previousOldestPublishedDate
          }
        )
      ).resolves.toEqual({
        status: "STOP_PROVIDER",
        reasonCode: "DOM_CONTRACT_CHANGED"
      });
    }
  );

  it("fails closed when append pagination yields no new slice", async () => {
    const html = [
      oneReviewHtml({
        body: "Already processed",
        rating: "4.0",
        date: "2026-07-20",
        nickname: "one"
      }),
      "<button data-bread-map-review-next></button>"
    ].join("");

    await expect(
      extractReviewPage(fakePageFromHtml(html, contract), contract, {
        asOfDate: "2026-07-26",
        startIndex: 1,
        previousOldestPublishedDate: "2026-07-20"
      })
    ).resolves.toEqual({
      status: "STOP_PROVIDER",
      reasonCode: "DOM_CONTRACT_CHANGED"
    });
  });
});
