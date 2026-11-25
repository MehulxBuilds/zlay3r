# Workspace conventions

- Consistently indent all code with two spaces and format edited files with Prettier.
- Use Drizzle through `@repo/db` for all database access.
- Never generate migrations. Do not run database-changing commands as part of install, build, development startup, or verification. Apply schema changes only when explicitly requested.
- Read server environment variables through `@repo/env`. Keep public browser variables local to `apps/web`; never import the server env package into client code.
- Development server defaults live in `env/.env.development`; secrets and machine overrides belong in ignored `env/.env.development.local`.
- Use `@repo/*` names for workspace packages and imports. HTTP features belong under `apps/http/src/modules`, with route validation separate from behavior and persistence.
- Preserve one resolved version of each dependency across the workspace. Use exact package versions, root overrides when compatible, and commit `bun.lock`. Run `bun run check-dependencies` after dependency changes; do not force incompatible major versions together.
- Validate changes with relevant tests, `bun run check-types`, and `bun run lint`. Authentication contract tests use an in-memory repository and do not alter any database.
