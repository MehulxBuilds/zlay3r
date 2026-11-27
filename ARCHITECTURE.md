# Architecture

Zlayer uses Bun for package management and a Turborepo workspace with Fastify, Next.js, Drizzle/PostgreSQL,
BullMQ/Redis, Docker and private Cloudflare R2 storage. Shared imports use `@repo/*`.

API and worker scripts run on Node through `tsx`. In the configured Windows
development setup, they run inside Ubuntu WSL against its native Docker Engine;
the web application runs on Windows. Docker selects the registered Kata runtime
for sandbox containers. Kata gives those workloads a guest Linux kernel while
Docker remains responsible for images, lifecycle and exec operations. A second
Firecracker provider uses a privileged local host manager and a guest vsock
supervisor. Each sandbox persists its selected type; both providers coexist.

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
| `packages/agent-runner`                | Credential-free agent loop executed inside the sandbox       |
| `packages/sandbox`                     | Provider routing, Docker/Kata and Firecracker lifecycle      |
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

The worker starts the agent runner inside the assigned sandbox through a private
Docker exec or Firecracker vsock channel. It holds provider credentials and brokers model/tool access;
the agent loop, message assembly and tool selection run in the sandbox. Per-sandbox
claims serialize agent runs across workers. Checkpoints and usage counters are
validated and persisted by the supervisor, never accepted as billing authority
from the runner. See [sandbox agents](docs/sandbox-agents.md).

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

## Sandbox image and execution protocols

The sandbox image and the host runtime are separate layers. The
[Dockerfile](packages/sandbox/image/Dockerfile) defines sandbox userspace; the
Docker host's `kata` registration determines its kernel isolation. Zlayer uses
Docker's API through `DockerSandboxProvider`, not a separate containerd endpoint.

```mermaid
flowchart LR
  API["API: tenant authorization"] --> Provider["DockerSandboxProvider"]
  Worker["Worker: model broker and tool policy"] --> Provider
  Provider --> Docker["Linux Docker Engine"]
  Docker --> Kata["Registered Kata runtime / KVM"]
  subgraph Guest["Kata guest kernel and sandbox container"]
    Runner["Node agent-runner.mjs"]
    Files["Python filesystem.py"]
    Helper["Node helper.mjs"]
    Service["Local browser / MCP service"]
    Workspace["Bounded /workspace and /tmp tmpfs"]
    Runner --> Workspace
    Files --> Workspace
    Helper --> Workspace
    Helper --> Service
  end
  Kata --> Guest
  Worker <-->|"Private bidirectional agentChannel"| Runner
  Provider -->|"Docker exec: one request on stdin"| Files
  Provider -->|"Docker exec: one request on stdin"| Helper
```

The agent's workspace operations are requested through worker-authorized tools;
the runner does not receive provider keys or host control-plane credentials.

### Image construction

| Build stage or instruction                | Result                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `oven/bun:1.3.5` builder                  | Installs locked workspace dependencies with scripts disabled and bundles `@repo/agent-runner`        |
| `node:22-bookworm-slim` runtime           | Provides Node and Linux userspace; installs Python, `tini`, pinned browser/MCP packages and Chromium |
| `COPY` helpers and builder output         | Installs `helper.mjs`, `filesystem.py` and `agent-runner.mjs` under `/opt/zlayer`                    |
| `USER 1000:1000` and `WORKDIR /workspace` | Executes workloads without root privileges in their workspace                                        |
| `tini -- sleep infinity`                  | Keeps the sandbox available, forwards signals and reaps exited child processes                       |

The build context excludes `.env`, dependency directories and generated build
output. Runtime environment defaults locate Chromium under `/opt/zlayer/browsers`,
set `/workspace` as home and `/tmp` as temporary storage. The image's labels
describe agent availability and the JSON-line filesystem protocol. Kata itself is
installed on the host, not bundled into this image.

