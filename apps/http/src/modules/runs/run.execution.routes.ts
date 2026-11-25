import { readPage, cursorFilter, sendPage } from "../../lib/pagination";
import { sql, desc } from "@repo/db";
import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and,
  db,
  eq,
  gt,
  outbox,
  agentRun,
  agentEvent,
  appendRunEventTx,
  checkpoint,
  executionPolicy,
  reserveUsage,
} from "@repo/db";
import type { SandboxProvider } from "@repo/sandbox";
import { authorize } from "../platform/authorization";
import { uploadArtifact } from "@repo/storage";
import { HttpError } from "../../lib/errors";
import { traceCarrier } from "@repo/observability";
const params = z.object({ id: z.string().uuid() });
export async function registerRunExecutionRoutes(
  app: FastifyInstance,
  provider: SandboxProvider,
) {
  app.get("/runs", async (request, reply) => {
    authorize(request, "runs.read");
    const page = readPage(request.query, [
      "QUEUED",
      "RUNNING",
      "AWAITING_APPROVAL",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "INTERRUPTED",
      "LIMIT_REACHED",
    ]);
    const rows = await db
      .select()
      .from(agentRun)
      .where(
        and(
          eq(agentRun.organizationId, request.user.organizationId),
          cursorFilter(agentRun.createdAt, agentRun.id, page),
          page.status ? sql`${agentRun.status} = ${page.status}` : undefined,
        ),
      )
      .orderBy(desc(agentRun.createdAt), desc(agentRun.id))
      .limit(page.limit);
    return sendPage(reply, rows, page.limit);
  });
  app.post("/runs/:id/cancel", async (request) => {
    authorize(request, "runs.write");
    const { id } = params.parse(request.params);
    const [run] = await db
      .update(agentRun)
      .set({ cancelRequestedAt: new Date() })
      .where(
        and(
          eq(agentRun.id, id),
          eq(agentRun.organizationId, request.user.organizationId),
          sql`${agentRun.status} in ('RUNNING','QUEUED','AWAITING_APPROVAL')`,
        ),
      )
      .returning();
    if (!run) throw new HttpError(409, "RUN_NOT_ACTIVE");
    return { cancellationRequested: true };
  });
  app.get("/runs/:id/events", async (request, reply) => {
    authorize(request, "runs.read");
    const { id } = params.parse(request.params);
    const [run] = await db
      .select()
      .from(agentRun)
      .where(
        and(
          eq(agentRun.id, id),
          eq(agentRun.organizationId, request.user.organizationId),
        ),
      )
      .limit(1);
    if (!run) throw new HttpError(404, "RUN_NOT_FOUND");
    const cursor = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(request.headers["last-event-id"] ?? 0);
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders()))
      if (value !== undefined)
        reply.raw.setHeader(
          name,
          Array.isArray(value) ? value.map(String) : String(value),
        );
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let after = cursor,
      closed = false,
      busy = false;
    const poll = async () => {
      if (busy || closed) return;
      busy = true;
      try {
        const events = await db
          .select()
          .from(agentEvent)
          .where(and(eq(agentEvent.runId, id), gt(agentEvent.sequence, after)))
          .orderBy(agentEvent.sequence)
          .limit(100);
        for (const event of events) {
          after = event.sequence;
          if (
            !reply.raw.write(
              `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            )
          )
            break;
        }
        if (!events.length) reply.raw.write(": keepalive\n\n");
      } catch {
        reply.raw.end();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, 1000);
    const end = setTimeout(() => reply.raw.end(), 300000);
    reply.raw.once("close", () => {
      closed = true;
      clearInterval(timer);
      clearTimeout(end);
    });
    await poll();
  });
  app.post(
    "/runs/:id/resume",
    {
      schema: {
        body: bodySchema(
          z.object({ acceptUncertainSideEffects: z.literal(true) }),
        ),
      },
    },
    async (request, reply) => {
      authorize(request, "runs.write");
      const { id } = params.parse(request.params);
      const { acceptUncertainSideEffects } = z
        .object({ acceptUncertainSideEffects: z.literal(true) })
        .parse(request.body);
      authorize(request, "models.use");
      const result = await db.transaction(async (tx) => {
        const [previous] = await tx
          .select()
          .from(agentRun)
          .where(
            and(
              eq(agentRun.id, id),
              eq(agentRun.organizationId, request.user.organizationId),
            ),
          )
          .limit(1);
        if (previous?.sessionId) {
          await tx.execute(
            sql`SELECT id FROM agent_session WHERE id = ${previous.sessionId} FOR UPDATE`,
          );
          const [active] = await tx
            .select({ id: agentRun.id })
            .from(agentRun)
            .where(
              and(
                eq(agentRun.sessionId, previous.sessionId),
                sql`${agentRun.id} != ${id}`,
                sql`${agentRun.status} in ('QUEUED','RUNNING','AWAITING_APPROVAL')`,
              ),
            )
            .limit(1);
          if (active) throw new HttpError(409, "SESSION_HAS_ACTIVE_RUN");
        }
        const [record] = await tx
          .update(agentRun)
          .set({
            status: "QUEUED",
            cancelRequestedAt: null,
            leaseOwner: null,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(agentRun.id, id),
              eq(agentRun.organizationId, request.user.organizationId),
              sql`${agentRun.status} in ('INTERRUPTED','AWAITING_APPROVAL','FAILED')`,
            ),
          )
          .returning();
        if (!record) throw new HttpError(409, "RUN_NOT_RESUMABLE");
        const [policy] = await tx
          .select()
          .from(executionPolicy)
          .where(
            eq(executionPolicy.organizationId, request.user.organizationId),
          )
          .limit(1);
        await reserveUsage(
          tx,
          request.user.organizationId,
          "tokens",
          policy?.maxTokens ?? 32000,
          "tokens",
          `${id}-tokens`,
        );
        await reserveUsage(
          tx,
          request.user.organizationId,
          "tool_calls",
          policy?.maxToolCalls ?? 32,
          "calls",
          `${id}-tool_calls`,
        );
        await tx.insert(outbox).values({
          organizationId: request.user.organizationId,
          topic: "agent-runs",
          payload: {
            runId: id,
            sandboxId: record.sandboxId,
            task: record.task,
            organizationId: record.organizationId,
            trace: traceCarrier(),
          },
        });
        await appendRunEventTx(tx, id, "run.resumed", {
          acceptUncertainSideEffects,
        });
        return record;
      });
      return reply.code(202).send(result);
    },
  );
  app.get("/runs/:id/checkpoints", async (request) => {
    authorize(request, "runs.read");
    const { id } = params.parse(request.params);
    const [run] = await db
      .select()
      .from(agentRun)
      .where(
        and(
          eq(agentRun.id, id),
          eq(agentRun.organizationId, request.user.organizationId),
        ),
      )
      .limit(1);
    if (!run) throw new HttpError(404, "RUN_NOT_FOUND");
    return db
      .select({
        id: checkpoint.id,
        sequence: checkpoint.sequence,
        createdAt: checkpoint.createdAt,
      })
      .from(checkpoint)
      .where(eq(checkpoint.runId, id))
      .orderBy(desc(checkpoint.createdAt))
      .limit(100);
  });
  app.post("/runs/:id/checkpoints/export", async (request) => {
    authorize(request, "runs.read");
    authorize(request, "artifacts.write");
    const { id } = params.parse(request.params);
    const [run] = await db
      .select()
      .from(agentRun)
      .where(
        and(
          eq(agentRun.id, id),
          eq(agentRun.organizationId, request.user.organizationId),
        ),
      )
      .limit(1);
    if (!run) throw new HttpError(404, "RUN_NOT_FOUND");
    const [saved] = await db
      .select()
      .from(checkpoint)
      .where(eq(checkpoint.runId, id))
      .orderBy(desc(checkpoint.createdAt))
      .limit(1);
    if (!saved) throw new HttpError(404, "CHECKPOINT_NOT_FOUND");
    return uploadArtifact(request.user.organizationId, {
      filename: `${id}-checkpoint.json`,
      mimeType: "application/json",
      data: Buffer.from(JSON.stringify(saved.state)),
      runId: id,
      sandboxId: run.sandboxId,
    });
  });
  app.get("/runs/:id/replay", async (request) => {
    authorize(request, "runs.read");
    const { id } = params.parse(request.params);
    const [run] = await db
      .select()
      .from(agentRun)
      .where(
        and(
          eq(agentRun.id, id),
          eq(agentRun.organizationId, request.user.organizationId),
        ),
      )
      .limit(1);
    if (!run) throw new HttpError(404, "RUN_NOT_FOUND");
    const events = await db
      .select()
      .from(agentEvent)
      .where(eq(agentEvent.runId, id))
      .orderBy(agentEvent.sequence);
    const states: Record<string, string> = {
      "run.created": "QUEUED",
      "run.queued": "QUEUED",
      "run.resumed": "QUEUED",
      "run.started": "RUNNING",
      "run.completed": "COMPLETED",
      "run.failed": "FAILED",
      "run.cancelled": "CANCELLED",
      "run.interrupted": "INTERRUPTED",
      "run.awaiting_approval": "AWAITING_APPROVAL",
      "run.limit_reached": "LIMIT_REACHED",
    };
    const reconstructed = events.reduce(
      (state, event) => states[event.type] ?? state,
      "QUEUED",
    );
    return {
      runId: id,
      reconstructedStatus: reconstructed,
      persistedStatus: run.status,
      events,
      executedSideEffects: false,
    };
  });
}
