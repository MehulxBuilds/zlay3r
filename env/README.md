# Server environment

Only server code imports `@repo/env`. Public browser configuration stays in
`apps/web/src/lib/env.ts` and `apps/web/.env.local`.

Development defaults are loaded from `env/.env.development`; put secrets and
machine overrides in ignored `env/.env.development.local`. Both paths are resolved
relative to the env package, so startup works from any workspace. Already injected
process variables take precedence, including variables Bun loads from a root `.env`.
Production reads injected environment variables only.

| Variable                                        | Purpose                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`, `REDIS_URL`                     | Required PostgreSQL and Redis connections                             |
| `HOST`, `PORT`                                  | API bind address; defaults to `0.0.0.0:3001`                          |
| `WEB_URL`                                       | Exact browser origin; default `http://localhost:3000`                 |
| `GOOGLE_CLIENT_ID`                              | Google web OAuth client ID; empty disables Google login               |
| `ENCRYPTION_KEY`                                | Base64-encoded 32 random bytes; provider/secret/browser encryption    |
| `DOCKER_SOCKET`                                 | Docker endpoint; Windows Desktop defaults to `//./pipe/docker_engine` |
| `SANDBOX_IMAGE`                                 | Locally available helper image, default `zlayer-sandbox:local`        |
| `INSTANCE_ID`                                   | Shared API/worker resource namespace, default `local`                 |
| `SANDBOX_SECCOMP`                               | Optional Docker seccomp profile                                       |
| `WORKER_CONCURRENCY`                            | Concurrent agent jobs per worker; default 3, range 1?32               |
| `R2_ACCOUNT_ID`, `R2_BUCKET`                    | Cloudflare account and private bucket                                 |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`      | Scoped R2 S3 credentials                                              |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                   | Optional HTTP OTLP base endpoint                                      |
| `LOG_LEVEL`                                     | Pino log level, default `info`                                        |
| `MODEL_API_KEY`, `MODEL_NAME`, `MODEL_BASE_URL` | Optional development OpenAI fallback                                  |

Use the same `INSTANCE_ID`, database, Redis, image and encryption key across API and
worker processes. Organization provider configuration is preferred over the
OpenAI development fallback. There is no local artifact storage fallback: artifact
operations require R2. No credentials are created or external services provisioned
by startup.

Google uses the popup ID-token flow. Add `http://localhost:3000` to the OAuth client's
authorized JavaScript origins and set the same client ID in
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`. **No redirect URI is used by this implementation.**

To generate an encryption key locally, run
`bun -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`
and place the result only in the ignored local environment file. Never commit it.

The source Drizzle schema must be explicitly reviewed and applied separately before
using the new features. No migrations are generated, and no schema-changing command
runs during install, development startup, build or verification. Existing development
accounts can be backfilled with the explicit `db:initialize` command after schema
application; that command changes data and is never run automatically.

## Docker Desktop on Windows

API and worker startup use Node through `tsx`; Bun remains the package manager.
Bun 1.3.5 HTTP requests cannot open Docker Desktop named pipes reliably, even when
its TCP/socket API can connect. Start these services through their package scripts,
not `bun src/index.ts` directly. Node.js 22 or newer is recommended.

On Windows, the Linux default `/var/run/docker.sock` is translated to
`//./pipe/docker_engine`. Explicit named-pipe paths and Docker `npipe://` endpoints
are supported. On Linux the Unix socket default is unchanged.

The helper image must exist before sandbox creation. From the repository root:

```sh
docker build -f packages/sandbox/image/Dockerfile -t zlayer-sandbox:local .
```

This is the sandbox execution image, not application deployment. Rebuild it after
changing the helper or agent-runner sources. Build from the repository root: a
multi-stage build bundles the agent runtime without server credentials or config.
Match the tag to `SANDBOX_IMAGE` if customized. Existing containers retain their old
image; create a new sandbox to use the runner. Docker
connection, unsupported engine and missing-image errors return actionable HTTP 503
responses instead of a generic internal error.
