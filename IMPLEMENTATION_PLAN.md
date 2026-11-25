# Platform implementation

The accepted scope preserves Bun, Drizzle, Fastify, Next.js, BullMQ and Docker.
No migrations are generated and no database-changing command runs automatically.
Application deployment and new test development are explicitly deferred by request.

## Status

?Implemented? below means source behavior is wired through the platform and passes
static checks. It does not claim live integration acceptance or production readiness.

| Phase                      | Source status | Delivered behavior                                                                                                        |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0 Audit and contracts      | Implemented   | Audited original runtime, auth, queue and isolation defects; separated HTTP contracts/tracing; updated docs               |
| 1 Data and organizations   | Implemented   | Drizzle memberships/invitations, roles, API key lifecycle, encrypted provider settings and secrets                        |
| 2 Execution                | Implemented   | Docker lifecycle/inspection/stats, non-root helper, bounded shell output/timeouts, cancellation and resource cleanup      |
| 3 Files and R2             | Implemented   | Symlink-refusing workspace files, private R2 artifacts, checksums, signed downloads and cleanup                           |
| 4 Providers                | Implemented   | Anthropic/OpenAI/DeepSeek/OpenRouter streaming and tools, aliases, routing, timeouts, retries and explicit fallback       |
| 5 Runtime and tools        | Implemented   | Tool IDs/native messages, schema validation, permission/policy checks, approvals, consumed budgets and HTTP/stdio MCP     |
| 6 Persistence and browser  | Implemented   | Sessions/messages, ordered run events, checkpoints, SSE reconnect/replay, Playwright controls and encrypted browser state |
| 7 Reliability              | Implemented   | Transactional outbox, fenced claims/leases, heartbeats, atomic terminal run events, cancellation and explicit recovery    |
| 8 Governance and telemetry | Implemented   | Policies, one-use approvals, audit/activity records, usage reservations, quotas, price estimates and optional OTLP        |
| 9 API, SDK and UI          | Implemented   | Generated OpenAPI, compiled typed SDK, pixel dashboard, settings, file/browser controls and developer docs                |

## Latest fixes

- Fixed Fastify startup failure: Zod defaults inside union branches were rejected
  by AJV strict validation. Zod now applies defaults after transport validation.
- Verified HTTP listens on port 3001; signed-out `/v1/auth/me` returns 401 with
  the configured CORS headers instead of a failed browser connection.
- Split the large `onRoute` implementation into route-contract/OpenAPI helpers
  and request tracing; removed unused header conversion and fixed indentation.
- Preserved consumed iteration budgets through checkpoints and avoided emitting
  a synthetic provider usage receipt when resuming pending tools.
- Distinguished lease loss from cancellation; committed failure/recovery status
  changes with their terminal events.
- Fixed duplicate proxy cleanup, serialized helper daemon startup and connected
  agent-created browser sessions to persistent metadata and cancellation.
- Added organization activity for sandbox/artifact lifecycle, mutation audits
  before successful responses, and SDK/UI controls for browser and file operations.

## Verification

- Locked installation: `bun install --frozen-lockfile` passed.
- Dependency consistency: 513 packages, one resolved version each.
- Type checks: 15 tasks passed.
- Existing authentication tests: 6 passed, 38 assertions.
- Biome lint at error level: passed across 136 files.
- Production build: 7 tasks passed, including Next.js, SDK, HTTP and worker.
- Node helper syntax and Python helper AST syntax: passed.
- Git whitespace validation: passed.

No new test suite, database mutation, schema push or migration generation was performed.
During the sandbox failure fix, the helper image was built and a temporary sandbox
was successfully created, inspected, executed as UID 1000 and removed. R2/provider/
browser integration remains unverified. Worker source was compiled; a live worker
was not started against existing queues by this implementation.

## External acceptance still required

1. Explicitly review and apply the source Drizzle schema, including new tables and
   enums. Existing development accounts need the documented explicit membership/
   policy backfill after schema application. Neither command was run here.
2. Supply PostgreSQL/Redis, Docker 28+ and the helper image, a stable encryption key,
   private R2 bucket/credentials, and organization model credentials. API/worker
   must share `INSTANCE_ID` and server configuration.
3. Perform the deferred provider, sandbox, browser, R2, queue recovery, tenancy and
   end-to-end integration checks. Configure Google authorized JavaScript origins
   and matching client IDs to verify popup sign-in.
4. Perform the deferred deployment, load/failure campaigns and security review.

## Known limitations

- Docker and R2 side effects cannot be atomic with PostgreSQL. Reconciliation and
  explicit uncertain-effect resume handle recoverable cases, not exactly-once effects.
- HTTP mutation audits commit before success responses but separately from feature
  mutations; a process crash can leave an audit gap.
- Containers share a kernel; helper and user processes share a UID. Chromium relies
  on container isolation. Cancellation/timeouts may stop other work in a sandbox.
- Provider usage may be unavailable after failure. Unknown usage retains quota
  reservations; prices are configured estimates and duration is sampled.
- Files and artifacts use bounded base64 JSON transfers (8 MB), not streaming uploads.
- Secret redaction matches selected literal values, not arbitrary transformations.
- No automatic encryption-key rotation, billing collection, CLI, webhooks,
  Kubernetes, deployment or monitoring-stack provisioning was added.

See [architecture](ARCHITECTURE.md), [security boundaries](SECURITY.md),
[environment configuration](env/README.md), [HTTP docs](apps/http/README.md), and
[SDK docs](packages/sdk/README.md) for the implemented contracts and constraints.

## Windows sandbox startup fix

The sandbox failure was caused by a Linux socket default on Windows, Bun 1.3.5's
HTTP named-pipe transport, and a missing local helper image. Server env now normalizes
Windows Docker pipe paths. API and worker scripts use Node through `tsx`, while Bun
remains the package manager/test runner. Docker 29.1.3 and the built helper image
successfully created and executed a temporary sandbox, which was removed afterward.
Creation preflight now reports Docker availability, engine version and missing-image
errors as actionable 503 responses in the dashboard.

## UI refresh

Replaced the original dashboard with focused feature directories and module-based
TanStack Query hooks. Shared workspace/navigation state uses Zustand. Components
compose the shadcn primitives in `@repo/ui`, including the sidebar-07 composition,
Alert, Skeleton, Dialog, Sheet, Checkbox and Sonner. Geist is used throughout.
The palette is cream `#F6F2E6`, green `#94C573` and occasional pink `#FFBAF1`, with
pixel borders/shadows and readable darker green text.

Comma-separated controls were replaced with checkbox and add/remove inputs.
Client request forms and API responses use Zod contracts. Mobile resource lists
stack into cards; background refetches retain existing content. Browser review uses
temporary fixture responses and does not mutate the database or add a test suite.
See `apps/web/README.md` for the new source layout and conventions.

UI verification: desktop and 393px mobile views render without page errors or horizontal overflow. Permission selection blocks empty submissions and sends only selected scopes. Sonner acknowledgements and copy-once credential dialogs work with fixture responses. Production build, types, lint and dependency checks are recorded separately from live backend acceptance.
