# Architecture

Zlayer uses Bun for package management and a Turborepo workspace with Fastify, Next.js, Drizzle/PostgreSQL,
BullMQ/Redis, Docker and private Cloudflare R2 storage. Shared imports use `@repo/*`.

API and worker scripts run on Node through `tsx` for Docker Desktop named-pipe compatibility.

## Boundaries

| Location                               | Responsibility                                               |
| -------------------------------------- | ------------------------------------------------------------ |
| `apps/http/src/index.ts`               | Connections, dependency wiring, listening and shutdown       |
| `apps/http/src/app.ts`                 | HTTP plugins, authentication boundaries and error handling   |
| `apps/http/src/lib/openapi.ts`         | Route contracts and generated OpenAPI document               |
| `apps/http/src/lib/request-tracing.ts` | Request and handler trace lifecycle                          |
| `apps/http/src/modules`                | Organization-scoped feature routes and services              |
| `apps/worker`                          | Outbox delivery, execution claims, leases and reconciliation |
| `apps/web/src/components`              | Pixel dashboard, settings and workspace controls             |
| `packages/agent-runtime`               | Provider adapters, model router, tool registry and MCP       |
| `packages/sandbox`                     | Docker lifecycle and bounded execution bridge                |
| `packages/sandbox/image`               | Non-root shell/filesystem/browser/MCP helper source          |
| `packages/storage`                     | Private R2 objects, checksums, metadata and signed downloads |
| `packages/db`                          | Drizzle schema, permissions, encryption, events and metering |
| `packages/sdk`                         | Compiled TypeScript client and resumable event streaming     |
| `packages/env`                         | Server environment loading and validation                    |
| `packages/observability`               | Structured logs and optional OTLP traces/metrics             |

## Execution flow

The API authorizes the organization and captures the caller's tool permissions.
Run creation, quota reservations, initial event, optional session message and an
outbox record share a PostgreSQL transaction. The outbox publisher submits a
stable BullMQ job ID and retries delivery. A worker claims only queued records,
sets a lease, and fences writes with lease owner and attempt number.

The runtime preserves provider tool-call IDs and native Anthropic content. Tools
validate JSON schemas and arguments, then apply organization policy, captured
permissions, exact command restrictions and one-use approvals before execution.
Checkpoints contain model messages and consumed budgets. Four model providers are
supported: Anthropic, OpenAI, DeepSeek and OpenRouter. Aliases, explicit fallback
order and OpenRouter routing are organization settings. Streaming text and model
usage are persisted as execution events.

Run completion, terminal event and assistant session message commit together.
Failure, expired-lease recovery and cancellation also commit status and event
together. Lease expiry marks uncertain work interrupted; it does not replay shell
or external side effects. Explicit resume acknowledges uncertainty and continues
from a checkpoint. Shell executions use a separate queue and lease.

## State and events

Sessions retain conversations and associated runs. Run events have monotonically
increasing per-run sequence numbers protected by a row lock. SSE accepts
`Last-Event-ID`; the SDK reconnects and suppresses duplicate sequences. Replay
reads persisted events without executing side effects. Checkpoints can be exported
to private R2 artifacts. Sandbox creation/destruction and artifact creation/deletion
have durable organization activity records committed with their final DB state.

Mutation audit records are written before a successful HTTP response and contain
actor, route and resource ID, never response bodies. They use a separate transaction
from the feature mutation; a process failure between the two can leave an audit
gap. R2 and Docker changes also cannot share a PostgreSQL transaction. Reconciliation
cleans abandoned resources, and callers must account for uncertain outcomes.

## Configuration and operations

See [environment setup](env/README.md), [HTTP contracts](apps/http/README.md),
[SDK usage](packages/sdk/README.md) and [security boundaries](SECURITY.md).
No install, startup, build or verification command applies schemas or generates
migrations. Application deployment, monitoring infrastructure and new integration
or failure testing are deferred by request.
