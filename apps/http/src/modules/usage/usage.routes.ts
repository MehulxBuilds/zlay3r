import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, and, eq, sql, usageEvent, quota } from "@repo/db";
import { authorize } from "../platform/authorization";
import type { SandboxProvider } from "@repo/sandbox";
import { HttpError } from "../../lib/errors";
import { artifact } from "@repo/db";
export async function registerUsageRoutes(
  app: FastifyInstance,
  _provider: SandboxProvider,
) {
  app.get("/usage", async (request) => {
    authorize(request, "models.read");
    const query = z
      .object({
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
      })
      .parse(request.query);
    const from = query.from
      ? new Date(query.from)
      : new Date(
          Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
        );
    const to = query.to ? new Date(query.to) : new Date();
    if (from > to || to.getTime() - from.getTime() > 366 * 86400000)
      throw new HttpError(400, "INVALID_USAGE_PERIOD");
    const period = and(
      eq(usageEvent.organizationId, request.user.organizationId),
      sql`${usageEvent.occurredAt} >= ${from} AND ${usageEvent.occurredAt} <= ${to}`,
    );
    return {
      period: { from, to },
      storage: (
        await db
          .select({
            bytes: sql<string>`coalesce(sum(${artifact.size}),0)`,
            count: sql<string>`count(*)`,
          })
          .from(artifact)
          .where(
            and(
              eq(artifact.organizationId, request.user.organizationId),
              eq(artifact.status, "READY"),
            ),
          )
      )[0],
      totals: await db
        .select({
          metric: usageEvent.metric,
          unit: usageEvent.unit,
          quantity: sql<string>`sum(${usageEvent.quantity})`,
        })
        .from(usageEvent)
        .where(
          and(
            period,
            sql`coalesce((${usageEvent.metadata}->>'reserved')::boolean, false) = false`,
          ),
        )
        .groupBy(usageEvent.metric, usageEvent.unit),
      reservations: await db
        .select({
          metric: usageEvent.metric,
          quantity: sql<string>`sum(${usageEvent.quantity})`,
        })
        .from(usageEvent)
        .where(
          and(
            period,
            sql`coalesce((${usageEvent.metadata}->>'reserved')::boolean, false) = true`,
          ),
        )
        .groupBy(usageEvent.metric),
      models: await db
        .select({
          provider: sql<string>`${usageEvent.metadata}->>'provider'`,
          model: sql<string>`${usageEvent.metadata}->>'model'`,
          metric: usageEvent.metric,
          quantity: sql<string>`sum(${usageEvent.quantity})`,
        })
        .from(usageEvent)
        .where(
          and(
            period,
            sql`${usageEvent.metric} in ('model_input_tokens','model_output_tokens','estimated_model_cost')`,
          ),
        )
        .groupBy(
          sql`${usageEvent.metadata}->>'provider'`,
          sql`${usageEvent.metadata}->>'model'`,
          usageEvent.metric,
        ),
      quotas: await db
        .select()
        .from(quota)
        .where(eq(quota.organizationId, request.user.organizationId)),
    };
  });
  app.put(
    "/quotas",
    {
      schema: {
        body: bodySchema(
          z.object({
            metric: z.enum(["tokens", "runs", "tool_calls", "artifact_bytes"]),
            limit: z.number().nonnegative().max(1e12),
          }),
        ),
      },
    },
    async (request, reply) => {
      authorize(request, "organization.admin");
      const input = z
        .object({
          metric: z.enum(["tokens", "runs", "tool_calls", "artifact_bytes"]),
          limit: z.number().nonnegative().max(1e12),
        })
        .parse(request.body);
      await db
        .insert(quota)
        .values({
          ...input,
          limit: String(input.limit),
          period: input.metric === "artifact_bytes" ? "storage" : "month",
          organizationId: request.user.organizationId,
        })
        .onConflictDoUpdate({
          target: [quota.organizationId, quota.metric],
          set: {
            limit: String(input.limit),
            period: input.metric === "artifact_bytes" ? "storage" : "month",
          },
        });
      return reply.code(204).send();
    },
  );
}
