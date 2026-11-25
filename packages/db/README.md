# @repo/db

Drizzle with the PostgreSQL `pg` driver in all environments. Import `db`, table definitions, and shared query helpers from `@repo/db`. Connection configuration comes from `@repo/env`; callers should close the exported `pool` on shutdown.

The source of truth is `schema/index.ts`. IDs are generated with `randomUUID()` in JavaScript, without requiring a database extension. New accounts and their organizations are created in one transaction.

There is deliberately no migration-generation script or automatic database hook. After reviewing changes, `bun run db:push` explicitly applies the schema to the configured database without generating migration files. `bun run db:studio` opens Drizzle Studio.

The schema now also defines memberships/invitations, provider credentials, API keys,
sessions/messages, agent events/checkpoints, shell executions, browser sessions,
artifacts, secrets, approvals, policies, quotas, usage, audit/activity and outbox rows.
New source schema changes have not been applied by the implementation process.
`db:initialize` is an explicit development-only data backfill for legacy accounts and
event order after manual schema application; installation and startup never call it.
