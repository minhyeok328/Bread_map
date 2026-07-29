import { describe, expect, it } from "vitest";

import {
  findForbiddenLocalMvpDependencies,
  findForbiddenWebDependencies,
  findForbiddenWebRuntimeReferences
} from "./check-workspace-boundaries.js";

describe("findForbiddenWebDependencies", () => {
  it("rejects raw-db in any web dependency group", () => {
    const manifest = {
      dependencies: {
        "@bread-map/raw-db": "workspace:*"
      }
    };

    expect(findForbiddenWebDependencies(manifest)).toEqual([
      "dependencies.@bread-map/raw-db"
    ]);
  });

  it("allows the approved web package boundary", () => {
    const manifest = {
      dependencies: {
        "@bread-map/app-db": "workspace:*",
        "@bread-map/contracts": "workspace:*",
        "@bread-map/recommendation": "workspace:*"
      }
    };

    expect(findForbiddenWebDependencies(manifest)).toEqual([]);
  });
});

describe("findForbiddenWebRuntimeReferences", () => {
  it.each([
    "RAW_SQLITE_PATH",
    "raw.sqlite",
    "KAKAO_REST_API_KEY",
    "REVIEW_ENCRYPTION_KEY_BASE64",
    "REVIEW_HMAC_KEY_BASE64",
    "collect-reviews",
    "run-review-batch",
    "review_seen_fingerprint",
    "review_store_sync_state",
    "review-sync-state",
    "acknowledge-expanded-volume-risk",
    "resume-run"
  ])("rejects %s in web source", (reference) => {
    expect(findForbiddenWebRuntimeReferences(reference)).toEqual([
      reference
    ]);
  });
});

describe("findForbiddenLocalMvpDependencies", () => {
  it("rejects deferred AI and legacy database dependencies", () => {
    expect(
      findForbiddenLocalMvpDependencies({
        dependencies: {
          openai: "catalog:",
          "@prisma/client": "catalog:"
        }
      })
    ).toEqual(["dependencies.openai", "dependencies.@prisma/client"]);
  });
});
