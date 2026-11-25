import { defineConfig } from "drizzle-kit";
import { server_env as env } from "@repo/env";

export default defineConfig({
  out: "./drizzle",
  schema: "./schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
