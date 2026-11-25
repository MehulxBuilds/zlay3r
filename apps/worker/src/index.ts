import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@platform/database";
import { DockerSandboxProvider } from "@platform/sandbox";
import { AgentRuntime } from "@platform/agent-runtime";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null
});
const sandbox = new DockerSandboxProvider();
const runtime = new AgentRuntime(sandbox);

const worker = new Worker("agent-runs", async (job) => {
  const { runId, sandboxId, task, organizationId } = job.data as {
    runId: string;
    sandboxId: string;
    task: string;
    organizationId: string;
  };

  const run = await prisma.agentRun.findFirst({
    where: { id: runId, organizationId }
  });
  if (!run) throw new Error("RUN_NOT_FOUND");
  if (run.status === "COMPLETED") return run.result;

  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: new Date() }
  });

  await prisma.agentEvent.create({
    data: {
      runId,
      type: "RUN_STARTED",
      payload: { workerJobId: job.id }
    }
  });

  try {
    const result = await runtime.run({ sandboxId: (await prisma.sandbox.findUniqueOrThrow({
      where: { id: sandboxId }
    })).resourceId!, task });

    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: "COMPLETED",
        result,
        completedAt: new Date()
      }
    });

    await prisma.agentEvent.create({
      data: { runId, type: "RUN_COMPLETED", payload: result }
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: "FAILED", error: message, completedAt: new Date() }
    });
    await prisma.agentEvent.create({
      data: { runId, type: "RUN_FAILED", payload: { error: message } }
    });
    throw error;
  }
}, { connection, concurrency: 3 });

worker.on("completed", job => console.log("completed", job.id));
worker.on("failed", (job, error) => console.error("failed", job?.id, error));

const shutdown = async () => {
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
