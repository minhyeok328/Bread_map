import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/raw-db/src/schema/index.ts",
  out: "./drizzle/raw"
});
