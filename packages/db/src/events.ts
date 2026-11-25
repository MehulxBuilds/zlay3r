import { db } from "./db";
import { agentEvent, platformEvent } from "../schema/index";
import { eq, sql } from "drizzle-orm";
export async function appendRunEvent(
  runId: string,
  type: string,
  payload: unknown,
) {
  return db.transaction((tx) => appendRunEventTx(tx, runId, type, payload));
}
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function appendPlatformEventTx(
  tx: Transaction,
  organizationId: string,
  type: string,
  resourceId: string,
  payload: Record<string, unknown> = {},
) {
  await tx
    .insert(platformEvent)
    .values({ organizationId, type, resourceId, payload });
}

export async function appendRunEventTx(
  tx: Transaction,
  runId: string,
  type: string,
  payload: unknown,
) {
  await tx.execute(
    sql`SELECT id FROM agent_run WHERE id = ${runId} FOR UPDATE`,
  );
  const [record] = await tx
    .select({
      sequence: sql<number>`coalesce(max(${agentEvent.sequence}), 0) + 1`,
    })
    .from(agentEvent)
    .where(eq(agentEvent.runId, runId));
  const [event] = await tx
    .insert(agentEvent)
    .values({ runId, type, payload, sequence: Number(record!.sequence) })
    .returning();
  return event!;
}
