import { McpServer } from "@modelcontextprotocol/server";
import { AgentPlatformClient } from "@repo/sdk";
import { z } from "zod";

export interface Principal {
  organizationId: string;
  scopes: string[];
}
export async function authenticatePlatform(
  baseUrl: string,
  token: string,
): Promise<Principal> {
  if (!token.startsWith("zk_")) throw new Error("UNAUTHORIZED");
  const response = await fetch(new URL("/v1/mcp/principal", baseUrl), {
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("UNAUTHORIZED");
  return z
    .object({ organizationId: z.string(), scopes: z.array(z.string()) })
    .parse(await response.json());
}

export function createPlatformMcpServer(options: {
  baseUrl: string;
  token: string;
  principal: Principal;
}) {
  const server = new McpServer({ name: "zlayer", version: "2.0.0" });
  const client = new AgentPlatformClient({
    baseUrl: options.baseUrl,
    token: options.token,
    retries: 0,
    timeoutMs: 30000,
  });
  const id = z.string().uuid();
  const box = z.strictObject({ sandboxId: id });
  const resource = z.strictObject({ id });
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    schema: z.ZodObject<S>,
    scopes: string[],
    execute: (
      input: z.infer<z.ZodObject<S>>,
      api: AgentPlatformClient,
    ) => Promise<unknown>,
  ) {
    if (!scopes.every((scope) => options.principal.scopes.includes(scope)))
      return;
    server.registerTool(
      name,
      { description, inputSchema: schema },
      async (input, context) => {
        try {
          // Revalidate revocation and scopes for long-lived local stdio sessions.
          const principal = await authenticatePlatform(
            options.baseUrl,
            options.token,
          );
          if (
            principal.organizationId !== options.principal.organizationId ||
            !scopes.every((scope) => principal.scopes.includes(scope))
          )
            throw new Error("PERMISSION_DENIED");
          const result = await execute(
            schema.parse(input),
            client.withSignal(
              AbortSignal.any([
                context.mcpReq.signal,
                AbortSignal.timeout(30000),
              ]),
            ),
          );
          const text = JSON.stringify(result ?? null);
          if (text.length > 2 * 1048576) throw new Error("MCP_RESPONSE_LIMIT");
          return {
            content: [{ type: "text" as const, text }],
            structuredContent: { result: result ?? null },
          };
        } catch {
          // Upstream errors can contain request data: never relay them verbatim.
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Platform operation failed. Check permissions, arguments and resource availability.",
              },
            ],
          };
        }
      },
    );
  }
  tool(
    "sandbox.create",
    "Create an organization sandbox",
    z.strictObject({ name: z.string().max(100).optional() }),
    ["sandbox.write"],
    (input, api) => api.createSandbox(input),
  );
  tool(
    "sandbox.get",
    "Get an authorized sandbox",
    box,
    ["sandbox.read"],
    ({ sandboxId }, api) => api.getSandbox(sandboxId),
  );
  tool(
    "sandbox.list",
    "List organization sandboxes",
    z.strictObject({}),
    ["sandbox.read"],
    (_input, api) => api.listSandboxes(),
  );
  for (const action of ["start", "stop", "pause", "resume"] as const)
    tool(
      `sandbox.${action}`,
      `${action} an authorized sandbox`,
      box,
      ["sandbox.write"],
      ({ sandboxId }, api) => api.sandboxLifecycle(sandboxId, action),
    );
  tool(
    "sandbox.destroy",
    "Destroy an authorized sandbox",
    box,
    ["sandbox.write"],
    ({ sandboxId }, api) => api.destroySandbox(sandboxId),
  );
  tool(
    "sandbox.execute",
    "Execute a bounded command under the sandbox policy",
    box.extend({ command: z.string().min(1).max(4000) }),
    ["sandbox.execute"],
    ({ sandboxId, command }, api) => api.execute(sandboxId, command),
  );
  tool(
    "sandbox.execution.get",
    "Get an execution",
    resource,
    ["execution.read"],
    ({ id }, api) => api.getExecution(id),
  );
  tool(
    "sandbox.execution.cancel",
    "Cancel an execution",
    resource,
    ["sandbox.execute"],
    ({ id }, api) => api.cancelExecution(id),
  );
  for (const [name, op] of [
    ["read", "read"],
    ["write", "write"],
    ["list", "list"],
    ["create_directory", "mkdir"],
    ["delete", "delete"],
  ] as const) {
    const schema = box.extend({
      path: z.string().min(1).max(4096),
      ...(op === "write" ? { data: z.string().max(1048576) } : {}),
    });
    tool(
      `filesystem.${name}`,
      `${name} a workspace path${op === "write" ? "; data is base64 encoded" : ""}`,
      schema,
      [op === "read" || op === "list" ? "files.read" : "files.write"],
      (input, api) =>
        api.files(input.sandboxId, {
          op,
          path: input.path,
          ...("data" in input ? { data: z.string().parse(input.data) } : {}),
        }),
    );
  }
  tool(
    "agent.run",
    "Queue an agent run",
    box.extend({
      task: z.string().min(1).max(20000),
      sessionId: id.optional(),
    }),
    ["runs.write", "models.use"],
    (input, api) => api.createRun(input),
  );
  tool(
    "agent.get_status",
    "Get agent run status",
    resource,
    ["runs.read"],
    ({ id }, api) => api.getRun(id),
  );
  tool(
    "agent.get_result",
    "Get agent run and result",
    resource,
    ["runs.read"],
    ({ id }, api) => api.getRun(id),
  );
  tool(
    "agent.cancel",
    "Cancel an agent run",
    resource,
    ["runs.write"],
    ({ id }, api) => api.cancelRun(id),
  );
  tool(
    "session.create",
    "Create an agent session",
    z.strictObject({ title: z.string().min(1).max(200) }),
    ["sessions.write"],
    ({ title }, api) => api.createSession(title),
  );
  tool(
    "session.get",
    "Get a session",
    resource,
    ["sessions.read"],
    ({ id }, api) => api.getSession(id),
  );
  tool(
    "session.get_history",
    "Get session messages and runs",
    resource,
    ["sessions.read"],
    ({ id }, api) => api.getSession(id),
  );
  tool(
    "session.list",
    "List organization sessions",
    z.strictObject({}),
    ["sessions.read"],
    (_input, api) => api.listSessions(),
  );
  tool(
    "artifact.list",
    "List organization artifacts",
    z.strictObject({}),
    ["artifacts.read"],
    (_input, api) => api.listArtifacts(),
  );
  tool(
    "artifact.download",
    "Get an expiring artifact download URL",
    resource,
    ["artifacts.read"],
    ({ id }, api) => api.downloadArtifact(id),
  );
  return server;
}
