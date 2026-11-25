import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  authenticatePlatform,
  createPlatformMcpServer,
} from "@repo/mcp-server";
import { server_env as env } from "@repo/env";

if (!env.MCP_API_KEY) throw new Error("MCP_API_KEY is required");
const principal = await authenticatePlatform(env.MCP_API_BASE, env.MCP_API_KEY);
const server = createPlatformMcpServer({
  baseUrl: env.MCP_API_BASE,
  token: env.MCP_API_KEY,
  principal,
});
await server.connect(new StdioServerTransport());
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void server.close().catch(() => {
      process.exitCode = 1;
    });
  });
