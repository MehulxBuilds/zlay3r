import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { server_env as env } from "@repo/env";
import * as schema from "../schema/index";

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
export const db = drizzle(pool, { schema });
