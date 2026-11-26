# Security boundaries and current limits

Passwords use salted scrypt; opaque login sessions and scoped API keys are stored
as hashes. Google ID tokens are verified against the configured client ID. Email
matching does not silently link password accounts to Google accounts. Organization
membership controls owner/admin/developer/viewer permissions; API keys also require
an explicit scope. Revocation and rotation invalidate old API credentials.

Provider credentials, selected execution secrets and saved browser state use
AES-256-GCM with organization ID as associated data. Keep the 32-byte encryption
key stable and protected. There is no automatic key rotation or recovery service.
Selected shell/MCP secret values are redacted from returned output; transformed or
encoded secret values cannot be detected reliably. Only pass secrets to trusted
commands and MCP servers. Tokens, file contents and browser state may still be
sensitive even when authorization permits reading them.

Browser cookie mutations require the configured web origin. CORS accepts that
exact origin. Production requires HTTPS; frontend and API should share a site for
SameSite=Lax cookies. Redis backs production request rate limits. Proxy-derived IP
trust is intentionally not enabled automatically.

Docker containers run as UID 1000 with dropped capabilities, no-new-privileges,
read-only root filesystems, bounded tmpfs workspaces and CPU/memory/PID limits.
Shell output and duration are bounded. Cancellation or a helper timeout can stop
the entire sandbox to terminate detached descendants, interrupting other work in
that sandbox. Files use Linux directory-relative opens with symlink refusal;
read/write transfers are limited to 8 MB. Chromium relies on container isolation
and runs with its own Chromium sandbox disabled. The helper and user processes
share a UID; this is not a security boundary against a compromised container.

The agent loop executes inside that container using a credential-free bundle.
The worker retains provider keys, authorizes actual tool execution and brokers
model calls over a private Docker exec channel. Runner identity, counters and
checkpoints are not trusted as authorization or billing authority. The host binds
tool calls to model-issued IDs and arguments, checks run leases and budgets, and
validates checkpoint history. No provider key, database credential, Redis password
or reusable platform API key is injected for agent orchestration. Explicit secrets
passed to tool processes remain accessible within that sandbox. See
[sandbox agents](docs/sandbox-agents.md) for the implemented boundaries and limits.

Network access defaults to none. Allowed public hosts use an HTTP(S) proxy that
pins DNS results and rejects non-public IP ranges. An isolated internal Docker
bridge and disabled container DNS prevent direct external connections. Docker 28+
is required. HTTP MCP connections also pin public DNS destinations and require an
explicit host allowlist. New sandboxes select Kata by default and reject missing
runtimes. Kata provides a guest kernel boundary once installed and validated;
the egress proxy retains the daemon default runtime. Docker configuration, browser
escapes and DNS/egress behavior still require live integration review before
handling hostile workloads. See [Kata setup](docs/kata-runtime.md).

R2 objects are private. Tenant checks precede signed downloads, which expire after
five minutes. R2 credentials need object access only for the configured bucket.
Usage prices are configured estimates, not invoices. Unknown provider usage retains
reservations. Duration metering is sampled, and provider failures/retries may be
billable without a recoverable usage receipt. Quotas bound admission and tool/model
budgets; they do not promise exact external-provider spend limits.

A focused Docker creation/inspection/non-root command/cleanup check passed during
the Windows sandbox startup fix. Browser, R2 and provider integration and adversarial
testing remain unverified. Agent subprocess and focused Docker runner/tool,
approval/resume and cancellation checks are implemented. Deployment and broader
hostile-workload testing remain deferred.
