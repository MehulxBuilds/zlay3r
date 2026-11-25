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
import {
  platformAuthentication,
  authorize,
} from "./modules/platform/authorization";
import { registerPlatformRoutes } from "./modules/platform/platform.routes";
import { registerExecutionRoutes } from "./modules/platform/execution.routes";
import { registerBrowserRoutes } from "./modules/browser/browser.routes";
import { registerMcpRoutes } from "./modules/mcp/mcp.routes";
import { startTelemetry, stopTelemetry } from "@repo/observability";

startTelemetry("zlayer-http");
const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
const queue = new Queue<RunJob>("agent-runs", { connection: redis });
const provider = new DockerSandboxProvider();
const sandboxes = createSandboxService(provider);
const auth = createAuthService(authRepository, verifyGoogle);
const app = await buildApp({
  auth,
  rateLimitRedis: redis,
  authenticate: platformAuthentication(auth),
  async registerPlatform(app) {
    app.get("/workers/health", async (request) => {
      authorize(request, "models.read");
      const active = await redis.zcount(
        `zlayer:${env.INSTANCE_ID}:workers`,
        Date.now() - 30000,
        "+inf",
      );
      return { available: active > 0, activeWorkers: active };
    });
    await registerPlatformRoutes(app, provider);
    await registerExecutionRoutes(app, provider);
    await registerBrowserRoutes(app, provider);
    await registerMcpRoutes(app, provider);
  },
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
    await stopTelemetry();
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
