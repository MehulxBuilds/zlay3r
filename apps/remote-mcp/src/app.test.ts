import { expect, test } from "bun:test";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { buildRemoteMcpApp } from "./app";

test("remote v2 initialization, scoped discovery, API dispatch, revocation and tenant rejection", async () => {
  const api = Fastify();
  let revoked = false;
  let executions = 0;
  api.get("/v1/mcp/principal", async (request, reply) => {
    if (revoked || request.headers.authorization !== "Bearer zk_fixture")
      return reply.code(401).send({});
    return {
      organizationId: "org-a",
      scopes: ["mcp.execute", "sandbox.read", "sandbox.execute"],
    };
  });
  api.get("/v1/sandboxes", async () => [
    { id: "11111111-1111-4111-8111-111111111111" },
  ]);
  api.post("/v1/sandboxes/:id/exec", async (request, reply) => {
    if (
      (request.params as { id: string }).id !==
      "11111111-1111-4111-8111-111111111111"
    )
      return reply.code(404).send({ error: "SANDBOX_NOT_FOUND" });
    executions++;
    return { stdout: "hello", stderr: "", exitCode: 0 };
  });
  const baseUrl = await api.listen({ host: "127.0.0.1", port: 0 });
  const app = buildRemoteMcpApp(baseUrl, "http://localhost:3000");
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const client = new Client({ name: "integration", version: "1.0.0" });
  try {
    expect(
      (await app.inject({ method: "POST", url: "/mcp", payload: {} }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/mcp",
          headers: {
            origin: "https://untrusted.example",
            authorization: "Bearer zk_fixture",
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
        requestInit: { headers: { authorization: "Bearer zk_fixture" } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.some((tool) => tool.name === "sandbox.list")).toBe(true);
    expect(tools.some((tool) => tool.name === "sandbox.create")).toBe(false);
    const result = await client.callTool({
      name: "sandbox.execute",
      arguments: {
        sandboxId: "11111111-1111-4111-8111-111111111111",
        command: "echo hello",
      },
    });
    expect(result.structuredContent).toEqual({
      result: { stdout: "hello", stderr: "", exitCode: 0 },
    });
    const denied = await client.callTool({
      name: "sandbox.execute",
      arguments: {
        sandboxId: "22222222-2222-4222-8222-222222222222",
        command: "echo hello",
      },
    });
    expect(denied.isError).toBe(true);
    const invalid = await client.callTool({
      name: "sandbox.execute",
      arguments: {
        sandboxId: "11111111-1111-4111-8111-111111111111",
        command: "echo hello",
        organizationId: "org-b",
      },
    });
    expect(invalid.isError).toBe(true);
    expect(executions).toBe(1);
    const local = new Client({ name: "stdio-integration", version: "1.0.0" });
    try {
      await local.connect(
        new StdioClientTransport({
          command: "node",
          args: ["--import", "tsx", "packages/local-mcp/src/index.ts"],
          cwd: fileURLToPath(new URL("../../../", import.meta.url)),
          env: {
            NODE_ENV: "test",
            DATABASE_URL: "postgresql://fixture:fixture@localhost:5432/fixture",
            REDIS_URL: "redis://localhost:6379",
            MCP_API_BASE: baseUrl,
            MCP_API_KEY: "zk_fixture",
          },
          stderr: "ignore",
        }),
        { timeout: 10000 },
      );
      expect((await local.listTools()).tools.map((tool) => tool.name)).toEqual(
        tools.map((tool) => tool.name),
      );
      expect(
        (await local.callTool({ name: "sandbox.list", arguments: {} }))
          .structuredContent,
      ).toEqual({ result: [{ id: "11111111-1111-4111-8111-111111111111" }] });
    } finally {
      await local.close();
    }
    revoked = true;
    await expect(
      client.listTools({}, { cacheMode: "bypass" }),
    ).rejects.toThrow();
  } finally {
    await client.close();
    await app.close();
    await api.close();
  }
});
