import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, and, eq, sql, executionPolicy } from "@repo/db";
import { authorize } from "../platform/authorization";
import type { SandboxProvider } from "@repo/sandbox";
import { sandbox } from "@repo/db";
export async function registerPoliciesRoutes(
  app: FastifyInstance,
  provider: SandboxProvider,
) {
  app.get("/policies", async (request) => {
    authorize(request, "organization.read");
    return (
      await db
        .select()
        .from(executionPolicy)
        .where(eq(executionPolicy.organizationId, request.user.organizationId))
    )[0];
  });
  app.put(
    "/policies",
    {
      schema: {
        body: bodySchema(
          z.object({
            allowedTools: z.array(z.string().max(100)).max(100),
            allowedCommands: z
              .array(z.string().min(1).max(4000))
              .max(100)
              .default([]),
            approvedHosts: z
              .array(z.string().regex(/^[a-zA-Z0-9.-]+$/))
              .max(100),
            requireApproval: z.array(z.string().max(100)).max(100),
            maxTokens: z.number().int().min(100).max(1000000),
            maxToolCalls: z.number().int().min(1).max(100),
            deadlineMs: z.number().int().min(1000).max(1800000),
          }),
        ),
      },
    },
    async (request) => {
      authorize(request, "organization.admin");
      const input = z
        .object({
          allowedTools: z.array(z.string().max(100)).max(100),
          allowedCommands: z
            .array(z.string().min(1).max(4000))
            .max(100)
            .default([]),
          approvedHosts: z.array(z.string().regex(/^[a-zA-Z0-9.-]+$/)).max(100),
          requireApproval: z.array(z.string().max(100)).max(100),
          maxTokens: z.number().int().min(100).max(1000000),
          maxToolCalls: z.number().int().min(1).max(100),
          deadlineMs: z.number().int().min(1000).max(1800000),
        })
        .parse(request.body);
      const [previous] = await db
        .select()
        .from(executionPolicy)
        .where(eq(executionPolicy.organizationId, request.user.organizationId))
        .limit(1);
      if (
        JSON.stringify(previous?.approvedHosts ?? []) !==
        JSON.stringify(input.approvedHosts)
      ) {
        const boxes = await db
          .select()
          .from(sandbox)
          .where(
            and(
              eq(sandbox.organizationId, request.user.organizationId),
              sql`${sandbox.status} in ('RUNNING','PAUSED')`,
            ),
          );
        for (const box of boxes) {
          if (box.resourceId) await provider.lifecycle(box.resourceId, "stop");
          await db
            .update(sandbox)
            .set({ status: "STOPPED" })
            .where(eq(sandbox.id, box.id));
        }
      }
      return (
        await db
          .insert(executionPolicy)
          .values({ ...input, organizationId: request.user.organizationId })
          .onConflictDoUpdate({
            target: executionPolicy.organizationId,
            set: input,
          })
          .returning()
      )[0];
    },
  );
}
