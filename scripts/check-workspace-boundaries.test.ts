import { describe, expect, it } from "vitest";

import { findForbiddenWebDependencies } from "./check-workspace-boundaries.js";

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
