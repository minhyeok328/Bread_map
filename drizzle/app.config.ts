import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/app-db/src/schema/index.ts",
  out: "./drizzle/app"
});
