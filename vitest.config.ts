import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "workspace",
          include: [
            "scripts/**/*.test.ts",
            "apps/**/*.test.ts",
            "packages/**/*.test.ts"
          ]
        }
      }
    ]
  }
});
