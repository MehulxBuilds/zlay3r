import { readPage, cursorFilter, sendPage } from "../../lib/pagination";
import { sql, desc } from "@repo/db";
import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and,
  db,
  eq,
  sandbox,
  execution,
  outbox,
  evaluateAction,
} from "@repo/db";
import type { SandboxProvider } from "@repo/sandbox";
import { authorize } from "../platform/authorization";
import { HttpError } from "../../lib/errors";
const params = z.object({ id: z.string().uuid() });
export async function registerExecutionsRoutes(
  app: FastifyInstance,
  provider: SandboxProvider,
) {
  async function find(org: string, id: string) {
    const [record] = await db
      .select()
      .from(sandbox)
      .where(and(eq(sandbox.id, id), eq(sandbox.organizationId, org)))
      .limit(1);
    if (!record?.resourceId) throw new HttpError(404, "SANDBOX_NOT_FOUND");
    return record;
  }
  app.post(
    "/executions",
    {
      schema: {
        body: bodySchema(
          z.object({
            sandboxId: z.string().uuid(),
            command: z.string().trim().min(1).max(4000),
            options: z
              .object({
                cwd: z.string().max(4096).default("."),
                timeoutMs: z.number().int().min(100).max(300000).default(30000),
                maxOutputBytes: z
                  .number()
                  .int()
                  .min(1024)
                  .max(4194304)
                  .default(1048576),
                secretNames: z
                  .array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/))
                  .max(20)
                  .default([]),
              })
              .default({
                cwd: ".",
                timeoutMs: 30000,
                maxOutputBytes: 1048576,
                secretNames: [],
              }),
          }),
        ),
      },
    },
    async (request, reply) => {
      authorize(request, "sandbox.execute");
      const input = z
        .object({
          sandboxId: z.string().uuid(),
          command: z.string().trim().min(1).max(4000),
          options: z
            .object({
              cwd: z.string().max(4096).default("."),
              timeoutMs: z.number().int().min(100).max(300000).default(30000),
              maxOutputBytes: z
                .number()
                .int()
                .min(1024)
                .max(4194304)
                .default(1048576),
              secretNames: z
                .array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/))
                .max(20)
                .default([]),
            })
            .default({
              cwd: ".",
              timeoutMs: 30000,
              maxOutputBytes: 1048576,
              secretNames: [],
            }),
        })
        .parse(request.body);
      await find(request.user.organizationId, input.sandboxId);
      if (input.options.secretNames.length) authorize(request, "secrets.use");
      const idempotencyKey = z
        .string()
        .min(1)
        .max(128)
        .optional()
        .parse(request.headers["idempotency-key"]);
      const result = await db.transaction(async (tx) => {
        if (idempotencyKey) {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${request.user.organizationId + idempotencyKey}))`,
          );
          const [existing] = await tx
            .select()
            .from(execution)
            .where(
              and(
                eq(execution.organizationId, request.user.organizationId),
                eq(execution.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1);
          if (existing) {
            if (
              existing.command !== input.command ||
              existing.sandboxId !== input.sandboxId ||
              JSON.stringify(existing.options) !== JSON.stringify(input.options)
            )
              throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED");
            return existing;
          }
        }
        const decision = await evaluateAction(
          request.user.organizationId,
          "execute_command",
          { command: input.command, options: input.options },
          input.sandboxId,
        );
        if (!decision.allowed)
          throw new HttpError(409, decision.reason!, {
            approvalId: decision.approvalId,
          });
        const [record] = await tx
          .insert(execution)
          .values({
            ...input,
            idempotencyKey,
            organizationId: request.user.organizationId,
          })
          .returning();
        await tx.insert(outbox).values({
          organizationId: request.user.organizationId,
          topic: "shell-executions",
          payload: {
            executionId: record!.id,
            sandboxId: input.sandboxId,
            organizationId: request.user.organizationId,
          },
        });
        return record;
      });
      return reply.code(202).send(result);
    },
  );
  app.get("/executions", async (request, reply) => {
    authorize(request, "execution.read");
    const page = readPage(request.query, [
      "QUEUED",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "TIMED_OUT",
      "INTERRUPTED",
    ]);
    const rows = await db
      .select()
      .from(execution)
      .where(
        and(
          eq(execution.organizationId, request.user.organizationId),
          cursorFilter(execution.createdAt, execution.id, page),
          page.status ? sql`${execution.status} = ${page.status}` : undefined,
        ),
      )
      .orderBy(desc(execution.createdAt), desc(execution.id))
      .limit(page.limit);
    return sendPage(reply, rows, page.limit);
  });
  app.get("/executions/:id", async (request) => {
    authorize(request, "execution.read");
    const { id } = params.parse(request.params);
    const [record] = await db
      .select()
      .from(execution)
      .where(
        and(
          eq(execution.id, id),
          eq(execution.organizationId, request.user.organizationId),
        ),
      )
      .limit(1);
    if (!record) throw new HttpError(404, "EXECUTION_NOT_FOUND");
    return record;
  });
  app.post("/executions/:id/cancel", async (request) => {
    authorize(request, "sandbox.execute");
    const { id } = params.parse(request.params);
    const [record] = await db
      .update(execution)
      .set({ cancelRequestedAt: new Date() })
      .where(
        and(
          eq(execution.id, id),
          eq(execution.organizationId, request.user.organizationId),
          sql`${execution.status} in ('RUNNING','QUEUED')`,
        ),
      )
      .returning();
    if (!record) throw new HttpError(409, "EXECUTION_NOT_ACTIVE");
    if (record.status === "QUEUED") {
      await db
        .update(execution)
        .set({ status: "CANCELLED", completedAt: new Date() })
        .where(and(eq(execution.id, id), eq(execution.status, "QUEUED")));
    } else {
      const box = await find(request.user.organizationId, record.sandboxId);
      try {
        await provider.lifecycle(box.resourceId!, "stop");
        await db
          .update(execution)
          .set({ status: "CANCELLED", completedAt: new Date() })
          .where(
            and(
              eq(execution.id, id),
              eq(execution.organizationId, request.user.organizationId),
            ),
          );
      } catch (error) {
        request.log.warn(
          {
            executionId: id,
            error: error instanceof Error ? error.name : "UNKNOWN",
          },
          "Direct cancellation unavailable; worker will observe cancellation",
        );
      }
    }
    return { cancellationRequested: true };
  });
}
