import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@platform/database";
import { DockerSandboxProvider } from "@platform/sandbox";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null
});
const queue = new Queue("agent-runs", { connection: redis });
const docker = new DockerSandboxProvider();

const apiKey = process.env.API_KEY || "dev-change-me";
const organizationId = "development-org";

app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health" || request.url === "/health/ready") return;
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${apiKey}`) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
});

app.get("/health", async () => ({ ok: true }));
app.get("/health/ready", async () => {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    return { ready: true };
});

app.post("/v1/sandboxes", async (request, reply) => {
    const body = request.body as { name?: string; memoryMb?: number; cpu?: number };
    const name = (body.name || "sandbox").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
    const memoryMb = Math.min(Math.max(body.memoryMb ?? 512, 128), 2048);
    const cpu = Math.min(Math.max(body.cpu ?? 1, 0.25), 2);

    const record = await prisma.sandbox.create({
        data: { organizationId, name, memoryMb, cpu, status: "CREATING" }
    });

    try {
        const created = await docker.create({ name: record.id, memoryMb, cpu });
        const updated = await prisma.sandbox.update({
            where: { id: record.id },
            data: { resourceId: created.resourceId, status: "RUNNING" }
        });
        return reply.code(201).send(updated);
    } catch (error) {
        await prisma.sandbox.update({
            where: { id: record.id },
            data: { status: "FAILED" }
        });
        throw error;
    }
});

app.get("/v1/sandboxes", async () => {
    return prisma.sandbox.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" }
    });
});

app.post("/v1/sandboxes/:id/exec", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { command } = request.body as { command?: string };
    if (!command || command.length > 4000) {
        return reply.code(400).send({ error: "INVALID_COMMAND" });
    }
    const sandbox = await prisma.sandbox.findFirst({
        where: { id, organizationId, status: "RUNNING" }
    });
    if (!sandbox?.resourceId) return reply.code(404).send({ error: "SANDBOX_NOT_FOUND" });
    return docker.execute(sandbox.resourceId, command);
});

app.delete("/v1/sandboxes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const sandbox = await prisma.sandbox.findFirst({
        where: { id, organizationId }
    });
    if (!sandbox) return reply.code(404).send({ error: "SANDBOX_NOT_FOUND" });
    if (sandbox.resourceId) await docker.destroy(sandbox.resourceId);
    await prisma.sandbox.update({
        where: { id },
        data: { status: "DESTROYED", resourceId: null }
    });
    return reply.code(204).send();
});

app.post("/v1/runs", async (request, reply) => {
    const { sandboxId, task } = request.body as { sandboxId?: string; task?: string };
    if (!sandboxId || !task?.trim()) return reply.code(400).send({ error: "sandboxId and task are required" });

    const sandbox = await prisma.sandbox.findFirst({
        where: { id: sandboxId, organizationId, status: "RUNNING" }
    });
    if (!sandbox) return reply.code(404).send({ error: "SANDBOX_NOT_FOUND" });

    const run = await prisma.agentRun.create({
        data: { organizationId, sandboxId, task, status: "QUEUED" }
    });

    await queue.add("execute-agent-run", {
        runId: run.id,
        organizationId,
        sandboxId,
        task
    }, {
        jobId: run.id,
        attempts: 2,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000
    });

    return reply.code(202).send(run);
});

app.get("/v1/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await prisma.agentRun.findFirst({
        where: { id, organizationId },
        include: { events: { orderBy: { createdAt: "asc" } } }
    });
    if (!run) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    return run;
});

const port = Number(process.env.API_PORT || 3001);
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`API listening on ${port}`);

const shutdown = async () => {
    await app.close();
    await queue.close();
    await redis.quit();
    await prisma.$disconnect();
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
