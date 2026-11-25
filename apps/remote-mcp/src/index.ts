import { server_env as env } from "@repo/env";
import { buildRemoteMcpApp } from "./app";
const app = buildRemoteMcpApp(env.MCP_API_BASE, new URL(env.WEB_URL).origin);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: env.HOST, port: env.MCP_PORT });
