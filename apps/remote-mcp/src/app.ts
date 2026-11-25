import Fastify from "fastify";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import {
  authenticatePlatform,
  createPlatformMcpServer,
} from "@repo/mcp-server";

export function buildRemoteMcpApp(baseUrl: string, allowedOrigin: string) {
  const app = Fastify({
    bodyLimit: 262144,
    logger: { redact: ["req.headers.authorization"] },
  });
  app.get("/health", async () => ({ ok: true }));
  app.route({
    method: ["POST", "GET", "DELETE"],
    url: "/mcp",
    async handler(request, reply) {
      if (request.headers.origin && request.headers.origin !== allowedOrigin)
        return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer zk_"))
        return reply
          .header("www-authenticate", "Bearer")
          .code(401)
          .send({ error: "UNAUTHORIZED" });
      const token = authorization.slice(7);
      let principal: Awaited<ReturnType<typeof authenticatePlatform>>;
      try {
        principal = await authenticatePlatform(baseUrl, token);
      } catch {
        return reply
          .header("www-authenticate", "Bearer")
          .code(401)
          .send({ error: "UNAUTHORIZED" });
      }
      // Stateless mode has no persistent SSE stream or session to delete.
      if (request.method !== "POST")
        return reply
          .header("allow", "POST")
          .code(405)
          .send({ error: "METHOD_NOT_ALLOWED" });
      const server = createPlatformMcpServer({ baseUrl, token, principal });
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      try {
        await server.connect(transport);
        reply.hijack();
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } finally {
        await server.close();
      }
    },
  });
  return app;
}
