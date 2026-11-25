# Worker

Run `bun run --cwd apps/worker dev` from the repository root. The worker loads server configuration through `@repo/env`, consumes `agent-runs` from Redis, and persists run state and events with Drizzle through `@repo/db`.

Jobs must match the persisted run's organization, sandbox, and task. The target sandbox must belong to that organization and be running. Completion or failure updates and their events are committed in a transaction. Shutdown closes the worker, Redis connection, and database pool.
