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
  it("loads the versioned synthetic selector contract", async () => {
    await expect(
      loadReviewDomContract(
        resolve(
          "apps/worker/src/reviews/__fixtures__/selector-contract-v1.json"
        )
      )
    ).resolves.toMatchObject({
      version: "kakao-review-dom-v1",
      reviewItem: "[data-bread-map-review-item]",
      nickname: "[data-bread-map-review-nickname]"
    });
  });

  it.each([
    {
      version: "unknown",
      reviewItem: "[data-bread-map-review-item]"
    },
    {
      version: "kakao-review-dom-v1",
      reviewItem: "script[data-review]"
    },
    {
      version: "kakao-review-dom-v1",
      reviewItem: "https://example.test/reviews"
    }
  ])("rejects incomplete, unknown or unsafe contracts", async (value) => {
    const directory = await mkdtemp(
      join(tmpdir(), "bread-map-review-contract-")
    );
    cleanupPaths.push(directory);
    const path = join(directory, "contract.json");
    await writeFile(path, JSON.stringify(value), "utf8");

    await expect(loadReviewDomContract(path)).rejects.toThrow(
      "REVIEW_DOM_CONTRACT_INVALID"
    );
  });
});
