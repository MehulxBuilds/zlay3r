import { agentEvent, agentRun, and, asc, db, eq } from "@repo/db";
import type { Queue } from "bullmq";
import type { RunJob } from "@repo/shared";
import { HttpError } from "../../lib/errors";
import type { SandboxService } from "../sandboxes/sandbox.service";

export function createRunService(
  queue: Queue<RunJob>,
  sandboxes: SandboxService,
) {
  return {
    async create(
      organizationId: string,
      input: { sandboxId: string; task: string },
    ) {
      await sandboxes.find(organizationId, input.sandboxId, true);
      const [run] = await db
        .insert(agentRun)
        .values({ ...input, organizationId })
        .returning();
      try {
        await queue.add(
          "execute-agent-run",
          { ...input, runId: run!.id, organizationId },
          {
            jobId: run!.id,
            attempts: 2,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        );
      } catch (error) {
        await db
          .update(agentRun)
          .set({
            status: "FAILED",
            error: "QUEUE_UNAVAILABLE",
            completedAt: new Date(),
          })
          .where(eq(agentRun.id, run!.id));
        throw error;
      }
      return run!;
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
