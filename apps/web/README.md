# Zlayer web workspace

Next.js App Router with Geist, the shared shadcn components in `@repo/ui`,
TanStack Query for server state and Zustand for shared interface state.

## Development

From the repository root, run `bun run dev` to start all workspace dependencies.
Alternatively build `@repo/ui` and `@repo/sdk` before starting only the web app.
All configuration lives in the repository-root `.env`. Next.js loads that file
in its server-side config, and browser code reads only `NEXT_PUBLIC_*` variables.
Other server applications use `@repo/env`. The default browser and API ports are
3000 and 3001. See [environment setup](../../ENVIRONMENT.md).

## Structure

```text
src/
  app/                 # Page entry, providers, Geist and theme tokens
  components/
    layout/            # sidebar-07 composition, navigation and workspace switcher
    shared/            # Forms, resource tables/cards, feedback and detail sheets
  features/
    auth/              # Sign-in and registration
    workspace/         # Authenticated shell and initial workspace selection
    overview/          # Workspace summary
    sandboxes/         # Sandbox lifecycle and file explorer
    runs/              # Agent creation, output and event timeline
    sessions/          # Persistent conversation history
    executions/        # Queued command forms and captured output
    browsers/          # Isolated browser controls
    artifacts/         # Upload, preview, download and deletion
    providers/         # Model credentials, routing and fallback selection
    keys/              # Scoped credentials and copy-once token dialogs
    settings/          # Team, invitations, policy, secrets and quotas
    governance/        # Approvals, usage, activity and audit
    mcp/               # Tool-server connections and discovery
  hooks/api/           # Module-based queries, mutations and event subscriptions
  lib/                 # Zod response contracts, formatting and public environment
  stores/              # Shared workspace/navigation/sidebar state
```

## UI conventions

Import primitives from `@repo/ui`: Button, Card, Input, Select, Checkbox, Alert,
Dialog, Sheet, Sidebar, Skeleton and Sonner. Layout and feature components compose
those primitives; do not create a second primitive library in the web app.
The sidebar adapts the official [shadcn sidebar-07 block](https://ui.shadcn.com/r/styles/new-york/sidebar-07.json)
to real workspaces and permissions, without its example navigation or billing links.

Use Geist throughout, including code output. Theme colors are cream `#F6F2E6`,
green `#94C573`, and occasional pink `#FFBAF1`. Darker green text maintains readable
contrast. Pixel borders and shadows follow the local 8-bit pixel-art skill and
wrap shared Card/Button components. Reduced-motion preferences are respected.

Success acknowledgements use `toast` exported alongside the shared Sonner Toaster
from `@repo/ui`. Persistent errors use Alert. Use shadcn confirmation dialogs and
copy-once credential dialogs, never browser alert/prompt/confirm functions.

Permissions and policy tools use checkboxes. Hosts, commands, secret references and
routing lists use add/remove controls instead of comma-separated fields. Forms
validate with Zod before calling mutations. API responses are parsed with Zod at
the hook boundary; dynamic payloads are decoded using safeParse.

## State and requests

TanStack Query owns fetched data, pagination, background refresh, mutations and
invalidation. Workspace query keys include the organization ID. Switching workspaces
unmounts feature content and prevents data from another tenant appearing as a
placeholder. Logout clears the query cache and shared store.

Zustand owns selected workspace, navigation section, desktop sidebar visibility and
shared mutation errors. Local form drafts and open dialogs stay local to their
components. Credentials are never persisted to browser storage.

Keep API calls in `hooks/api`, grouped by module. Pass query AbortSignals to SDK
requests. Side-effecting actions do not retry automatically; run/command creation
uses an idempotency key. SSE subscribes inside the run hook and updates its query
cache, with deduplication by sequence. Loading uses Skeleton; background refresh
keeps existing content visible. Mobile collections stack into cards and use the
shared Sidebar's drawer behavior.

## Verification

Use existing workspace type checks, lint, dependency checks and production build.
A temporary browser review with fixture responses checks desktop/mobile layout,
labelled fields, permission validation, submission and acknowledgement behavior.
It does not change database records or constitute live integration acceptance.
No new test suite or deployment configuration is introduced by the UI refresh.
