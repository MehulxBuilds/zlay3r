import { expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { McpClient } from "./mcp";
import { ToolRegistry } from "./index";

test("official v2 discovery and execution pass through registry validation and authorization", async () => {
  const server = new McpServer({ name: "fixture", version: "1.0.0" });
  let calls = 0;
  server.registerTool(
    "echo",
    { inputSchema: z.strictObject({ text: z.string() }) },
    async ({ text }) => {
      calls++;
      return { content: [{ type: "text", text }], structuredContent: { text } };
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new McpClient(clientTransport, ["secret"]);
  const registry = new ToolRegistry();
  const context = { signal: AbortSignal.timeout(5000), sandboxId: "fixture" };
  try {
    await client.register(registry, "fixture", context.signal);
    expect(registry.list()[0]?.name).toBe("mcp_fixture_echo");
    await expect(
      registry.invoke("mcp_fixture_echo", { text: 1 }, context, async () => {}),
    ).rejects.toThrow("INVALID_TOOL_ARGUMENTS");
    await expect(
      registry.invoke(
        "mcp_fixture_echo",
        { text: "blocked" },
        context,
        async () => {
          throw new Error("DENIED");
        },
      ),
    ).rejects.toThrow("DENIED");
    expect(calls).toBe(0);
    const result = await registry.invoke(
      "mcp_fixture_echo",
      { text: "secret" },
      context,
      async () => {},
    );
    expect(result).toMatchObject({
      content: [{ type: "text", text: "[REDACTED]" }],
      structuredContent: { text: "[REDACTED]" },
    });
    expect(calls).toBe(1);
    const aborted = AbortSignal.abort(new Error("CANCELLED"));
    await expect(
      client.call("echo", { text: "never" }, aborted),
    ).rejects.toThrow("CANCELLED");
    expect(calls).toBe(1);
  } finally {
    await client.close();
    await server.close();
  }
});
