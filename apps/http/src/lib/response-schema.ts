type Schema = Record<string, unknown>;
const text: Schema = { type: "string" };
const number: Schema = { type: "number" };
const boolean: Schema = { type: "boolean" };
const date: Schema = { type: "string", format: "date-time" };
const strings: Schema = { type: "array", items: text };
const nullable = (schema: Schema): Schema => ({ ...schema, nullable: true });
const object = (
  properties: Record<string, Schema>,
  required: string[] = [],
): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const array = (items: Schema): Schema => ({ type: "array", items });
const dates = {
  createdAt: date,
  updatedAt: date,
  startedAt: nullable(date),
  completedAt: nullable(date),
  expiresAt: nullable(date),
};
const user = object(
  { id: text, name: text, email: text, organizationId: text },
  ["id", "name", "email", "organizationId"],
);
const event = object(
  {
    id: text,
    runId: text,
    type: text,
    sequence: number,
    payload: {},
    createdAt: date,
  },
  ["id", "type", "sequence", "payload"],
);
const sandbox = object(
  {
    id: text,
    organizationId: text,
    name: text,
    provider: text,
    status: text,
    image: text,
    memoryMb: number,
    cpu: number,
    pidLimit: number,
    workspaceMb: number,
    networkHosts: strings,
    state: {},
    ...dates,
  },
  ["id", "name", "status"],
);
const run = object(
  {
    id: text,
    organizationId: text,
    sandboxId: text,
    sessionId: nullable(text),
    task: text,
    systemInstructions: nullable(text),
    provider: text,
    model: nullable(text),
    status: text,
    result: {},
    error: nullable(text),
    attempt: number,
    cancelRequestedAt: nullable(date),
    toolPermissions: strings,
    events: array(event),
    ...dates,
  },
  ["id", "task", "status"],
);
const execution = object(
  {
    id: text,
    organizationId: text,
    sandboxId: text,
    command: text,
    options: {},
    status: text,
    result: {},
    cancelRequestedAt: nullable(date),
    ...dates,
  },
  ["id", "command", "status"],
);
const session = object(
  {
    id: text,
    organizationId: text,
    userId: nullable(text),
    apiKeyId: nullable(text),
    title: text,
    createdAt: date,
    messages: array(
      object({
        id: text,
        role: text,
        content: {},
        createdAt: date,
        sessionId: text,
      }),
    ),
    runs: array(run),
  },
  ["id", "title"],
);
const artifact = object(
  {
    id: text,
    organizationId: text,
    sandboxId: nullable(text),
    runId: nullable(text),
    filename: text,
    mimeType: text,
    size: number,
    checksum: text,
    status: text,
    createdAt: date,
  },
  ["id", "filename", "mimeType", "size", "status"],
);
const browser = object(
  {
    id: text,
    sandboxId: text,
    organizationId: text,
    status: text,
    createdAt: date,
  },
  ["id", "sandboxId", "status"],
);
const organization = object(
  { id: text, name: text, role: text, createdAt: date },
  ["id", "name"],
);
const key = object(
  {
    id: text,
    name: text,
    prefix: text,
    scopes: strings,
    expiresAt: nullable(date),
    revokedAt: nullable(date),
    createdAt: date,
  },
  ["id", "name"],
);
const policy = object({
  organizationId: text,
  allowedTools: strings,
  allowedCommands: strings,
  approvedHosts: strings,
  requireApproval: strings,
  maxTokens: number,
  maxToolCalls: number,
  deadlineMs: number,
});
const error = object(
  {
    error: text,
    message: text,
    requestId: text,
    approvalId: text,
    issues: array(
      object({ path: array({ anyOf: [text, number] }), message: text }),
    ),
  },
  ["error"],
);

