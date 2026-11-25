import {
  agentEvent,
  agentRun,
  agentSession,
  message,
  outbox,
  and,
  asc,
  db,
  eq,
  executionPolicy,
  reserveUsage,
  sql,
} from "@repo/db";
import type { Queue } from "bullmq";
import type { RunJob } from "@repo/shared";
import { HttpError } from "../../lib/errors";
import type { SandboxService } from "../sandboxes/sandbox.service";
import { traceCarrier } from "@repo/observability";

export function createRunService(
  _queue: Queue<RunJob>,
  sandboxes: SandboxService,
) {
  return {
    async create(
      organizationId: string,
      input: {
        sandboxId: string;
        task: string;
        sessionId?: string;
        provider?: "openai" | "anthropic" | "deepseek" | "openrouter";
        model?: string;
        systemInstructions?: string;
        toolPermissions?: string[];
        idempotencyKey?: string;
      },
    ) {
      await sandboxes.find(organizationId, input.sandboxId, true);
      if (input.sessionId) {
        const [session] = await db
          .select()
          .from(agentSession)
          .where(
            and(
              eq(agentSession.id, input.sessionId),
              eq(agentSession.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!session) throw new HttpError(404, "SESSION_NOT_FOUND");
      }
      return db.transaction(async (tx) => {
        if (input.idempotencyKey) {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId + input.idempotencyKey}))`,
          );
          const [existing] = await tx
            .select()
            .from(agentRun)
            .where(
              and(
                eq(agentRun.organizationId, organizationId),
                eq(agentRun.idempotencyKey, input.idempotencyKey),
              ),
            )
            .limit(1);
          if (existing) {
            if (
              existing.sandboxId !== input.sandboxId ||
              existing.task !== input.task ||
              existing.provider !== (input.provider ?? "openai") ||
              existing.model !== (input.model ?? null) ||
              existing.sessionId !== (input.sessionId ?? null) ||
              existing.systemInstructions !==
                (input.systemInstructions ?? null) ||
              JSON.stringify([...existing.toolPermissions].sort()) !==
                JSON.stringify([...(input.toolPermissions ?? [])].sort())
            )
              throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED");
            return existing;
          }
        }
        if (input.sessionId) {
          await tx.execute(
            sql`SELECT id FROM agent_session WHERE id = ${input.sessionId} FOR UPDATE`,
          );
          const [active] = await tx
            .select({ id: agentRun.id })
            .from(agentRun)
            .where(
              and(
                eq(agentRun.sessionId, input.sessionId),
                eq(agentRun.organizationId, organizationId),
                sql`${agentRun.status} in ('QUEUED','RUNNING','AWAITING_APPROVAL')`,
              ),
            )
            .limit(1);
          if (active) throw new HttpError(409, "SESSION_HAS_ACTIVE_RUN");
        }
        const [run] = await tx
          .insert(agentRun)
          .values({ ...input, organizationId })
          .returning();
        const [policy] = await tx
          .select()
          .from(executionPolicy)
          .where(eq(executionPolicy.organizationId, organizationId))
          .limit(1);
        await reserveUsage(
          tx,
          organizationId,
          "runs",
          1,
          "runs",
          `${run!.id}-runs`,
        );
        await reserveUsage(
          tx,
          organizationId,
          "tokens",
          policy?.maxTokens ?? 32000,
          "tokens",
          `${run!.id}-tokens`,
        );
        await reserveUsage(
          tx,
          organizationId,
          "tool_calls",
          policy?.maxToolCalls ?? 32,
          "calls",
          `${run!.id}-tool_calls`,
        );
        await tx.insert(agentEvent).values({
          runId: run!.id,
          type: "run.created",
          payload: {},
          sequence: 1,
        });
        await tx.insert(outbox).values({
          organizationId,
          topic: "agent-runs",
          payload: {
            sandboxId: input.sandboxId,
            task: input.task,
            runId: run!.id,
            organizationId,
            trace: traceCarrier(),
          },
        });
        if (input.sessionId)
          await tx.insert(message).values({
            sessionId: input.sessionId,
            role: "user",
            content: input.task,
          });
        return run!;
      });
    },
    async get(organizationId: string, id: string) {
      const [run] = await db
        .select()
        .from(agentRun)
        .where(
          and(eq(agentRun.id, id), eq(agentRun.organizationId, organizationId)),
        )
        .limit(1);
      if (!run) throw new HttpError(404, "RUN_NOT_FOUND");
      const events = await db
        .select()
        .from(agentEvent)
        .where(eq(agentEvent.runId, run.id))
        .orderBy(asc(agentEvent.createdAt));
      return { ...run, events };
    },
  };
}

export type RunService = ReturnType<typeof createRunService>;
