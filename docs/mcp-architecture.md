# MCP v2 integration

The platform keeps Bun, Fastify, Drizzle, the existing worker runtime and tool
registry. No migrations or database mutations are part of this change.

## Audited baseline

The original client in `packages/agent-runtime/src/mcp.ts` implemented JSON-RPC,
initialization and HTTP/SSE framing itself. `/v1/mcp` implemented a second manual
protocol dispatcher inside the HTTP application. Worker connections already had
run-scoped cleanup, organization-scoped configuration and encrypted secret
references. The registry already enforced schemas, permissions and policy.

## Target boundaries

- `packages/mcp-client`: official v2 client, guarded Streamable HTTP networking,
  sandbox transport adapter, discovery and bounded results. No agent runtime dependency.
- `packages/agent-runtime`: adapts discovered tools into the existing registry.
- `packages/mcp-server`: shared official v2 server and platform API tool catalog.
- `apps/remote-mcp`: authenticated Streamable HTTP entry point at `/mcp`.
- `packages/local-mcp`: stdio entry point using the same tool catalog and API credentials.

External-facing servers call the existing authenticated platform REST API. This
reuses its services, tenant checks, execution policies, quotas and audit hooks;
neither entry point accesses Docker or implements agent execution. Internal agents
continue to call the registry directly. Only external tools use the MCP client.

## SDK and compatibility

Use the published v2 packages, not `@modelcontextprotocol/sdk` v1. npm verified
client/server `2.4.0` and Node adapter `2.1.2`. The SDK owns protocol negotiation,
initialization, JSON-RPC validation, cancellation and HTTP session framing. Inspect
installed declarations before using APIs. Node 20 or newer is required.

Reference: [official SDK](https://github.com/modelcontextprotocol/typescript-sdk).
The [maxxer reference](https://github.com/MehulxBuilds/maxxer/) informs the separate
remote/local layout; its v1 imports and token-in-path pattern are not adopted.

## Connection ownership and security

Worker connections remain bounded by an agent run and are reused across its tool
calls, then closed in the existing cleanup path. They are reconstructed from
organization-owned configuration after restart. Discovery requests use disposable
connections. Do not reconnect or replay mutating calls automatically after an
uncertain failure. Preserve HTTPS host allowlists, public-address DNS checks and
redirect rejection when switching transports. Stdio processes stay in the existing
authorized sandbox, never on the API/worker host. The sandbox bridge only carries
SDK messages; protocol initialization belongs to the SDK.

Remote requests require a platform bearer API key and resolve current scopes and
revocation through the platform API on every request. Tenant identity is derived
from that key, never tool arguments. Local stdio uses a configured platform API key.
No credentials belong in URLs, tool definitions, outputs or logs. OAuth server and
external OAuth onboarding require separate implementation; API keys do not imply
OAuth support. Remote transport is stateless, avoiding tenant-shared session maps.

Tool discovery is permission-filtered. Execution still passes through platform
authorization. External descriptions and results are untrusted model data; preserve
structured content and error flags, redact configured secrets and bound output.
Keep provider-safe registry aliases separate from remote tool names.

## Persistence and remaining scope

Reuse `mcpServer` and encrypted organization secrets for the SDK replacement.
Dedicated credential, discovery, execution and operational connection tables,
per-tool enablement, OAuth onboarding and health dashboards are follow-on work;
do not claim them complete or generate migrations. Schema application remains an
explicit operator action. Verify with in-memory SDK integration tests, existing
authentication tests, types, lint and dependency consistency without touching a DB.
