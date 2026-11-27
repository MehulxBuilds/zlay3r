export interface ClientOptions {
  baseUrl: string;
  token?: string;
  organizationId?: string;
  timeoutMs?: number;
  retries?: number;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
}
export interface RequestOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
  onHeaders?: (headers: Headers) => void;
}
export interface Resource {
  id: string;
  [key: string]: unknown;
}
export interface User extends Resource {
  name: string;
  email: string;
  organizationId: string;
}
export interface AuthSession {
  user: User;
  token: string;
  expiresAt: string;
}
export interface Session extends Resource {
  title: string;
  createdAt: string;
  messages?: {
    id: string;
    role: string;
    content: unknown;
    createdAt: string;
  }[];
  runs?: Run[];
}
export interface Execution extends Resource {
  sandboxId: string;
  command: string;
  status: string;
  createdAt: string;
  result: {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
  } | null;
}
export interface Artifact extends Resource {
  filename: string;
  mimeType: string;
  size: number;
  status: string;
  createdAt?: string;
}
export interface BrowserSession extends Resource {
  sandboxId: string;
  status: string;
  createdAt: string;
}
export interface Organization extends Resource {
  name: string;
  role: string;
}
export interface ProviderConfiguration extends Resource {
  provider: "openai" | "anthropic" | "deepseek" | "openrouter";
  model: string;
  configured: boolean;
  settings: Record<string, unknown>;
}
export interface ApiKey extends Resource {
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
}
export interface Approval extends Resource {
  status: string;
  action: Record<string, unknown>;
  runId: string | null;
  expiresAt: string;
}
export interface Membership extends Resource {
  userId: string;
  name: string;
  email: string;
  role: string;
}
export interface Policy {
  allowedTools: string[];
  allowedCommands: string[];
  requireApproval: string[];
  approvedHosts: string[];
  maxTokens: number;
  maxToolCalls: number;
  deadlineMs: number;
}
export type McpConfiguration =
  | { transport: "http"; url: string; authorizationSecret?: string }
  | {
      transport: "stdio";
      sandboxId: string;
      command: string;
      args?: string[];
      secretNames?: string[];
    };
