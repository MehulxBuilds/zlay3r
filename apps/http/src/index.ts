import { Queue } from "bullmq";
import IORedis from "ioredis";
import { db, pool, sql } from "@repo/db";
import { server_env as env } from "@repo/env";
import { DockerSandboxProvider } from "@repo/sandbox";
import type { RunJob } from "@repo/shared";
import { buildApp } from "./app";
import { authRepository } from "./modules/auth/auth.repository";
import { createAuthService } from "./modules/auth/auth.service";
import { verifyGoogle } from "./modules/auth/google";
import { createSandboxService } from "./modules/sandboxes/sandbox.service";
import { createRunService } from "./modules/runs/run.service";

const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue<RunJob>("agent-runs", { connection: redis });
const sandboxes = createSandboxService(new DockerSandboxProvider());
const app = await buildApp({
  auth: createAuthService(authRepository, verifyGoogle),
  sandboxes,
  runs: createRunService(queue, sandboxes),
  async ready() {
    if (redis.status !== "ready") throw new Error("REDIS_UNAVAILABLE");
    await db.execute(sql`SELECT 1`);
    await redis.ping();
  },
  async close() {
    await queue.close();
    await redis.quit();
    await pool.end();
  },
});
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await app.close();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await shutdown();
}