Docker creation adds a read-only root filesystem, dropped capabilities,
`no-new-privileges`, bounded tmpfs mounts, and CPU/memory/PID limits. The API and
creation form require at least 512 MB for Kata. Workspaces are ephemeral; durable
exports go to private artifact storage.

### Agent channel versus helper requests

| Executable launched with Docker exec  | Communication and responsibility                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `node /opt/zlayer/agent-runner.mjs`   | Persistent bidirectional `agentChannel` for model requests, authorized tool calls, checkpoints and the final result                        |
| `python3 /opt/zlayer/filesystem.py`   | One bounded JSON-line request on stdin; one `{ result }` or `{ error }` response on stdout; then exit                                      |
| `node /opt/zlayer/helper.mjs --stdin` | One JSON-line shell or service request; returns a JSON response; service requests can start or contact the sandbox's local service process |

`invoke()` defaults to the Node helper command. `file()` explicitly passes the
Python command to the same Docker exec transport. There is no operation-based
compatibility router or inline Python adapter. Requests stay on stdin instead of
being interpolated into command arguments or host shell commands.

The Python helper enforces workspace boundaries, refuses symlink traversal and
limits file transfers. File operations avoid Node/MCP startup entirely. The Node
service imports the MCP stdio transport only for an MCP session, and imports
Playwright only when creating a browser. The shared agent channel and one-shot
helper requests have distinct framing and lifetimes.

Protocol changes require rebuilding the image and creating fresh sandboxes. A
new tag does not update existing containers, and the provider assumes the rebuilt
image is used rather than adapting requests for older helpers.

## Firecracker provider boundary

`SandboxRouter` creates the selected `KATA` or `FIRECRACKER` type. Existing Docker
IDs route to `DockerSandboxProvider`; `firecracker:<uuid>` IDs route to
`FirecrackerSandboxProvider`. This identity survives API/worker restarts. The
creation service stores the type, provider and image label alongside that ID.

The Firecracker provider talks to a permission-restricted Unix socket. The Linux
host manager owns jailer, cgroup v2 limits, immutable rootfs/kernel links, private
workspace disks, lifecycle and cleanup. API and worker processes remain
unprivileged. The guest supervisor accepts only fixed process types from the
host and starts all application workloads as UID/GID 1000. Existing agent and
helper protocols run over the established vsock connection.

Firecracker guests have no NIC. A guest loopback proxy forwards through vsock to
a per-VM host proxy, which enforces the same public-host HTTP/HTTPS allowlist.
Empty policies create no egress listener. No TAP, NAT or firewall changes are
required. Stop/start retains the ext4 workspace; destroy removes it. On host
manager restart, surviving VM cgroups are stopped before serving requests.
Graceful stop confirms a bounded guest sync before terminating the cgroup;
cancellation and timeout/output-limit containment terminate immediately. File
mutations sync their data and parent directories, and the workspace drive honors
flush requests with writeback caching. The per-VM host egress proxy shares the
VM's CPU/memory cgroup. Guest helpers remain unprivileged; the small supervisor
and host manager are trusted infrastructure.

See [Firecracker runtime](docs/firecracker-runtime.md) for artifact builds,
security boundaries, operational requirements and opt-in integration tests.

## Windows and Ubuntu Docker topology

This workstation has two independent Docker daemons and image stores:

```mermaid
flowchart TB
  subgraph Windows["Windows"]
    Web["Web app :3000"]
    Desktop["Docker Desktop daemon and image store"]
    Data["Existing PostgreSQL :5433 / Redis :6379"]
    Desktop --> Data
  end
  subgraph Ubuntu["Ubuntu WSL"]
    Backend["Node API :3001 and worker"]
    Native["Native Docker daemon /run/zlayer-docker.sock"]
    Sandboxes["Kata-backed sandbox containers"]
    Manager["Firecracker host manager /run/zlayer-firecracker/manager.sock"]
    MicroVMs["Firecracker VMs: jailer, vsock, ext4 workspace"]
    Backend --> Native --> Sandboxes
    Backend --> Manager --> MicroVMs
  end
  Web -->|"REST / SSE"| Backend
  Backend -->|"Configured database and Redis endpoints"| Data
```

