import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and,
  db,
  eq,
  mcpServer,
  sandbox,
  executionPolicy,
  resolveSecrets,
} from "@repo/db";
import {
  McpClient,
  httpMcpTransport,
  type McpTransport,
} from "@repo/agent-runtime";
import type { SandboxProvider } from "@repo/sandbox";
import { authorize } from "../platform/authorization";
import { HttpError } from "../../lib/errors";
import { randomUUID } from "node:crypto";

const configSchema = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("http"),
    url: z.url().max(4096),
    authorizationSecret: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .optional(),
  }),
  z.object({
    transport: z.literal("stdio"),
    sandboxId: z.string().uuid(),
    command: z.string().min(1).max(1000),
    args: z.array(z.string().max(1000)).max(30).default([]),
    secretNames: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/))
      .max(20)
      .default([]),
  }),
]);
export async function registerMcpRoutes(
  app: FastifyInstance,
  provider: SandboxProvider,
) {
  app.post(
    "/mcp-servers",
    {
      schema: {
        body: bodySchema(
          z.object({
            name: z.string().min(1).max(100),
            configuration: configSchema,
          }),
        ),
      },
    },
    async (request, reply) => {
      authorize(request, "organization.admin");
      const input = z
        .object({
          name: z.string().min(1).max(100),
          configuration: configSchema,
        })
        .parse(request.body);
      return reply.code(201).send(
        (
          await db
            .insert(mcpServer)
            .values({
              name: input.name,
              organizationId: request.user.organizationId,
              transport: input.configuration.transport,
              configuration: input.configuration,
            })
            .returning()
        )[0],
      );
    },
  );
  app.delete("/mcp-servers/:id", async (request, reply) => {
    authorize(request, "organization.admin");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db
      .delete(mcpServer)
      .where(
        and(
          eq(mcpServer.id, id),
          eq(mcpServer.organizationId, request.user.organizationId),
        ),
      );
    return reply.code(204).send();
  });
  app.post("/mcp-servers/:id/tools", async (request) => {
    authorize(request, "mcp.execute");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [record] = await db
      .select()
      .from(mcpServer)
      .where(
        and(
          eq(mcpServer.id, id),
          eq(mcpServer.organizationId, request.user.organizationId),
        ),
      )
      .limit(1);
    if (!record) throw new HttpError(404, "MCP_SERVER_NOT_FOUND");
    const configuration = configSchema.parse(record.configuration);
    const connectionId = randomUUID();
    const names =
      configuration.transport === "http"
        ? configuration.authorizationSecret
          ? [configuration.authorizationSecret]
          : []
        : configuration.secretNames;
    if (names.length) authorize(request, "secrets.use");
    const values = await resolveSecrets(request.user.organizationId, names);
    let transport: McpTransport | ReturnType<typeof httpMcpTransport>;
    if (configuration.transport === "http") {
      const [policy] = await db
        .select()
        .from(executionPolicy)
        .where(eq(executionPolicy.organizationId, request.user.organizationId))
        .limit(1);
      transport = httpMcpTransport(
        configuration.url,
        policy?.approvedHosts ?? [],
        configuration.authorizationSecret
          ? values[configuration.authorizationSecret]
          : undefined,
      );
    } else {
      const [box] = await db
        .select()
        .from(sandbox)
        .where(
          and(
            eq(sandbox.id, configuration.sandboxId),
            eq(sandbox.organizationId, request.user.organizationId),
            eq(sandbox.status, "RUNNING"),
          ),
        )
        .limit(1);
      if (!box?.resourceId) throw new HttpError(409, "SANDBOX_NOT_READY");
      transport = (message) =>
        provider.service(box.resourceId!, {
          op: "mcp",
          id: connectionId,
          command: configuration.command,
          args: configuration.args,
          env: values,
          message,
        });
      transport.close = async () => {
        await provider.service(box.resourceId!, {
          op: "mcp",
          id: connectionId,
          close: true,
        });
      };
    }
    const client = new McpClient(transport, Object.values(values));
    try {
      return (await client.list(AbortSignal.timeout(30000))).map((tool) => ({
        ...tool,
        platformName: `mcp_${id.slice(0, 8)}_${tool.name}`
          .replace(/[^a-zA-Z0-9_-]/g, "_")
          .slice(0, 64),
      }));
    } finally {
      try {
        await client.close();
      } catch (error) {
        request.log.warn(
          {
            serverId: id,
            error: error instanceof Error ? error.name : "UNKNOWN",
          },
          "MCP cleanup failed",
        );
      }
    }
  });
  app.get("/mcp/principal", async (request) => {
    authorize(request, "mcp.execute");
    if (!request.apiScopes) throw new HttpError(401, "API_KEY_REQUIRED");
    return {
      organizationId: request.user.organizationId,
      scopes: request.apiScopes,
    };
  });
}
