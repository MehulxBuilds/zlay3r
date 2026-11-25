import type { FastifyInstance } from "fastify";
import { db, auditRecord } from "@repo/db";
import type { SandboxProvider } from "@repo/sandbox";
import { registerToolsRoutes } from "../tools/tools.routes";
import { registerOrganizationsRoutes } from "../organizations/organizations.routes";
import { registerKeysRoutes } from "../keys/keys.routes";
import { registerProvidersRoutes } from "../providers/providers.routes";
import { registerSecretsRoutes } from "../secrets/secrets.routes";
import { registerPoliciesRoutes } from "../policies/policies.routes";
import { registerSessionsRoutes } from "../sessions/sessions.routes";
import { registerArtifactsRoutes } from "../artifacts/artifacts.routes";
import { registerApprovalsRoutes } from "../approvals/approvals.routes";
import { registerAuditRoutes } from "../audit/audit.routes";
import { registerUsageRoutes } from "../usage/usage.routes";
import { registerMcpServersRoutes } from "../mcp-servers/mcp-servers.routes";
export async function registerPlatformRoutes(
  app: FastifyInstance,
  provider: SandboxProvider,
) {
  app.addHook("onSend", async (request, reply, payload) => {
    if (
      !request.user ||
      ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
      reply.statusCode >= 400
    )
      return;
    let resourceId = (request.params as { id?: string })?.id;
    if (!resourceId && typeof payload === "string") {
      try {
        const body = JSON.parse(payload);
        if (typeof body?.id === "string") resourceId = body.id;
      } catch {
        /* Streams have no JSON resource body. */
      }
    }
    await db.insert(auditRecord).values({
      organizationId: request.user.organizationId,
      actorId: request.user.id,
      action: `${request.method} ${request.routeOptions.url}`,
      resourceId,
    });
  });
  await registerToolsRoutes(app, provider);
  await registerOrganizationsRoutes(app, provider);
  await registerKeysRoutes(app, provider);
  await registerProvidersRoutes(app, provider);
  await registerSecretsRoutes(app, provider);
  await registerPoliciesRoutes(app, provider);
  await registerSessionsRoutes(app, provider);
  await registerArtifactsRoutes(app, provider);
  await registerApprovalsRoutes(app, provider);
  await registerAuditRoutes(app, provider);
  await registerUsageRoutes(app, provider);
  await registerMcpServersRoutes(app, provider);
}
