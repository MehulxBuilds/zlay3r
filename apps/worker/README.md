# Worker

Run `bun run --cwd apps/worker dev` from the repository root. The worker loads server configuration through `@repo/env`, consumes `agent-runs` from Redis, and persists run state and events with Drizzle through `@repo/db`.

Jobs must match the persisted run's organization, sandbox, and task. The target sandbox must belong to that organization and be running. Completion or failure updates and their events are committed in a transaction. Shutdown closes the worker, Redis connection, and database pool.

The worker also consumes `shell-executions`, publishes transactional outbox rows,
refreshes 45-second leases, observes cancellation, and maintains Redis heartbeats.
Recovery marks expired work interrupted and requires explicit resume for uncertain
agent effects. It also restores missing queue deliveries for persisted queued work.
Maintenance reconciles managed Docker resources, sandbox expiry and stale R2 uploads.
Docker resources are isolated by `INSTANCE_ID`; API and workers must share it.

Provider configuration, policy budgets, captured tool permissions and selected
secret references come from the run's organization. Browser and MCP subprocesses
run inside the assigned sandbox. Metadata, usage, tool calls and checkpoints persist
in PostgreSQL. OTLP export is optional; deploying a collector is deferred.

The agent loop now runs in `packages/agent-runner` inside the sandbox image. The
worker supervises its private Docker exec channel and retains provider keys,
model calls, policy enforcement and persistence. Sandbox code receives neither
database/Redis credentials nor provider keys. Native and MCP tools use the host
registry after validation against model-issued tool calls. Only one agent run per
sandbox can be claimed at once; additional jobs are delayed without consuming a
run attempt. Clean approval suspension closes the runner while keeping the sandbox
alive. Cancellation, lost channels and deadlines can stop the whole sandbox.

Build the new image from the repository root with `bun run sandbox:build`, then
create a new sandbox. Old image containers report `SANDBOX_RUNNER_IMAGE_REQUIRED`.
No queue worker is launched by the isolated smoke script; see
[sandbox agents](../../docs/sandbox-agents.md) for verification and remaining limits.
