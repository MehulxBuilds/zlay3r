import type { FastifyInstance } from "fastify";
import { db, eq } from "@repo/db";
import { authorize } from "../platform/authorization";
import type { SandboxProvider } from "@repo/sandbox";
import { toolDefinition } from "@repo/db";
import { sandboxTools } from "@repo/agent-runtime";
export async function registerToolsRoutes(
  app: FastifyInstance,
  provider: SandboxProvider,
) {
  app.get("/tools", async (request) => {
    authorize(request, "tools.read");
    return {
      builtins: sandboxTools(provider, "catalog").metadata(),
      registered: await db
        .select()
        .from(toolDefinition)
        .where(eq(toolDefinition.organizationId, request.user.organizationId)),
    };
  });
}
