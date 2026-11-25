# HTTP API

`src/index.ts` owns startup and connections; `src/app.ts` builds the Fastify app without listening. Features live in `src/modules/auth`, `sandboxes`, and `runs`. Routes validate input, behavior lives in the feature services, and auth persistence lives in its repository.

Run from the repository root with `bun run --cwd apps/http dev`. Configuration always comes from `@repo/env`.

| Method | Endpoint | Body / purpose |
| --- | --- | --- |
| POST | `/v1/auth/register` | `{ "email": "you@example.com", "password": "at-least-12-characters", "name": "You" }` |
| POST | `/v1/auth/login` | `{ "email": "you@example.com", "password": "..." }` |
| POST | `/v1/auth/google` | `{ "credential": "<Google ID token>" }` |
| GET | `/v1/auth/me` | Current user |
| POST | `/v1/auth/logout` | Revoke the current session |
| GET | `/v1/sandboxes` | List your organization's sandboxes |
| POST | `/v1/sandboxes` | `{ "name": "sandbox", "memoryMb": 512, "cpu": 1 }` |
| POST | `/v1/sandboxes/:id/exec` | `{ "command": "ls" }` |
| DELETE | `/v1/sandboxes/:id` | Destroy a sandbox |
| POST | `/v1/runs` | `{ "sandboxId": "...", "task": "..." }` |
| GET | `/v1/runs/:id` | Run and ordered events |
| GET | `/health` | Liveness |
| GET | `/health/ready` | PostgreSQL and Redis readiness |

Sign-in responses contain `{ user, token, expiresAt }` and set an HttpOnly session cookie. Non-browser callers can use `Authorization: Bearer <token>`. Sessions expire after seven days and logout revokes them. Passwords are salted scrypt hashes; only SHA-256 hashes of random session tokens are stored.

Browser requests use `credentials: "include"`. Mutating cookie requests must carry the configured `WEB_URL` origin; CORS accepts only that origin. Production cookies require HTTPS and use SameSite=Lax, so deploy the frontend and API on the same site (for example `app.example.com` and `api.example.com`). Auth endpoints have a per-process, per-IP rate limit of ten attempts per minute; deployments behind a proxy need a deliberate trusted-proxy policy before enabling proxy-derived client IPs.

Google credentials are verified by Google's library against `GOOGLE_CLIENT_ID`. Google accounts are identified by `sub`. An existing password account is never silently linked by matching email. Google auth returns 503 until a client ID is configured. [Google token verification reference](https://developers.google.com/identity/sign-in/web/backend-auth).

The database schema must be provisioned before authentication works. Installation, builds, and startup never change it or generate migration files.
