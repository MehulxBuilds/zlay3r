import { runSandboxAgent } from "./agent-supervisor";
import { DelayedError, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { randomUUID } from "node:crypto";
import {
  agentRun,
  and,
  db,
  eq,
  pool,
  sandbox,
  outbox,
  isNull,
  sql,
  execution,
  executionPolicy,
  providerConfiguration,
  decrypt,
  checkpoint,
  browserSession,
  desc,
  appendRunEvent,
  usageEvent,
  message,
  evaluateAction,
  mcpServer,
  secret,
  inArray,
  toolExecution,
  toolDefinition,
  appendRunEventTx,
  settleRunUsage,
  resolveSecrets,
  priceModelUsage,
  recordModelUsage,
  type ModelUsage,
} from "@repo/db";
import { server_env as env } from "@repo/env";
import { createSandboxProvider } from "@repo/sandbox";
import {
  ModelRouter,
  AnthropicProvider,
  OpenAIProvider,
  DeepSeekProvider,
  OpenRouterProvider,
  type ProviderName,
  type ModelMessage,
} from "@repo/agent-runtime";
import type { RunJob } from "@repo/shared";
import { uploadArtifact, reconcileUploads } from "@repo/storage";
import {
  logger,
  startTelemetry,
  stopTelemetry,
  span,
  withCarrier,
  recordQueueWait,
} from "@repo/observability";
import {
  sandboxTools,
  McpClient,
  httpMcpTransport,
  type McpTransport,
} from "@repo/agent-runtime";

startTelemetry("zlayer-worker");
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const publisherConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
});
const provider = createSandboxProvider();
const owner = randomUUID();
const queues = new Map(
  ["agent-runs", "shell-executions"].map((name) => [
    name,
    new Queue(name, { connection: publisherConnection }),
  ]),
);
let publishing = false,
  shuttingDown = false;
