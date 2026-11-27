import {
  and,
  db,
  desc,
  eq,
  sandbox,
  executionPolicy,
  evaluateAction,
  sql,
  agentRun,
  browserSession,
  execution,
  appendPlatformEventTx,
} from "@repo/db";
import type { CreateSandboxInput } from "./sandbox.validation";
import type { SandboxProvider } from "@repo/sandbox";
import { HttpError } from "../../lib/errors";
import { server_env as env } from "@repo/env";
import { cursorFilter, type PageOptions } from "../../lib/pagination";

export function createSandboxService(provider: SandboxProvider) {
  async function find(organizationId: string, id: string, running = false) {
    const [record] = await db
      .select()
      .from(sandbox)
      .where(
        and(
          eq(sandbox.id, id),
          eq(sandbox.organizationId, organizationId),
          running ? eq(sandbox.status, "RUNNING") : undefined,
        ),
      )
      .limit(1);
    if (!record) throw new HttpError(404, "SANDBOX_NOT_FOUND");
    return record;
  }
  return {
    find,
    async list(organizationId: string, options: PageOptions = { limit: 30 }) {
      return db
        .select()
        .from(sandbox)
        .where(
          and(
            eq(sandbox.organizationId, organizationId),
            cursorFilter(sandbox.createdAt, sandbox.id, options),
            options.status
              ? sql`${sandbox.status} = ${options.status}`
              : undefined,
          ),
        )
        .orderBy(desc(sandbox.createdAt), desc(sandbox.id))
        .limit(options.limit);
    },
    async create(organizationId: string, input: CreateSandboxInput) {
      const [record] = await db
        .insert(sandbox)
        .values({
          ...input,
          organizationId,
          provider: input.type === "FIRECRACKER" ? "firecracker" : "docker",
          image:
            input.type === "FIRECRACKER"
              ? "firecracker-rootfs:local"
              : env.SANDBOX_IMAGE,
          expiresAt: new Date(Date.now() + 3600000),
        })
        .returning();
      let resourceId: string | undefined;
      try {
        const [policy] = await db
          .select()
          .from(executionPolicy)
          .where(eq(executionPolicy.organizationId, organizationId))
          .limit(1);
        const created = await provider.create({
          ...input,
          name: record!.id,
          approvedHosts: policy?.approvedHosts ?? [],
        });
        resourceId = created.resourceId;
        const updated = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(sandbox)
            .set({
              resourceId: created.resourceId,
              status: "RUNNING",
              networkHosts: policy?.approvedHosts ?? [],
            })
            .where(
              and(
                eq(sandbox.id, record!.id),
                eq(sandbox.organizationId, organizationId),
              ),
            )
            .returning();
          await appendPlatformEventTx(
            tx,
            organizationId,
            "sandbox.created",
            record!.id,
            { status: "RUNNING" },
          );
          return row!;
        });
        return updated!;
      } catch (error) {
        if (resourceId) await provider.destroy(resourceId);
        await db
          .update(sandbox)
          .set({ status: "FAILED" })
          .where(eq(sandbox.id, record!.id));
        throw error;
      }
    },
    async execute(organizationId: string, id: string, command: string) {
      const record = await find(organizationId, id, true);
      const decision = await evaluateAction(
        organizationId,
        "execute_command",
        { command },
        id,
      );
      if (!decision.allowed)
        throw new HttpError(409, decision.reason!, {
          approvalId: decision.approvalId,
        });
      if (!record.resourceId) throw new HttpError(409, "SANDBOX_NOT_READY");
      const result = await provider.execute(record.resourceId, command);
      if (result.timedOut || result.outputLimited)
        await db
          .update(sandbox)
          .set({ status: "STOPPED" })
          .where(
            and(eq(sandbox.id, id), eq(sandbox.organizationId, organizationId)),
          );
      return result;
    },
    async destroy(organizationId: string, id: string) {
      const record = await find(organizationId, id);
      await db
        .update(agentRun)
        .set({ cancelRequestedAt: new Date() })
        .where(
          and(
            eq(agentRun.sandboxId, id),
            eq(agentRun.organizationId, organizationId),
            sql`${agentRun.status} in ('RUNNING','QUEUED','AWAITING_APPROVAL')`,
          ),
        );
      if (record.resourceId) await provider.destroy(record.resourceId);
      await db
        .update(browserSession)
        .set({ status: "CLOSED", encryptedState: null })
        .where(
          and(
            eq(browserSession.sandboxId, id),
            eq(browserSession.organizationId, organizationId),
          ),
        );
      await db
        .update(execution)
        .set({
          status: "INTERRUPTED",
          completedAt: new Date(),
          cancelRequestedAt: new Date(),
        })
        .where(
          and(
            eq(execution.sandboxId, id),
            eq(execution.organizationId, organizationId),
            sql`${execution.status} in ('RUNNING','QUEUED')`,
          ),
        );
      await db.transaction(async (tx) => {
        await tx
          .update(sandbox)
          .set({ status: "DESTROYED", resourceId: null })
          .where(
            and(eq(sandbox.id, id), eq(sandbox.organizationId, organizationId)),
          );
        await appendPlatformEventTx(
          tx,
          organizationId,
          "sandbox.destroyed",
          id,
        );
      });
    },
  };
}

export type SandboxService = ReturnType<typeof createSandboxService>;
