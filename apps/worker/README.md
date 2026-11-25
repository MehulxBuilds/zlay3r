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