`bun run dev:backend:wsl` starts API and worker inside Ubuntu using Linux Node and
the installed Linux esbuild executable for `tsx`. Both read the same root `.env`
and use the native Unix Docker socket. The web app can run separately on Windows.
The launcher does not start the Firecracker host service, optional remote MCP
server, PostgreSQL or Redis, and does not initialize databases. The host manager
runs separately as `zlayer-firecracker.service`. Its socket permissions use the
trusted API/worker Linux group configured by `FIRECRACKER_SOCKET_GID`.

The startup banner reports spawned processes, not API/worker readiness. Cold
module loading through Windows-backed `/mnt/c` can delay `tsx --watch`; this is
separate from guest boot or helper execution. A Linux checkout with Linux
dependencies avoids that filesystem boundary. `/health/ready` checks database
and Redis availability; `/v1/workers/health` reports active worker heartbeats.

`bun run sandbox:build:wsl` builds into Ubuntu's native Docker image store. The workstation uses the `zlayer-kata` CLI
context and `/run/zlayer-docker.sock`, avoiding Docker Desktop's default-socket
replacement.
`bun run sandbox:build` uses the current Docker CLI context; from Windows that is
normally Docker Desktop. Images can be moved using `docker save` and `docker load`,
but the stores do not synchronize automatically. A Docker CLI context does not
change the explicit socket used by `dockerode` in Zlayer.

All application configuration remains in the ignored root `.env`, with only the
root `.env.example` template committed. Injected variables take precedence. The
browser reads only explicitly public `NEXT_PUBLIC_*` values. See
[Kata setup](docs/kata-runtime.md) for commands and host prerequisites. Production
uses Linux hosts with KVM and the selected runtime services; it does not require WSL.

## Sandbox API and response contract

`POST /v1/sandboxes` accepts `type: "KATA" | "FIRECRACKER"`, defaulting to
`KATA`. Creation validation is shared by route schema generation and handler
parsing. Memory is an integer from 512 to 2048 MB; CPU is 0.25?2 for Kata and
1 or 2 whole vCPUs for Firecracker. The selected type is stored alongside the
provider, resource ID and image label. Existing nullable type values are treated
as Kata by the web response schema.

Fastify serializes responses through the explicit allowlist in
`apps/http/src/lib/response-schema.ts`. Fields must be declared there to reach
clients: returning a Drizzle row alone does not expose every property. Sandbox
list, create, detail and lifecycle responses include the `type` enum. The web
app validates these responses with `sandboxSchema` before accepting them into
query state. An omitted type can therefore reject a successful creation response
while the underlying sandbox is already running.

The response regression test sends both provider types and a nullable legacy
value through actual Fastify serialization, then parses the list and creation
responses with the web schema. Response-only changes require an API reload and
page refresh, not rebuilding guest images or recreating sandboxes.

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

See [environment setup](ENVIRONMENT.md), [HTTP contracts](apps/http/README.md),
[SDK usage](packages/sdk/README.md) and [security boundaries](SECURITY.md).
No install, startup, build or verification command applies schemas or generates
migrations. Contract tests cover HTTP authentication, MCP, agent supervision and
the sandbox transport. Opt-in `sandbox:smoke-image` verifies files, path
restrictions, shell, MCP stdio and Chromium on a temporary sandbox;
`sandbox:smoke-agent` verifies the private broker, approvals/resume, cancellation
and cleanup. These checks do not use the application database or live model keys.
Live provider, database/queue recovery and adversarial integration acceptance
remain separate from these checks. Application deployment and monitoring
infrastructure are deferred.
