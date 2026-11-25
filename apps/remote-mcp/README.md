# Remote MCP

Run the platform HTTP API first, then `bun run --cwd apps/remote-mcp start`.
The Streamable HTTP endpoint is `http://localhost:3002/mcp`. Configure `MCP_PORT`
and `MCP_API_BASE` through `@repo/env`; all configuration lives in the root
`.env`. Use HTTPS at the public reverse proxy.

Create a platform API key with `mcp.execute` plus the scopes for the desired
operations. Configure your MCP client with that key in the Authorization header:

```json
{
  "mcpServers": {
    "zlayer": {
      "url": "http://localhost:3002/mcp",
      "headers": { "Authorization": "Bearer <platform-api-key>" }
    }
  }
}
```

The server uses official SDK v2 and stateless JSON responses. POST is supported;
GET and DELETE return 405 after authentication. Every request validates the key's
revocation/expiration and scopes through `/v1/mcp/principal`. Tool listing is scope
filtered; calls go through the same platform API used by the dashboard and SDK.
OAuth authorization is not implemented. The former `/v1/mcp` endpoint is removed.

The API and its existing dependencies must be available. No database schema
application, migration, helper image build or deployment occurs at startup.
See [architecture](../../docs/mcp-architecture.md).
