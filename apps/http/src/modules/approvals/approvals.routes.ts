import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, and, eq, sql, approval, desc } from "@repo/db";
import { authorize } from "../platform/authorization";
import { HttpError } from "../../lib/errors";
import type { SandboxProvider } from "@repo/sandbox";
import { idParams } from "../platform/platform.contracts";
export async function registerApprovalsRoutes(
  app: FastifyInstance,
  _provider: SandboxProvider,
) {
  app.get("/approvals", async (request) => {
    authorize(request, "runs.read");
    return db
      .select()
      .from(approval)
      .where(eq(approval.organizationId, request.user.organizationId))
      .orderBy(desc(approval.createdAt))
      .limit(100);
  });
  app.post(
    "/approvals/:id/decision",
    { schema: { body: bodySchema(z.object({ approve: z.boolean() })) } },
    async (request) => {
      authorize(request, "approvals.admin");
      const { id } = idParams.parse(request.params);
      const { approve } = z
        .object({ approve: z.boolean() })
        .parse(request.body);
      const [record] = await db
        .update(approval)
        .set({
          status: approve ? "APPROVED" : "REJECTED",
          decidedBy: request.user.id,
        })
        .where(
          and(
            eq(approval.id, id),
            eq(approval.organizationId, request.user.organizationId),
            eq(approval.status, "PENDING"),
            sql`${approval.expiresAt} > now()`,
          ),
        )
        .returning();
      if (!record) throw new HttpError(409, "APPROVAL_NOT_PENDING");
      return record;
    },
  );
}
