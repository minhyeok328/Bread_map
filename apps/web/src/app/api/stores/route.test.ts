import { describe, expect, it } from "vitest";
import { POST, runtime } from "./route.js";

describe("/api/stores route module", () => {
  it("exports only the Node.js POST entry point needed for exact-origin search", () => {
    expect(runtime).toBe("nodejs");
    expect(POST).toBeTypeOf("function");
  });
});
