Server configuration lives here and is loaded only by `@repo/env`, relative to that package rather than the working directory. Development defaults match the root Docker Compose services.

Put secrets and machine overrides in `.env.development.local` (ignored by Git). Set `GOOGLE_CLIENT_ID` to your Google web OAuth client ID to enable Google sign-in. No client secret is needed for ID-token verification. Set `MODEL_API_KEY` to run agents. On Windows with Docker Desktop, set `DOCKER_SOCKET=//./pipe/docker_engine` if using its named pipe.

Production reads injected environment variables only. `DATABASE_URL` and `REDIS_URL` are required. Set `WEB_URL` to the exact browser origin and serve the API over HTTPS. This package must never be imported into browser code; public variables belong in `apps/web`.

No install, build, or development command generates migrations or changes the database. Review schema changes separately before explicitly using `bun run db:push`.
