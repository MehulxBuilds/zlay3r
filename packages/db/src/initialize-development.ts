import { db, pool, user, membership, executionPolicy, sql } from "@repo/db";
import { server_env as env } from "@repo/env";

// Explicit maintenance command. Never imported by startup, installation or builds.
if (env.NODE_ENV !== "development") throw new Error("DEVELOPMENT_ONLY");
try {
  await db.transaction(async (tx) => {
    for (const account of await tx.select().from(user)) {
      await tx
        .insert(membership)
        .values({
          organizationId: account.organizationId,
          userId: account.id,
          role: "owner",
        })
        .onConflictDoNothing();
      await tx
        .insert(executionPolicy)
        .values({ organizationId: account.organizationId })
        .onConflictDoNothing();
    }
    await tx.execute(
      sql`WITH ordered AS (SELECT id, row_number() OVER (PARTITION BY run_id ORDER BY created_at, id)::integer AS position FROM agent_event) UPDATE agent_event SET sequence = ordered.position FROM ordered WHERE agent_event.id = ordered.id`,
    );
  });
  console.log(
    "Existing development accounts have memberships and policies; event ordering is initialized.",
  );
} finally {
  await pool.end();
}
