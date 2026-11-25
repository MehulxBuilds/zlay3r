import { Worker } from "bullmq";
import IORedis from "ioredis";
import {
  agentEvent,
  agentRun,
  and,
  db,
  eq,
  pool,
  sandbox as sandboxTable,
} from "@repo/db";
import { server_env as env } from "@repo/env";
import { DockerSandboxProvider } from "@repo/sandbox";
import { AgentRuntime } from "@repo/agent-runtime";
import type { RunJob } from "@repo/shared";

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const runtime = new AgentRuntime(new DockerSandboxProvider());
const worker = new Worker<RunJob>(
  "agent-runs",
  async (job) => {
    const { runId, sandboxId, task, organizationId } = job.data;
    const runWhere = and(
      eq(agentRun.id, runId),
      eq(agentRun.organizationId, organizationId),
    );
    const [run] = await db.select().from(agentRun).where(runWhere).limit(1);
    if (!run || run.sandboxId !== sandboxId || run.task !== task)
      throw new Error("RUN_NOT_FOUND");
    if (run.status === "COMPLETED") return run.result;
    await db
      .update(agentRun)
      .set({
        status: "RUNNING",
        startedAt: new Date(),
        completedAt: null,
        error: null,
      })
      .where(runWhere);
    await db
      .insert(agentEvent)
      .values({ runId, type: "RUN_STARTED", payload: { workerJobId: job.id } });
    try {
      const [sandbox] = await db
        .select()
        .from(sandboxTable)
        .where(
          and(
            eq(sandboxTable.id, sandboxId),
            eq(sandboxTable.organizationId, organizationId),
            eq(sandboxTable.status, "RUNNING"),
          ),
        )
        .limit(1);
      if (!sandbox?.resourceId) throw new Error("SANDBOX_NOT_FOUND");
      const result = await runtime.run({ sandboxId: sandbox.resourceId, task });
      await db.transaction(async (tx) => {
        await tx
          .update(agentRun)
          .set({ status: "COMPLETED", result, completedAt: new Date() })
          .where(runWhere);
        await tx
          .insert(agentEvent)
          .values({ runId, type: "RUN_COMPLETED", payload: result });
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      await db.transaction(async (tx) => {
        await tx
          .update(agentRun)
          .set({ status: "FAILED", error: message, completedAt: new Date() })
          .where(runWhere);
        await tx
          .insert(agentEvent)
          .values({ runId, type: "RUN_FAILED", payload: { error: message } });
      });
      throw error;
    }
  },
  { connection, concurrency: 3 },
);
worker.on("completed", (job) => console.log("completed", job.id));
worker.on("failed", (job, error) => console.error("failed", job?.id, error));
worker.on("error", (error) => console.error("worker error", error));
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await worker.close();
  await connection.quit();
  await pool.end();
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
