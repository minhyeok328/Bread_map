import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    settings: {
      next: {
        rootDir: "apps/web/"
      }
    }
  },
  {
    files: ["apps/web/**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@bread-map/raw-db",
              message: "apps/web must not access raw_db. Use a worker-owned contract instead."
            }
          ],
          patterns: [
            {
              group: ["@bread-map/raw-db/*"],
              message: "apps/web must not access raw_db. Use a worker-owned contract instead."
            }
          ]
        }
      ]
    }
  },
  globalIgnores([
    "**/.next/**",
    "**/dist/**",
    "**/coverage/**",
    "**/node_modules/**",
    "playwright-report/**",
    "test-results/**"
  ])
]);
