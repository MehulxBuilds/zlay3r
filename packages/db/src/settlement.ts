import { db } from "./db";
import { agentEvent, usageEvent } from "../schema/index";
import { and, eq, sql } from "drizzle-orm";
export async function settleRunUsage(organizationId: string, runId: string) {
  const [usage] = await db
    .select({
      responses: sql<string>`count(*)`,
      tokens: sql<string>`coalesce(sum(coalesce((${agentEvent.payload}->>'inputTokens')::numeric, 0) + coalesce((${agentEvent.payload}->>'outputTokens')::numeric, 0)),0)`,
      known: sql<boolean>`coalesce(bool_and(coalesce((${agentEvent.payload}->>'usageKnown')::boolean, false)), true)`,
    })
    .from(agentEvent)
    .where(
      and(eq(agentEvent.runId, runId), eq(agentEvent.type, "model.response")),
    );
  const [calls] = await db
    .select({ count: sql<string>`count(*)` })
    .from(agentEvent)
    .where(
      and(eq(agentEvent.runId, runId), eq(agentEvent.type, "tool.requested")),
    );
  const [requests] = await db
    .select({ count: sql<string>`count(*)` })
    .from(agentEvent)
    .where(
      and(eq(agentEvent.runId, runId), eq(agentEvent.type, "model.requested")),
    );
  if (usage!.known && Number(requests!.count) <= Number(usage!.responses))
    await db
      .update(usageEvent)
      .set({
        quantity: usage!.tokens,
        metadata: { reserved: false, usageKnown: true },
      })
      .where(
        and(
          eq(usageEvent.organizationId, organizationId),
          eq(usageEvent.idempotencyKey, `${runId}-tokens`),
        ),
      );
  await db
    .update(usageEvent)
    .set({ quantity: calls!.count, metadata: { reserved: false } })
    .where(
      and(
        eq(usageEvent.organizationId, organizationId),
        eq(usageEvent.idempotencyKey, `${runId}-tool_calls`),
      ),
    );
  await db
    .update(usageEvent)
    .set({ metadata: { reserved: false } })
    .where(
      and(
        eq(usageEvent.organizationId, organizationId),
        eq(usageEvent.idempotencyKey, `${runId}-runs`),
      ),
    );
}