async function publish() {
  if (publishing || shuttingDown) return;
  publishing = true;
  try {
    const records = await db
      .select()
      .from(outbox)
      .where(isNull(outbox.publishedAt))
      .orderBy(outbox.createdAt)
      .limit(100);
    for (const record of records) {
      const queue = queues.get(record.topic);
      if (!queue) throw new Error("UNKNOWN_OUTBOX_TOPIC");
      await queue.add(record.topic, record.payload, {
        jobId: record.id,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
      await db
        .update(outbox)
        .set({ publishedAt: new Date() })
        .where(eq(outbox.id, record.id));
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.name : "UNKNOWN" },
      "Outbox publication failed",
    );
  } finally {
    publishing = false;
  }
}
const publisher = setInterval(() => {
  void publish();
}, 1000);

async function router(organizationId: string, primary: string) {
  const [primaryConfig] = await db
    .select()
    .from(providerConfiguration)
    .where(
      and(
        eq(providerConfiguration.organizationId, organizationId),
        eq(providerConfiguration.provider, primary),
      ),
    )
    .limit(1);
  const fallbacks =
    (primaryConfig?.settings as { fallbacks?: ProviderName[] } | undefined)
      ?.fallbacks ?? [];
  return new ModelRouter(async (name: ProviderName) => {
    const [config] = await db
      .select()
      .from(providerConfiguration)
      .where(
        and(
          eq(providerConfiguration.organizationId, organizationId),
          eq(providerConfiguration.provider, name),
        ),
      )
      .limit(1);
    if (!config) {
      if (name === "openai" && env.MODEL_API_KEY)
        return {
          provider: new OpenAIProvider(env.MODEL_API_KEY, env.MODEL_BASE_URL),
          model: env.MODEL_NAME,
        };
      throw new Error("PROVIDER_NOT_CONFIGURED");
    }
    const key = decrypt(config.credential, organizationId);
    const settings = config.settings as {
      routing?: Record<string, unknown>;
      aliases?: Record<string, string>;
    };
    const adapter =
      name === "anthropic"
        ? new AnthropicProvider(key)
        : name === "deepseek"
          ? new DeepSeekProvider(key)
          : name === "openrouter"
            ? new OpenRouterProvider(key, settings.routing)
            : new OpenAIProvider(key);
    return {
      provider: adapter,
      model: config.model,
      aliases: settings.aliases,
    };
  }, fallbacks);
}

const worker = new Worker<RunJob>(
  "agent-runs",
  async (job, token) =>
    withCarrier(job.data.trace ?? {}, () =>
      span(
        "worker.execution",
        {
          "run.id": job.data.runId,
          "organization.id": job.data.organizationId,
        },
        async () => {
          const { runId, organizationId } = job.data;
          const where = and(
            eq(agentRun.id, runId),
            eq(agentRun.organizationId, organizationId),
            eq(agentRun.sandboxId, job.data.sandboxId),
          );
          let sandboxBusy = false;
          const [run] = await db.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtext(${`agent-sandbox:${organizationId}:${job.data.sandboxId}`}))`,
            );
            const [active] = await tx
              .select({ id: agentRun.id })
              .from(agentRun)
              .where(
                and(
                  eq(agentRun.organizationId, organizationId),
                  eq(agentRun.sandboxId, job.data.sandboxId),
                  eq(agentRun.status, "RUNNING"),
                  sql`${agentRun.id} <> ${runId}`,
                ),
              )
              .limit(1);
            if (active) {
              sandboxBusy = true;
              return [];
            }
            const records = await tx
              .update(agentRun)
              .set({
                status: "RUNNING",
                leaseOwner: owner,
                leaseExpiresAt: new Date(Date.now() + 45000),
                startedAt: new Date(),
                completedAt: null,
                error: null,
                attempt: sql`${agentRun.attempt} + 1`,
              })
              .where(and(where, eq(agentRun.status, "QUEUED")))
              .returning();
            if (records[0])
              await appendRunEventTx(tx, runId, "run.started", {
                attempt: records[0].attempt,
              });
            return records;
          });
          if (sandboxBusy) {
            await job.moveToDelayed(Date.now() + 3000, token);
            throw new DelayedError();
          }
          if (!run) return;
          withCarrier(job.data.trace ?? {}, () =>
            recordQueueWait(new Date(job.timestamp), runId),
          );
          const fence = and(
            where,
            eq(agentRun.leaseOwner, owner),
            eq(agentRun.attempt, run.attempt),
          );
          const controller = new AbortController();
          let heartbeatBusy = false;
          const heartbeat = setInterval(async () => {
            if (heartbeatBusy) return;
            heartbeatBusy = true;
            try {
              const [current] = await db
                .update(agentRun)
                .set({ leaseExpiresAt: new Date(Date.now() + 45000) })
                .where(
                  and(
                    fence,
                    eq(agentRun.status, "RUNNING"),
                    sql`${agentRun.leaseExpiresAt} > now()`,
                  ),
                )
                .returning();
              if (!current) controller.abort(new Error("LEASE_LOST"));
              else if (current.cancelRequestedAt)
                controller.abort(new Error("RUN_CANCELLED"));
            } catch {
              controller.abort(new Error("LEASE_UNAVAILABLE"));
            } finally {
              heartbeatBusy = false;
            }
          }, 3000);
          const emit = async (type: string, payload: unknown) => {
            controller.signal.throwIfAborted();
            const [current] = await db
              .select({ id: agentRun.id })
              .from(agentRun)
              .where(and(fence, eq(agentRun.status, "RUNNING")))
              .limit(1);
            if (!current) throw new Error("LEASE_LOST");
            if (type === "model.response")
              payload = await priceModelUsage(
                organizationId,
                payload as ModelUsage,
              );
            const durable = await appendRunEvent(runId, type, payload);
            if (type === "model.response")
              await recordModelUsage(
                organizationId,
                runId,
                durable.sequence,
                payload as ModelUsage,
              );
            const event = payload as {
              id?: string;
              name?: string;
              input?: unknown;
              result?: unknown;
              error?: unknown;
            };
            if (type === "tool.requested" && event.id && event.name)
              await db
                .insert(toolExecution)
                .values({
                  id: `${runId}:${event.id}`,
                  organizationId,
                  runId,
                  name: event.name,
                  input: event.input ?? {},
                  status: "REQUESTED",
                })
                .onConflictDoNothing();
            if (
              (type === "tool.completed" || type === "tool.failed") &&
              event.id
            )
              await db
                .update(toolExecution)
                .set({
                  status: type === "tool.completed" ? "COMPLETED" : "FAILED",
                  result: event.result ?? event.error,
                  completedAt: new Date(),
                })
                .where(
                  and(
                    eq(toolExecution.id, `${runId}:${event.id}`),
                    eq(toolExecution.organizationId, organizationId),
                  ),
                );
          };
          const cleanup: (() => Promise<void>)[] = [];
          try {
            if (run.cancelRequestedAt) throw new Error("RUN_CANCELLED");
            const [box] = await db
              .select()
              .from(sandbox)
              .where(
                and(
                  eq(sandbox.id, run.sandboxId),
                  eq(sandbox.organizationId, organizationId),
                  eq(sandbox.status, "RUNNING"),
                ),
              )
              .limit(1);
            if (!box?.resourceId) throw new Error("SANDBOX_NOT_FOUND");
            const [policy] = await db
              .select()
              .from(executionPolicy)
              .where(eq(executionPolicy.organizationId, organizationId))
              .limit(1);
            if (!policy) throw new Error("EXECUTION_POLICY_REQUIRED");
            const [saved] = await db
              .select()
              .from(checkpoint)
              .where(eq(checkpoint.runId, runId))
              .orderBy(desc(checkpoint.createdAt))
              .limit(1);
            const state = saved?.state as
              | {
                  messages?: ModelMessage[];
                  usage?: {
                    inputTokens: number;
                    outputTokens: number;
                    toolCallsExecuted: number;
                  };
                }
              | undefined;
            const history =
              !state?.messages && run.sessionId
                ? await db
                    .select()
                    .from(message)
                    .where(eq(message.sessionId, run.sessionId))
                    .orderBy(message.createdAt)
                    .limit(500)
                : [];
            const registry = sandboxTools(
              provider,
              runId,
              (data, filename, mimeType) => {
                if (!run.toolPermissions.includes("artifacts.write"))
                  throw new Error("ARTIFACT_PERMISSION_DENIED");
                return uploadArtifact(organizationId, {
                  data: Buffer.from(data, "base64"),
                  filename,
                  mimeType,
                  sandboxId: run.sandboxId,
                  runId,
                });
              },
              {
                async opened() {
                  await db
                    .insert(browserSession)
                    .values({
                      id: runId,
                      sandboxId: run.sandboxId,
                      organizationId,
                    })
                    .onConflictDoUpdate({
                      target: browserSession.id,
                      set: { status: "OPEN" },
                    });
                },
                async closed() {
                  await db
                    .update(browserSession)
                    .set({ status: "CLOSED" })
                    .where(
                      and(
                        eq(browserSession.id, runId),
                        eq(browserSession.organizationId, organizationId),
                      ),
                    );
                },
              },
            );
            for (const server of await db
              .select()
              .from(mcpServer)
              .where(eq(mcpServer.organizationId, organizationId))) {
              if (!run.toolPermissions.includes("mcp.execute")) continue;
              const config = server.configuration as {
                transport: string;
                url?: string;
                sandboxId?: string;
                command?: string;
                args?: string[];
                authorizationSecret?: string;
                secretNames?: string[];
              };
              const names =
                config.transport === "http"
                  ? config.authorizationSecret
                    ? [config.authorizationSecret]
                    : []
                  : (config.secretNames ?? []);
              if (names.length && !run.toolPermissions.includes("secrets.use"))
                throw new Error("SECRET_PERMISSION_REQUIRED");
              const values = await resolveSecrets(organizationId, names);
              if (config.transport === "http" && config.url) {
                const client = new McpClient(
                  httpMcpTransport(
                    config.url,
                    policy.approvedHosts,
                    config.authorizationSecret
                      ? values[config.authorizationSecret]
                      : undefined,
                  ),
                  Object.values(values),
                );
                cleanup.push(() => client.close());
                await client.register(
                  registry,
                  server.id.slice(0, 8),
                  controller.signal,
                );
              } else if (
                config.transport === "stdio" &&
                config.sandboxId === run.sandboxId &&
                config.command
              ) {
                const sessionId = `${server.id}:${runId}`;
                const transport: McpTransport = async (rpc, signal) => {
                  signal?.throwIfAborted();
                  const abort = () => {
                    void provider
                      .service(box.resourceId!, {
                        op: "mcp",
                        id: sessionId,
                        close: true,
                      })
                      .catch((error: unknown) =>
                        logger.warn(
                          {
                            error:
                              error instanceof Error ? error.name : "UNKNOWN",
                          },
                          "MCP cancellation failed",
                        ),
                      );
                  };
                  signal?.addEventListener("abort", abort, { once: true });
                  try {
                    return await provider.service<
                      Awaited<ReturnType<McpTransport>>
                    >(box.resourceId!, {
                      op: "mcp",
                      id: sessionId,
                      command: config.command,
                      args: config.args,
                      env: values,
                      message: rpc,
                    });
                  } finally {
                    signal?.removeEventListener("abort", abort);
                  }
                };
                transport.close = async () => {
                  await provider.service(box.resourceId!, {
                    op: "mcp",
                    id: sessionId,
                    close: true,
                  });
                };
                const client = new McpClient(transport, Object.values(values));
                cleanup.push(() => client.close());
                await client.register(
                  registry,
                  server.id.slice(0, 8),
                  controller.signal,
                );
              }
            }
            for (const definition of registry.metadata())
              await db
                .insert(toolDefinition)
                .values({ ...definition, organizationId })
                .onConflictDoUpdate({
                  target: [toolDefinition.organizationId, toolDefinition.name],
                  set: definition,
                });
            registry.restrict(
              registry
                .metadata()
                .filter(
                  (tool) =>
                    policy.allowedTools.includes(tool.name) &&
                    run.toolPermissions.includes(tool.permission),
                )
                .map((tool) => tool.name),
            );
            const result = await span(
              "agent.execution",
              {
                "run.id": runId,
                "organization.id": organizationId,
                attempt: run.attempt,
                "agent.location": "sandbox",
              },
              async () =>
                runSandboxAgent({
                  provider,
                  resourceId: box.resourceId!,
                  launch: {
                    tools: registry.metadata(),
                    input: {
                      sandboxId: box.resourceId!,
                      task: run.task,
                      provider: run.provider as ProviderName,
                      model: run.model ?? undefined,
                      messages:
                        state?.messages ??
                        (history.length
                          ? [
                              {
                                role: "system" as const,
                                content:
                                  run.systemInstructions ??
                                  "Work only in /workspace. Use tools within the execution policy.",
                              },
                              ...history.map((entry) => ({
                                role: entry.role as "user" | "assistant",
                                content:
                                  typeof entry.content === "string"
                                    ? entry.content
                                    : JSON.stringify(entry.content),
                              })),
                            ]
                          : undefined),
                      systemInstructions: run.systemInstructions ?? undefined,
                      previousUsage: state?.usage,
                      maxTokens: policy.maxTokens,
                      maxToolCalls: policy.maxToolCalls,
                      deadlineMs: policy.deadlineMs,
                    },
                  },
                  registry,
                  model: await router(organizationId, run.provider),
                  signal: controller.signal,
                  async assertActive() {
                    controller.signal.throwIfAborted();
                    const [current] = await db
                      .select({ cancelRequestedAt: agentRun.cancelRequestedAt })
                      .from(agentRun)
                      .where(and(fence, eq(agentRun.status, "RUNNING")))
                      .limit(1);
                    if (!current) throw new Error("LEASE_LOST");
                    if (current.cancelRequestedAt)
                      throw new Error("RUN_CANCELLED");
                  },
                  emit,
                  async checkpoint(messages, usage) {
                    controller.signal.throwIfAborted();
                    await db.transaction(async (tx) => {
                      const [current] = await tx
                        .select({
                          cancelRequestedAt: agentRun.cancelRequestedAt,
                        })
                        .from(agentRun)
                        .where(
                          and(
                            fence,
                            eq(agentRun.status, "RUNNING"),
                            sql`${agentRun.leaseExpiresAt} > now()`,
                          ),
                        )
                        .for("update")
                        .limit(1);
                      if (!current) throw new Error("LEASE_LOST");
                      if (current.cancelRequestedAt)
                        throw new Error("RUN_CANCELLED");
                      await tx.insert(checkpoint).values({
                        runId,
                        state: { messages, usage },
                        sequence: messages?.length ?? 0,
                      });
                    });
                  },
                  async authorize(tool, args) {
                    if (!run.toolPermissions.includes(tool.permission))
                      throw new Error("TOOL_PERMISSION_DENIED");
                    const decision = await evaluateAction(
                      organizationId,
                      tool.name,
                      args,
                      run.sandboxId,
                      runId,
                    );
                    if (!decision.allowed) throw new Error(decision.reason);
                  },
                }),
            );
            await db.transaction(async (tx) => {
              const [updated] = await tx
                .update(agentRun)
                .set({
                  status: result.status,
                  result,
                  completedAt: new Date(),
                  leaseOwner: null,
                  leaseExpiresAt: null,
                })
                .where(and(fence, eq(agentRun.status, "RUNNING")))
                .returning();
              if (!updated) throw new Error("LEASE_LOST");
              await appendRunEventTx(
                tx,
                runId,
                result.status === "COMPLETED"
                  ? "run.completed"
                  : "run.limit_reached",
                result,
              );
              for (const [metric, quantity, unit] of [
                ["tokens", result.inputTokens + result.outputTokens, "tokens"],
                ["tool_calls", result.toolCallsExecuted, "calls"],
                ["runs", 1, "runs"],
              ] as const)
                await tx
                  .insert(usageEvent)
                  .values({
                    organizationId,
                    metric,
                    quantity: String(quantity),
                    unit,
                    idempotencyKey: `${runId}-${metric}`,
                    metadata: {
                      provider: run.provider,
                      model: run.model,
                      inputTokens: result.inputTokens,
                      outputTokens: result.outputTokens,
                    },
                  })
                  .onConflictDoUpdate({
                    target: usageEvent.idempotencyKey,
                    set: {
                      quantity: String(quantity),
                      metadata: {
                        reserved: false,
                        provider: run.provider,
                        model: run.model,
                        inputTokens: result.inputTokens,
                        outputTokens: result.outputTokens,
                      },
                    },
                  });
              if (run.sessionId)
                await tx.insert(message).values({
                  sessionId: run.sessionId,
                  role: "assistant",
                  content: result.finalAnswer,
                });
            });
            await settleRunUsage(organizationId, runId);
            return result;
          } catch (error) {
            const reason =
              error instanceof Error && error.name === "TimeoutError"
                ? "AGENT_DEADLINE_EXCEEDED"
                : error instanceof Error
                  ? error.message
                  : "RUN_FAILED";
            const status =
              reason === "APPROVAL_REQUIRED"
                ? "AWAITING_APPROVAL"
                : reason === "RUN_CANCELLED"
                  ? "CANCELLED"
                  : controller.signal.aborted ||
                      [
                        "LEASE_LOST",
                        "LEASE_UNAVAILABLE",
                        "AGENT_CHANNEL_CLOSED",
                        "AGENT_INTERRUPTED",
                        "AGENT_TRANSPORT_FAILED",
                        "AGENT_DEADLINE_EXCEEDED",
                      ].includes(reason)
                    ? "INTERRUPTED"
                    : "FAILED";
            const safeError = /^[A-Z_0-9]+$/.test(reason)
              ? reason
              : "EXECUTION_FAILED";
            const updated = await db.transaction(async (tx) => {
              const [record] = await tx
                .update(agentRun)
                .set({
                  status,
                  error: safeError,
                  completedAt:
                    status === "AWAITING_APPROVAL" ? null : new Date(),
                  leaseOwner: null,
                  leaseExpiresAt: null,
                })
                .where(and(fence, eq(agentRun.status, "RUNNING")))
                .returning();
              if (record)
                await appendRunEventTx(
                  tx,
                  runId,
                  `run.${status.toLowerCase()}`,
                  { error: safeError },
                );
              return record;
            });
            if (updated && status !== "AWAITING_APPROVAL")
              await settleRunUsage(organizationId, runId);
          } finally {
            clearInterval(heartbeat);
            for (const close of cleanup) {
              try {
                await close();
              } catch (error) {
                logger.warn(
                  { error: error instanceof Error ? error.name : "UNKNOWN" },
                  "MCP cleanup failed",
                );
              }
            }
          }
        },
      ),
    ),
  { connection, concurrency: env.WORKER_CONCURRENCY },
);

const shellWorker = new Worker<{ executionId: string; organizationId: string }>(
  "shell-executions",
  async (job) => {
    const { executionId, organizationId } = job.data;
    const where = and(
      eq(execution.id, executionId),
      eq(execution.organizationId, organizationId),
    );
    const [record] = await db
      .update(execution)
      .set({
        status: "RUNNING",
        leaseOwner: owner,
        leaseExpiresAt: new Date(Date.now() + 45000),
      })
      .where(and(where, eq(execution.status, "QUEUED")))
      .returning();
    if (!record) return;
    if (record.cancelRequestedAt) {
      await db
        .update(execution)
        .set({ status: "CANCELLED", completedAt: new Date() })
        .where(and(where, eq(execution.leaseOwner, owner)));
      return;
    }
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const [current] = await db
          .update(execution)
          .set({ leaseExpiresAt: new Date(Date.now() + 45000) })
          .where(
            and(
              where,
              eq(execution.leaseOwner, owner),
              eq(execution.status, "RUNNING"),
            ),
          )
          .returning();
        if (!current || current.cancelRequestedAt) controller.abort();
      } catch {
        controller.abort();
      }
    }, 1000);
    try {
      const [box] = await db
        .select()
        .from(sandbox)
        .where(
          and(
            eq(sandbox.id, record.sandboxId),
            eq(sandbox.organizationId, organizationId),
            eq(sandbox.status, "RUNNING"),
          ),
        )
        .limit(1);
      if (!box?.resourceId) throw new Error("SANDBOX_NOT_READY");
      const options = record.options as {
        cwd?: string;
        timeoutMs?: number;
        maxOutputBytes?: number;
        secretNames?: string[];
      };
      const secrets = options.secretNames?.length
        ? await db
            .select()
            .from(secret)
            .where(
              and(
                eq(secret.organizationId, organizationId),
                inArray(secret.name, options.secretNames),
              ),
            )
        : [];
      if (secrets.length !== (options.secretNames?.length ?? 0))
        throw new Error("SECRET_NOT_FOUND");
      const environment = Object.fromEntries(
        secrets.map((entry) => [
          entry.name,
          decrypt(entry.ciphertext, organizationId),
        ]),
      );
      const result = await provider.execute(box.resourceId, record.command, {
        ...options,
        env: environment,
        id: executionId,
        signal: controller.signal,
      });
      for (const value of Object.values(environment)) {
        result.stdout = result.stdout.replaceAll(value, "[REDACTED]");
        result.stderr = result.stderr.replaceAll(value, "[REDACTED]");
      }
      await db
        .update(execution)
        .set({
          status: result.timedOut ? "TIMED_OUT" : "COMPLETED",
          result,
          completedAt: new Date(),
        })
        .where(
          and(
            where,
            eq(execution.status, "RUNNING"),
            eq(execution.leaseOwner, owner),
          ),
        );
    } catch {
      await db
        .update(execution)
        .set({
          status: controller.signal.aborted ? "INTERRUPTED" : "FAILED",
          completedAt: new Date(),
        })
        .where(
          and(
            where,
            eq(execution.status, "RUNNING"),
            eq(execution.leaseOwner, owner),
          ),
        );
    } finally {
      clearInterval(timer);
    }
  },
  { connection, concurrency: env.WORKER_CONCURRENCY },
);

let recoveryBusy = false;
const recovery = setInterval(async () => {
  if (recoveryBusy) return;
  recoveryBusy = true;
  try {
    await publisherConnection.set(
      `zlayer:worker:${owner}`,
      JSON.stringify({
        owner,
        concurrency: env.WORKER_CONCURRENCY,
        heartbeatAt: new Date().toISOString(),
      }),
      "PX",
      30000,
    );
    await publisherConnection.zadd(
      `zlayer:${env.INSTANCE_ID}:workers`,
      Date.now(),
      owner,
    );
    await publisherConnection.zremrangebyscore(
      `zlayer:${env.INSTANCE_ID}:workers`,
      "-inf",
      Date.now() - 30000,
    );
    const staleExecutions = await db
      .update(execution)
      .set({ status: "INTERRUPTED", completedAt: new Date() })
      .where(
        and(
          eq(execution.status, "RUNNING"),
          sql`${execution.leaseExpiresAt} < now()`,
        ),
      )
      .returning();
    for (const record of staleExecutions) {
      const [box] = await db
        .select()
        .from(sandbox)
        .where(eq(sandbox.id, record.sandboxId))
        .limit(1);
      if (box?.resourceId) {
        await provider.lifecycle(box.resourceId, "stop");
        await db
          .update(sandbox)
          .set({ status: "STOPPED" })
          .where(eq(sandbox.id, box.id));
      }
    }
    const recoverRuns = async (cancelled: boolean) =>
      db.transaction(async (tx) => {
        const records = await tx
          .update(agentRun)
          .set({
            status: cancelled ? "CANCELLED" : "INTERRUPTED",
            completedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          })
          .where(
            cancelled
              ? and(
                  sql`${agentRun.status} in ('QUEUED','AWAITING_APPROVAL')`,
                  sql`${agentRun.cancelRequestedAt} is not null`,
                )
              : and(
                  eq(agentRun.status, "RUNNING"),
                  sql`${agentRun.leaseExpiresAt} < now()`,
                ),
          )
          .returning();
        for (const run of records)
          await appendRunEventTx(
            tx,
            run.id,
            cancelled ? "run.cancelled" : "run.interrupted",
            cancelled
              ? {}
              : { reason: "LEASE_EXPIRED", requiresExplicitResume: true },
          );
        return records;
      });
    await recoverRuns(false);
    for (const run of await recoverRuns(true))
      await settleRunUsage(run.organizationId, run.id);
    const queuedRuns = await db
      .select()
      .from(agentRun)
      .where(
        and(
          eq(agentRun.status, "QUEUED"),
          sql`${agentRun.updatedAt} < now() - interval '60 seconds'`,
        ),
      )
      .limit(50);
    const queuedShell = await db
      .select()
      .from(execution)
      .where(
        and(
          eq(execution.status, "QUEUED"),
          sql`${execution.createdAt} < now() - interval '60 seconds'`,
        ),
      )
      .limit(50);
    const pending = [
      ...queuedRuns.map((run) => ({
        id: run.id,
        organizationId: run.organizationId,
        topic: "agent-runs",
        payload: {
          runId: run.id,
          sandboxId: run.sandboxId,
          task: run.task,
          organizationId: run.organizationId,
        },
      })),
      ...queuedShell.map((run) => ({
        id: run.id,
        organizationId: run.organizationId,
        topic: "shell-executions",
        payload: {
          executionId: run.id,
          sandboxId: run.sandboxId,
          organizationId: run.organizationId,
        },
      })),
    ];
    for (const item of pending) {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"dispatch:" + item.id}))`,
        );
        const [last] = await tx
          .select()
          .from(outbox)
          .where(
            and(
              eq(outbox.topic, item.topic),
              sql`coalesce(${outbox.payload}->>'runId', ${outbox.payload}->>'executionId') = ${item.id}`,
            ),
          )
          .orderBy(desc(outbox.createdAt))
          .limit(1);
        if (last && !last.publishedAt) return;
        const queued = await queues
          .get(item.topic)!
          .getJob(last?.id ?? item.id);
        if (
          queued &&
          ["waiting", "active", "delayed", "prioritized"].includes(
            await queued.getState(),
          )
        )
          return;
        await tx.insert(outbox).values({
          organizationId: item.organizationId,
          topic: item.topic,
          payload: item.payload,
        });
      });
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.name : "UNKNOWN" },
      "Recovery failed",
    );
  } finally {
    recoveryBusy = false;
  }
}, 15000);
let maintenanceBusy = false;
const maintenance = setInterval(async () => {
  if (maintenanceBusy) return;
  maintenanceBusy = true;
  try {
    const cleanup = await Promise.allSettled([
      reconcileUploads(),
      (async () => {
        const resources = await db
          .select({ id: sandbox.resourceId })
          .from(sandbox)
          .where(sql`${sandbox.resourceId} is not null`);
        await provider.reconcileResources(resources.map((entry) => entry.id!));
        await db
          .update(sandbox)
          .set({ status: "FAILED" })
          .where(
            and(
              eq(sandbox.status, "CREATING"),
              sql`${sandbox.createdAt} < now() - interval '2 minutes'`,
            ),
          );
      })(),
    ]);
    for (const result of cleanup)
      if (result.status === "rejected")
        logger.warn(
          {
            error:
              result.reason instanceof Error ? result.reason.name : "UNKNOWN",
          },
          "Resource cleanup failed",
        );
    const boxes = await db
      .select()
      .from(sandbox)
      .where(sql`${sandbox.status} in ('RUNNING','STOPPED','PAUSED')`)
      .orderBy(sandbox.updatedAt)
      .limit(50);
    for (const box of boxes) {
      if (!box.resourceId) continue;
      try {
        if (box.expiresAt && box.expiresAt <= new Date()) {
          await provider.destroy(box.resourceId);
          await db
            .update(sandbox)
            .set({ status: "DESTROYED", resourceId: null })
            .where(eq(sandbox.id, box.id));
          continue;
        }
        const state = (await provider.inspect(box.resourceId)) as {
          running: boolean;
          paused: boolean;
        };
        await db
          .update(sandbox)
          .set({
            status: state.paused
              ? "PAUSED"
              : state.running
                ? "RUNNING"
                : "STOPPED",
          })
          .where(eq(sandbox.id, box.id));
        if (state.running && !state.paused) {
          const bucket = Math.floor(Date.now() / 15000);
          const stats = await provider.stats(box.resourceId);
          await db
            .insert(usageEvent)
            .values({
              organizationId: box.organizationId,
              metric: "sandbox_duration",
              quantity: String(
                Math.max(
                  0,
                  Math.min(60000, Date.now() - box.updatedAt.getTime()),
                ),
              ),
              unit: "milliseconds",
              idempotencyKey: `${box.id}-duration-${bucket}`,
              metadata: { sampled: true, stats },
            })
            .onConflictDoNothing();
        }
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          error.statusCode === 404
        )
          await db
            .update(sandbox)
            .set({ status: "FAILED", resourceId: null })
            .where(eq(sandbox.id, box.id));
        else
          logger.warn(
            {
              sandboxId: box.id,
              error: error instanceof Error ? error.name : "UNKNOWN",
            },
            "Sandbox reconciliation failed",
          );
      }
    }
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.name : "UNKNOWN" },
      "Maintenance failed",
    );
  } finally {
    maintenanceBusy = false;
  }
}, 60000);
for (const current of [worker, shellWorker])
  current.on("error", (error) =>
    logger.error({ error: error.name }, "Worker error"),
  );
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(publisher);
  clearInterval(recovery);
  clearInterval(maintenance);
  await Promise.all([worker.close(), shellWorker.close()]);
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  await connection.quit();
  await publisherConnection.zrem(`zlayer:${env.INSTANCE_ID}:workers`, owner);
  await publisherConnection.quit();
  await pool.end();
  await stopTelemetry();
}
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
