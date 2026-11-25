import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, db, eq, sandbox, executionPolicy } from "@repo/db";
import type { SandboxProvider } from "@repo/sandbox";
import { authorize } from "../platform/authorization";
import { HttpError } from "../../lib/errors";
const params = z.object({ id: z.string().uuid() });
export async function registerSandboxLifecycleRoutes(
  app: FastifyInstance,
  provider: SandboxProvider,
) {
  async function find(org: string, id: string) {
    const [record] = await db
      .select()
      .from(sandbox)
      .where(and(eq(sandbox.id, id), eq(sandbox.organizationId, org)))
      .limit(1);
    if (!record?.resourceId) throw new HttpError(404, "SANDBOX_NOT_FOUND");
    return record;
  }
  app.get("/sandboxes/:id", async (request) => {
    authorize(request, "sandbox.read");
    const { id } = params.parse(request.params);
    const record = await find(request.user.organizationId, id);
    return { ...record, state: await provider.inspect(record.resourceId!) };
  });
  app.get("/sandboxes/:id/stats", async (request) => {
    authorize(request, "sandbox.read");
    const { id } = params.parse(request.params);
    return provider.stats(
      (await find(request.user.organizationId, id)).resourceId!,
    );
  });
  app.post(
    "/sandboxes/:id/lifecycle",
    {
      schema: {
        body: bodySchema(
          z.object({
            action: z.enum(["start", "stop", "pause", "resume", "restart"]),
          }),
        ),
      },
    },
    async (request) => {
      authorize(request, "sandbox.write");
      const { id } = params.parse(request.params);
      const { action } = z
        .object({
          action: z.enum(["start", "stop", "pause", "resume", "restart"]),
        })
        .parse(request.body);
      const record = await find(request.user.organizationId, id);
      if (["start", "restart", "resume"].includes(action)) {
        const [policy] = await db
          .select()
          .from(executionPolicy)
          .where(
            eq(executionPolicy.organizationId, request.user.organizationId),
          )
          .limit(1);
        if (
          JSON.stringify(record.networkHosts) !==
          JSON.stringify(policy?.approvedHosts ?? [])
        )
          throw new HttpError(409, "NETWORK_POLICY_CHANGED_RECREATE_SANDBOX");
      }
      await provider.lifecycle(record.resourceId!, action);
      const status =
        action === "stop"
          ? "STOPPED"
          : action === "pause"
            ? "PAUSED"
            : "RUNNING";
      return (
        await db
          .update(sandbox)
          .set({ status })
          .where(
            and(
              eq(sandbox.id, id),
              eq(sandbox.organizationId, request.user.organizationId),
            ),
          )
          .returning()
      )[0];
    },
  );
}