export interface Sandbox {
  type: "KATA" | "FIRECRACKER";
  id: string;
  name: string;
  status: string;
  memoryMb: number;
  cpu: number;
}
export interface Run {
  id: string;
  sandboxId: string;
  task: string;
  status: string;
  result?: { finalAnswer?: string } | null;
  events?: ExecutionEvent[];
}
export interface ExecutionEvent {
  id: string;
  sequence: number;
  type: string;
  payload: unknown;
  createdAt: string;
}
export class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown>,
  ) {
    super(code);
  }
}
export class AgentPlatformClient {
  constructor(private readonly options: ClientOptions) {}
  withSignal(signal: AbortSignal) {
    return new AgentPlatformClient({ ...this.options, signal });
  }
  setOrganization(id: string) {
    this.options.organizationId = id;
  }
  async request<T>(
    path: string,
    init: RequestInit = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const method = init.method ?? "GET";
    const signal = AbortSignal.any([
      ...(options.signal ? [options.signal] : []),
      ...(this.options.signal ? [this.options.signal] : []),
      ...(init.signal ? [init.signal] : []),
      AbortSignal.timeout(this.options.timeoutMs ?? 30000),
    ]);
    const retryable =
      method === "GET" || method === "HEAD" || !!options.idempotencyKey;
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const headers = new Headers(init.headers);
      if (init.body && !headers.has("content-type"))
        headers.set("content-type", "application/json");
      if (this.options.token)
        headers.set("authorization", `Bearer ${this.options.token}`);
      if (this.options.organizationId)
        headers.set("x-organization-id", this.options.organizationId);
      if (options.idempotencyKey)
        headers.set("idempotency-key", options.idempotencyKey);
      const response = await fetch(
        `${this.options.baseUrl.replace(/\/$/, "")}${path}`,
        {
          ...init,
          headers,
          credentials: this.options.credentials ?? "include",
          signal,
        },
      );
      if (response.ok) {
        options.onHeaders?.(response.headers);
        return response.status === 204
          ? (undefined as T)
          : (response.json() as Promise<T>);
      }
      if (
        retryable &&
        [429, 502, 503, 504].includes(response.status) &&
        attempt < Math.min(this.options.retries ?? 2, 5)
      ) {
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      const details = (await response
        .json()
        .catch(() => ({ error: "API_REQUEST_FAILED" }))) as Record<
        string,
        unknown
      >;
      throw new PlatformError(
        response.status,
        String(details.error ?? "API_REQUEST_FAILED"),
        details,
      );
    }
  }
  async page<T>(
    path: string,
    query: { limit?: number; cursor?: string; status?: string } = {},
  ) {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query))
      if (value !== undefined) params.set(name, String(value));
    let nextCursor: string | null = null;
    const data = await this.request<
      T[] | { items: T[]; nextCursor: string | null }
    >(
      `${path}${params.size ? `?${params}` : ""}`,
      {},
      {
        onHeaders: (headers) => {
          nextCursor = headers.get("x-next-cursor");
        },
      },
    );
    return Array.isArray(data) ? { items: data, nextCursor } : data;
  }
  private post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(
      path,
      {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      options,
    );
  }
  async login(email: string, password: string) {
    const session = await this.post<AuthSession>("/v1/auth/login", {
      email,
      password,
    });
    this.options.token = session.token;
    return session;
  }
  async register(input: { email: string; password: string; name: string }) {
    const session = await this.post<AuthSession>("/v1/auth/register", input);
    this.options.token = session.token;
    return session;
  }
  async google(credential: string) {
    const session = await this.post<AuthSession>("/v1/auth/google", {
      credential,
    });
    this.options.token = session.token;
    return session;
  }
  me() {
    return this.request<{ user: User }>("/v1/auth/me");
  }
  async logout() {
    await this.post<void>("/v1/auth/logout");
    this.options.token = undefined;
  }
  createSandbox(
    input: {
      type?: "KATA" | "FIRECRACKER";
      name?: string;
      memoryMb?: number;
      cpu?: number;
    },
    options?: RequestOptions,
  ) {
    return this.post<Sandbox>("/v1/sandboxes", input, options);
  }
  listSandboxes() {
    return this.request<Sandbox[]>("/v1/sandboxes");
  }
  getSandbox(id: string) {
    return this.request<Sandbox>(`/v1/sandboxes/${encodeURIComponent(id)}`);
  }
  sandboxLifecycle(
    id: string,
    action: "start" | "stop" | "pause" | "resume" | "restart",
  ) {
    return this.post<Sandbox>(
      `/v1/sandboxes/${encodeURIComponent(id)}/lifecycle`,
      { action },
    );
  }
  sandboxStats(id: string) {
    return this.request<Record<string, unknown>>(
      `/v1/sandboxes/${encodeURIComponent(id)}/stats`,
    );
  }
  execute(sandboxId: string, command: string, options?: RequestOptions) {
    return this.post<{
      stdout: string;
      stderr: string;
      exitCode: number | null;
      timedOut: boolean;
    }>(
      `/v1/sandboxes/${encodeURIComponent(sandboxId)}/exec`,
      { command },
      options,
    );
  }
  createExecution(
    input: {
      sandboxId: string;
      command: string;
      options?: {
        cwd?: string;
        timeoutMs?: number;
        maxOutputBytes?: number;
        secretNames?: string[];
      };
    },
    options?: RequestOptions,
  ) {
    return this.post<Execution>("/v1/executions", input, options);
  }
  getExecution(id: string) {
    return this.request<Execution>(`/v1/executions/${encodeURIComponent(id)}`);
  }
  cancelExecution(id: string) {
    return this.post<Resource>(
      `/v1/executions/${encodeURIComponent(id)}/cancel`,
    );
  }
  files(
    sandboxId: string,
    input: {
      op: "read" | "write" | "list" | "mkdir" | "delete" | "move" | "stat";
      path: string;
      data?: string;
      destination?: string;
    },
  ) {
    return this.post<Record<string, unknown>>(
      `/v1/sandboxes/${encodeURIComponent(sandboxId)}/files`,
      input,
    );
  }
  collectArtifact(
    sandboxId: string,
    input: { path: string; filename: string; mimeType?: string },
  ) {
    return this.post<Artifact>(
      `/v1/sandboxes/${encodeURIComponent(sandboxId)}/artifacts`,
      input,
    );
  }
  listArtifacts() {
    return this.request<Artifact[]>("/v1/artifacts");
  }
  uploadArtifact(input: { filename: string; mimeType: string; data: string }) {
    return this.post<Artifact>("/v1/artifacts", input);
  }
  downloadArtifact(id: string) {
    return this.request<{ url: string; expiresAt: string }>(
      `/v1/artifacts/${encodeURIComponent(id)}/download`,
    );
  }
  createRun(
    input: {
      sandboxId: string;
      task: string;
      sessionId?: string;
      systemInstructions?: string;
      provider?: "anthropic" | "openai" | "deepseek" | "openrouter";
      model?: string;
    },
    options?: RequestOptions,
  ) {
    return this.post<Run>("/v1/runs", input, options);
  }
  listRuns() {
    return this.request<Run[]>("/v1/runs");
  }
  getRun(id: string) {
    return this.request<Run>(`/v1/runs/${encodeURIComponent(id)}`);
  }
  cancelRun(id: string) {
    return this.post<Resource>(`/v1/runs/${encodeURIComponent(id)}/cancel`);
  }
  resumeRun(id: string, acceptUncertainSideEffects: true) {
    return this.post<Run>(`/v1/runs/${encodeURIComponent(id)}/resume`, {
      acceptUncertainSideEffects,
    });
  }
  listSessions() {
    return this.request<{ items: Session[]; nextCursor: string | null }>(
      "/v1/sessions",
    );
  }
  createSession(title: string) {
    return this.post<Session>("/v1/sessions", { title });
  }
  getSession(id: string) {
    return this.request<Session>(`/v1/sessions/${encodeURIComponent(id)}`);
  }
  deleteSession(id: string) {
    return this.request<void>(`/v1/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  listBrowsers() {
    return this.request<BrowserSession[]>("/v1/browsers");
  }
  createBrowser(sandboxId: string) {
    return this.post<BrowserSession>("/v1/browsers", { sandboxId });
  }
  browserAction(id: string, action: Record<string, unknown>) {
    return this.post<Record<string, unknown>>(
      `/v1/browsers/${encodeURIComponent(id)}/actions`,
      action,
    );
  }
  closeBrowser(id: string) {
    return this.request<void>(`/v1/browsers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  listOrganizations() {
    return this.request<Organization[]>("/v1/organizations");
  }
  getUsage() {
    return this.request<{
      totals: { metric: string; quantity: string; unit: string }[];
      quotas: { metric: string; limit: string }[];
    }>("/v1/usage");
  }
  listActivity() {
    return this.page<Resource>("/v1/activity");
  }
  listMcpServers() {
    return this.request<Resource[]>("/v1/mcp-servers");
  }
  destroySandbox(id: string) {
    return this.request<void>(`/v1/sandboxes/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  createOrganization(name: string) {
    return this.post<Organization>("/v1/organizations", { name });
  }
  updateOrganization(name: string) {
    return this.request<Omit<Organization, "role">>(
      "/v1/organizations/current",
      {
        method: "PATCH",
        body: JSON.stringify({ name }),
      },
    );
  }
  listMembers() {
    return this.request<Membership[]>("/v1/memberships");
  }
  inviteMember(email: string, role: "admin" | "developer" | "viewer") {
    return this.post<{ token: string; expiresAt: string }>("/v1/invitations", {
      email,
      role,
    });
  }
  acceptInvitation(token: string) {
    return this.post<{ organizationId: string }>("/v1/invitations/accept", {
      token,
    });
  }
  updateMember(id: string, role: "admin" | "developer" | "viewer") {
    return this.request<Pick<Membership, "id" | "userId" | "role">>(
      `/v1/memberships/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    );
  }
  removeMember(id: string) {
    return this.request<void>(`/v1/memberships/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  listApiKeys() {
    return this.request<ApiKey[]>("/v1/api-keys");
  }
  createApiKey(input: { name: string; scopes: string[]; expiresAt?: string }) {
    return this.post<{ id: string; name: string; token: string }>(
      "/v1/api-keys",
      input,
    );
  }
  rotateApiKey(id: string) {
    return this.post<{ id: string; name: string; token: string }>(
      `/v1/api-keys/${encodeURIComponent(id)}/rotate`,
    );
  }
  revokeApiKey(id: string) {
    return this.request<void>(`/v1/api-keys/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  listProviders() {
    return this.request<ProviderConfiguration[]>("/v1/providers");
  }
  configureProvider(
    provider: ProviderConfiguration["provider"],
    input: {
      model: string;
      apiKey: string;
      settings?: {
        aliases?: Record<string, string>;
        fallbacks?: ProviderConfiguration["provider"][];
        routing?: Record<string, unknown>;
        inputPricePerMillion?: number;
        outputPricePerMillion?: number;
      };
    },
  ) {
    return this.request<ProviderConfiguration>(`/v1/providers/${provider}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }
  getPolicy() {
    return this.request<Policy>("/v1/policies");
  }
  updatePolicy(policy: Policy) {
    return this.request<Policy>("/v1/policies", {
      method: "PUT",
      body: JSON.stringify(policy),
    });
  }
  listApprovals() {
    return this.request<Approval[]>("/v1/approvals");
  }
  decideApproval(id: string, approve: boolean) {
    return this.post<Approval>(
      `/v1/approvals/${encodeURIComponent(id)}/decision`,
      { approve },
    );
  }
  removeArtifact(id: string) {
    return this.request<void>(`/v1/artifacts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  configureMcp(name: string, configuration: McpConfiguration) {
    return this.post<Resource>("/v1/mcp-servers", { name, configuration });
  }
  discoverMcpTools(id: string) {
    return this.post<
      {
        name: string;
        platformName: string;
        description?: string;
        inputSchema: Record<string, unknown>;
      }[]
    >(`/v1/mcp-servers/${encodeURIComponent(id)}/tools`);
  }
  replayRun(id: string) {
    return this.request<{
      runId: string;
      reconstructedStatus: string;
      persistedStatus: string;
      events: ExecutionEvent[];
      executedSideEffects: false;
    }>(`/v1/runs/${encodeURIComponent(id)}/replay`);
  }
  exportCheckpoint(id: string) {
    return this.post<Artifact>(
      `/v1/runs/${encodeURIComponent(id)}/checkpoints/export`,
    );
  }
  private async *readEvents(
    runId: string,
    options: { signal?: AbortSignal; after?: number } = {},
  ): AsyncGenerator<ExecutionEvent> {
    const headers = new Headers({ accept: "text/event-stream" });
    if (this.options.token)
      headers.set("authorization", `Bearer ${this.options.token}`);
    if (this.options.organizationId)
      headers.set("x-organization-id", this.options.organizationId);
    if (options.after) headers.set("last-event-id", String(options.after));
    const response = await fetch(
      `${this.options.baseUrl.replace(/\/$/, "")}/v1/runs/${encodeURIComponent(runId)}/events`,
      {
        headers,
        credentials: this.options.credentials ?? "include",
        signal: options.signal,
      },
    );
    if (!response.ok || !response.body)
      throw new PlatformError(response.status, "STREAM_FAILED", {});
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder
          .decode(value, { stream: !done })
          .replace(/\r\n/g, "\n");
        if (buffer.length > 2 * 1048576) throw new Error("STREAM_EVENT_LIMIT");
        while (buffer.includes("\n\n")) {
          const boundary = buffer.indexOf("\n\n");
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5))
            .join("\n");
          if (data) yield JSON.parse(data) as ExecutionEvent;
        }
        if (done) break;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
  async *events(
    runId: string,
    options: { signal?: AbortSignal; after?: number } = {},
  ): AsyncGenerator<ExecutionEvent> {
    options = {
      ...options,
      signal: AbortSignal.any([
        ...(options.signal ? [options.signal] : []),
        ...(this.options.signal ? [this.options.signal] : []),
      ]),
    };
    let after = options.after ?? 0,
      failures = 0;
    while (!options.signal?.aborted) {
      try {
        for await (const event of this.readEvents(runId, {
          signal: options.signal,
          after,
        })) {
          if (event.sequence <= after) continue;
          after = event.sequence;
          failures = 0;
          yield event;
          if (
            [
              "run.completed",
              "run.failed",
              "run.cancelled",
              "run.interrupted",
              "run.limit_reached",
            ].includes(event.type)
          )
            return;
        }
      } catch (error) {
        if (options.signal?.aborted) return;
        if (
          error instanceof PlatformError &&
          [400, 401, 403, 404].includes(error.status)
        )
          throw error;
      }
      if (++failures > 5) throw new Error("STREAM_CONNECTION_LOST");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000 * 2 ** (failures - 1), 10000)),
      );
    }
  }
}
