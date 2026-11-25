import type { db } from "./db";
import { quota, usageEvent } from "../schema/index";
import { and, eq, sql } from "drizzle-orm";
type Database = Pick<typeof db, "execute" | "select" | "insert">;
export async function reserveUsage(
  tx: Database,
  organizationId: string,
  metric: string,
  quantity: number,
  unit: string,
  key: string,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId + metric}))`,
  );
  const [limit] = await tx
    .select()
    .from(quota)
    .where(
      and(eq(quota.organizationId, organizationId), eq(quota.metric, metric)),
    )
    .limit(1);
  if (limit) {
    const [existing] = await tx
      .select({ quantity: usageEvent.quantity })
      .from(usageEvent)
      .where(eq(usageEvent.idempotencyKey, key))
      .limit(1);
    const [used] = await tx
      .select({ total: sql<string>`coalesce(sum(${usageEvent.quantity}),0)` })
      .from(usageEvent)
      .where(
        and(
          eq(usageEvent.organizationId, organizationId),
          eq(usageEvent.metric, metric),
          metric === "artifact_bytes"
            ? undefined
            : sql`${usageEvent.occurredAt} >= date_trunc('month', now())`,
        ),
      );
    if (
      Number(used!.total) - Number(existing?.quantity ?? 0) + quantity >
      Number(limit.limit)
    )
      throw new Error("QUOTA_EXCEEDED");
  }
  await tx
    .insert(usageEvent)
    .values({
      organizationId,
      metric,
      quantity: String(quantity),
      unit,
      idempotencyKey: key,
      metadata: { reserved: true },
    })
    .onConflictDoUpdate({
      target: usageEvent.idempotencyKey,
      set: { quantity: String(quantity), metadata: { reserved: true } },
    });
}
