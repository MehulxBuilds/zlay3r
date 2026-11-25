import type { FastifyInstance } from "fastify";
import { db, eq, mcpServer } from "@repo/db";
import { authorize } from "../platform/authorization";
import type { SandboxProvider } from "@repo/sandbox";
export async function registerMcpServersRoutes(
  app: FastifyInstance,
  _provider: SandboxProvider,
) {
  app.get("/mcp-servers", async (request) => {
    authorize(request, "organization.admin");
    return db
      .select()
      .from(mcpServer)
      .where(eq(mcpServer.organizationId, request.user.organizationId));
  });
}
