# Agents inside sandboxes

The agent loop runs as UID 1000 in the assigned Docker sandbox. The worker starts
`/opt/zlayer/agent-runner.mjs` through Docker exec, with a private stdin/stdout
supervision channel. No agent control port, API key or inbound network route is
required. A network-disabled sandbox can still use the model broker.

```text
API / queue → worker supervisor ↔ private exec channel ↔ sandbox agent loop
                    │                                  (messages / tool selection)
                    ├─ provider adapters → model provider
                    ├─ authorized registry → sandbox shell / files / browser
                    ├─ authorized MCP client → external MCP server
                    └─ checkpoints / events / metering → database
```

## Code and credentials

`@repo/agent-runtime/core` contains the portable runtime and registry. The existing
host entry point preserves its convenience provider configuration. The image
bundles only the portable runner: it does not load `@repo/env`, PostgreSQL, Redis,
HTTP application code or provider credentials. Docker build context excludes local
environment files and dependency/build directories. Provider adapters and keys stay
in the worker. Explicit secrets passed to shell or MCP tools remain accessible to
those sandbox processes, as before.

The runner uses registry adapters for native and MCP tools. Execution goes through
the host registry, where arguments, captured permissions, organization policy and
approvals are checked again. Tenant and resource identity come from the claimed
run, not channel parameters. This broker approach allows the runner to execute
inside the sandbox without treating it as trusted control-plane code.

## Supervision and durable state

Each run has one Docker exec channel with bounded frames, outstanding requests,
request count and total traffic. Unexpected output, disconnection or timeout fails
the run and stops the container when a runner might remain alive. Clean runtime
errors, including approval suspension, close the process without stopping the
sandbox. The provider verifies runner termination before releasing its local slot.
The worker additionally serializes sandbox claims using a transaction advisory
lock and delays competing BullMQ jobs while another run is active.

The supervisor selects the provider/model, sends only the permitted tool catalog,
enforces token/tool/iteration budgets, and checks the lease before each request.
Tool calls must match a model-issued call ID, name and arguments. Results, model
usage and tool audit events are captured on the host. Returned runner counters
cannot change billing. Checkpoints are checked against host-owned conversation
state; local validation failures can only acknowledge issued calls. Counters are
saved before tool dispatch and model results before returning them to the runner.
Approval resume restores the pending call and consumed budgets.

Cancellation and deadline expiry abort model access and stop the isolation
boundary, including detached children. This can interrupt other shell/browser work
in the same sandbox. A stopped container must be restarted explicitly before
another run; tmpfs workspace data is ephemeral. Failed/uncertain side effects still
require the existing explicit resume acknowledgement; this is not exactly-once
execution.

## Build and verify

From the repository root:

```sh
bun run sandbox:build
bun test apps/worker/src/agent-supervisor.test.ts
```

The unit/integration test needs the runner bundle: `bun run --cwd
packages/agent-runner build` first, or use `bun run test`, which builds it.
The image build uses Bun 1.3.5 in a separate build stage and Node 22 at runtime.
It applies no database schema or data changes. Existing containers retain their
old image; create a new sandbox after rebuilding. The runner rejects older images
with `SANDBOX_RUNNER_IMAGE_REQUIRED`.

For an explicit Docker smoke check, build the separate test image and run:

```sh
docker build -f packages/sandbox/image/Dockerfile -t zlayer-sandbox:agent-runner .
bun run sandbox:smoke-agent
```

The script creates and removes its own non-root, network-disabled sandbox. It uses
a mock model, verifies the runner process is inside the container, executes a real
shell/file operation, checks approval/resume, cancels a runner and verifies the
container stopped. It neither starts queue workers nor accesses the database or a
real model provider. On Windows it uses Node/tsx because Bun's named-pipe HTTP
transport cannot reliably connect to Docker Desktop.

## Remaining limits

The runner and task processes share the container's UID and kernel. The channel is
therefore treated as untrusted, not as protection from other processes in that
sandbox. Docker isolation is not a microVM boundary. Persistent workspace volumes,
filesystem snapshots, user-defined images, microVM backends, live migrations and a
hostile-workload security certification are not implemented by this change.
Live provider integration, database/queue fencing and recovery under process or
host failure still require external acceptance. No production deployment is
performed by these build and smoke commands.
