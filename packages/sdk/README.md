# @repo/sdk

A compiled TypeScript client with no runtime workspace imports. Build with
`bun run --cwd packages/sdk build`. Package exports point to `dist/index.js` and
`dist/index.d.ts`.

```ts
import { AgentPlatformClient } from "@repo/sdk";

const client = new AgentPlatformClient({
  baseUrl: "http://localhost:3001",
  token: "YOUR_SESSION_TOKEN_OR_API_KEY",
  organizationId: "YOUR_ORGANIZATION_ID",
});

const sandbox = await client.createSandbox({
  name: "workspace",
  memoryMb: 512,
  cpu: 1,
});
const session = await client.createSession("First agent session");
const run = await client.createRun(
  {
    sandboxId: sandbox.id,
    sessionId: session.id,
    task: "Inspect the workspace and explain its contents.",
    provider: "openai",
  },
  { idempotencyKey: crypto.randomUUID() },
);

for await (const event of client.events(run.id)) {
  console.log(event.sequence, event.type, event.payload);
}
```

Browser callers can omit `token` and use the HttpOnly cookie; credentials default
to `include`. API keys require matching scopes and organization policies still apply.
`withSignal(signal)` creates a cancellable client; per-request options also accept a
signal. Requests time out after 30 seconds unless configured otherwise.

Methods cover organizations, members, invitations, sandbox lifecycle, queued shell
execution, files, sessions, runs, browser actions, artifacts, providers, API keys,
policies, approvals, MCP discovery and event replay. The generic `request<T>()`
method supports additional routes described by `/openapi.json`.

Use `page<T>(path, { cursor, limit, status })` for collections; it understands both
cursor headers and session envelopes. `events()` reconnects with the last sequence,
deduplicates events and stops on a terminal run event. Abort its signal to stop
listening. `PlatformError` exposes HTTP `status`, stable `code` and safe `details`.
GET requests and requests with an idempotency key retry selected transient HTTP
statuses. Only run and queued-execution creation support idempotency keys; reuse
one only for an identical request.

File API transfers use base64 and are capped at 8 MB. Downloads return private R2
signed URLs valid for five minutes. Resume requires
`resumeRun(id, true)` to acknowledge possible already-executed external effects.
