import { McpConnection } from "@repo/mcp-client";
import type { ToolRegistry } from "./index";
export { httpMcpTransport, type McpTransport } from "@repo/mcp-client";
export class McpClient extends McpConnection {
  async register(registry: ToolRegistry, prefix: string, signal?: AbortSignal) {
    for (const tool of await this.list(signal))
      registry.register({
        name: `mcp_${prefix}_${tool.name}`
          .replace(/[^a-zA-Z0-9_-]/g, "_")
          .slice(0, 64),
        description: tool.description ?? tool.name,
        inputSchema: tool.inputSchema,
        version: "2",
        permission: "mcp.execute",
        risk: "execute",
        timeoutMs: 30000,
        validate: (input) => input as Record<string, unknown>,
        execute: (input, context) =>
          this.call(tool.name, input, context.signal),
      });
  }
}
