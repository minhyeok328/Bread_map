import { describe, expect, it } from "vitest";
import { GET, runtime } from "./route.js";

describe("/api/stores/[storeId] route module", () => {
  it("exports the Node.js detail GET entry point", () => {
    expect(runtime).toBe("nodejs");
    expect(GET).toBeTypeOf("function");
  });
});