export function responseSchemas(
  url: string,
  method: string,
): Record<string, Schema> | undefined {
  if (url === "/openapi.json" || url.endsWith("/events")) return undefined;
  let schema: Schema = { type: "object", additionalProperties: true },
    status = 200;
  if (
    method === "DELETE" ||
    url === "/v1/auth/logout" ||
    (method === "PUT" &&
      (url.startsWith("/v1/secrets/") || url === "/v1/quotas"))
  )
    return { "4xx": error, "5xx": error };
  if (url === "/health") schema = object({ ok: boolean });
  else if (url === "/health/ready") {
    schema = object({ ready: boolean });
    return { 200: schema, 503: schema, "4xx": error, "5xx": error };
  } else if (url === "/v1/workers/health")
    schema = object({ available: boolean, activeWorkers: number });
  else if (
    ["/v1/auth/register", "/v1/auth/login", "/v1/auth/google"].includes(url)
  ) {
    schema = object({ user, token: text, expiresAt: date }, [
      "user",
      "token",
      "expiresAt",
    ]);
    status = url.endsWith("register") ? 201 : 200;
  } else if (url === "/v1/auth/me") schema = object({ user }, ["user"]);
  else if (url === "/v1/sandboxes") {
    schema = method === "GET" ? array(sandbox) : sandbox;
    status = method === "POST" ? 201 : 200;
  } else if (url.startsWith("/v1/sandboxes/")) {
    if (url.endsWith("/artifacts")) {
      schema = artifact;
      status = 201;
    } else if (url.endsWith("/exec"))
      schema = object({
        stdout: text,
        stderr: text,
        exitCode: nullable(number),
        durationMs: number,
        timedOut: boolean,
        outputLimited: boolean,
      });
    else if (url.endsWith("/lifecycle") || url === "/v1/sandboxes/:id")
      schema = sandbox;
  } else if (url === "/v1/runs") {
    schema = method === "GET" ? array(run) : run;
    status = method === "POST" ? 202 : 200;
  } else if (url.startsWith("/v1/runs/")) {
    if (url.endsWith("/cancel"))
      schema = object({ cancellationRequested: boolean });
    else if (url.endsWith("/resume")) {
      schema = run;
      status = 202;
    } else if (url.endsWith("/checkpoints/export")) schema = artifact;
    else if (url.endsWith("/checkpoints"))
      schema = array(object({ id: text, sequence: number, createdAt: date }));
    else if (url.endsWith("/replay"))
      schema = object({
        runId: text,
        reconstructedStatus: text,
        persistedStatus: text,
        events: array(event),
        executedSideEffects: boolean,
      });
    else schema = run;
  } else if (url === "/v1/executions") {
    schema = method === "GET" ? array(execution) : execution;
    status = method === "POST" ? 202 : 200;
  } else if (url.startsWith("/v1/executions/"))
    schema = url.endsWith("/cancel")
      ? object({ cancellationRequested: boolean })
      : execution;
  else if (url === "/v1/sessions") {
    schema =
      method === "GET"
        ? object({ items: array(session), nextCursor: nullable(text) })
        : session;
    status = method === "POST" ? 201 : 200;
  } else if (url.startsWith("/v1/sessions/")) schema = session;
  else if (url === "/v1/browsers") {
    schema = method === "GET" ? array(browser) : browser;
    status = method === "POST" ? 201 : 200;
  } else if (url === "/v1/artifacts") {
    schema = method === "GET" ? array(artifact) : artifact;
    status = method === "POST" ? 201 : 200;
  } else if (url.endsWith("/download") && url.startsWith("/v1/artifacts/"))
    schema = object({ url: text, expiresAt: date }, ["url", "expiresAt"]);
  else if (url === "/v1/organizations") {
    schema = method === "GET" ? array(organization) : organization;
    status = method === "POST" ? 201 : 200;
  } else if (url === "/v1/organizations/current") schema = organization;
  else if (url === "/v1/invitations") {
    schema = object({ token: text, expiresAt: date });
    status = 201;
  } else if (url === "/v1/memberships")
    schema = array(
      object({ id: text, userId: text, name: text, email: text, role: text }),
    );
  else if (url === "/v1/api-keys") {
    schema =
      method === "GET"
        ? array(key)
        : object({ id: text, name: text, token: text });
    status = method === "POST" ? 201 : 200;
  } else if (url.endsWith("/rotate") && url.startsWith("/v1/api-keys/")) {
    schema = object({ id: text, name: text, token: text });
    status = 201;
  } else if (url === "/v1/providers")
    schema = array(
      object({
        id: text,
        provider: text,
        model: text,
        settings: {},
        configured: boolean,
      }),
    );
  else if (url.startsWith("/v1/providers/"))
    schema = object({
      id: text,
      provider: text,
      model: text,
      settings: {},
      configured: boolean,
    });
  else if (url === "/v1/secrets")
    schema = array(object({ id: text, name: text, createdAt: date }));
  else if (url === "/v1/policies") schema = policy;
  else if (url === "/v1/approvals")
    schema = array(
      object({
        id: text,
        organizationId: text,
        runId: nullable(text),
        actionHash: text,
        action: {},
        status: text,
        decidedBy: nullable(text),
        expiresAt: date,
      }),
    );
  else if (url === "/v1/activity")
    schema = array(
      object({
        id: text,
        type: text,
        resourceId: text,
        payload: {},
        createdAt: date,
      }),
    );
  else if (url === "/v1/audit")
    schema = array(
      object({
        id: text,
        organizationId: text,
        actorId: text,
        action: text,
        resourceId: nullable(text),
        createdAt: date,
      }),
    );
  else if (url === "/v1/mcp-servers") {
    schema =
      method === "GET"
        ? array(
            object({
              id: text,
              name: text,
              transport: text,
              configuration: {},
            }),
          )
        : object({ id: text, name: text, transport: text, configuration: {} });
    status = method === "POST" ? 201 : 200;
  } else if (url.endsWith("/tools") && url.startsWith("/v1/mcp-servers/"))
    schema = array(
      object({
        name: text,
        platformName: text,
        description: text,
        inputSchema: {},
      }),
    );
  return { [status]: schema, "4xx": error, "5xx": error };
}

export function openApiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(openApiSchema);
  if (!value || typeof value !== "object") return value;
  const schema = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "nullable")
      .map(([key, item]) => [key, openApiSchema(item)]),
  );
  if (
    "nullable" in value &&
    value.nullable === true &&
    typeof schema.type === "string"
  )
    schema.type = [schema.type, "null"];
  return schema;
}
