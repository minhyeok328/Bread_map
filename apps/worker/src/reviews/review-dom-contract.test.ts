import {
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadReviewDomContract } from "./review-dom-contract.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("review DOM contract", () => {
  it("loads the v2 synthetic pagination contract", async () => {
    await expect(
      loadReviewDomContract(
        resolve(
          "apps/worker/src/reviews/__fixtures__/selector-contract-v2.json"
        )
      )
    ).resolves.toMatchObject({
      version: "kakao-review-dom-v2",
      paginationMode: "append",
      reviewItem: "[data-bread-map-review-item]",
      nickname: "[data-bread-map-review-nickname]"
    });
  });

  it.each([
    ["v1", { version: "kakao-review-dom-v1" }],
    ["unknown pagination", { paginationMode: "scroll" }],
    ["empty selector", { reviewItem: "" }],
    ["network selector", { reviewItem: "https://example.test/reviews" }],
    ["script selector", { reviewItem: "script[data-review]" }],
    ["iframe selector", { reviewItem: "iframe[data-review]" }]
  ])("rejects %s contracts", async (_name, override) => {
    const directory = await mkdtemp(
      join(tmpdir(), "bread-map-review-contract-")
    );
    cleanupPaths.push(directory);
    const path = join(directory, "contract.json");
    await writeFile(
      path,
      JSON.stringify({
        version: "kakao-review-dom-v2",
        paginationMode: "append",
        reviewItem: "[data-bread-map-review-item]",
        body: "[data-bread-map-review-body]",
        rating: "[data-bread-map-review-rating]",
        publishedDate: "[data-bread-map-review-date]",
        nickname: "[data-bread-map-review-nickname]",
        nextButton: "[data-bread-map-review-next]",
        loginWall: "[data-bread-map-login-wall]",
        captcha: "[data-bread-map-captcha]",
        accessDenial: "[data-bread-map-access-denial]",
        ...override
      }),
      "utf8"
    );

    await expect(loadReviewDomContract(path)).rejects.toThrow(
      "REVIEW_DOM_CONTRACT_INVALID"
    );
  });
});
