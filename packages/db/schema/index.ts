import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  numeric,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export const platformEvent = pgTable(
  "platform_event",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    type: text("type").notNull(),
    resourceId: text("resource_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("platform_event_org_created_idx").on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const sandboxStatusEnum = pgEnum("sandbox_status", [
  "CREATING",
  "RUNNING",
  "STOPPED",
  "DESTROYED",
  "FAILED",
  "PAUSED",
]);

export const runStatusEnum = pgEnum("run_status", [
  "QUEUED",
  "RUNNING",
  "AWAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
  "LIMIT_REACHED",
]);

export const organization = pgTable("organization", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { mode: "date", precision: 3 })
    .defaultNow()
    .notNull(),
});

export const user = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  googleId: text("google_id").unique(),
  createdAt: timestamp("created_at", { mode: "date", precision: 3 })
    .defaultNow()
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      precision: 3,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

export const sandbox = pgTable(
  "sandbox",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    provider: text("provider").default("docker").notNull(),
    resourceId: text("resource_id"),
    status: sandboxStatusEnum("status").default("CREATING").notNull(),
    memoryMb: integer("memory_mb").default(512).notNull(),
    cpu: doublePrecision("cpu").default(1.0).notNull(),
    image: text("image").default("zlayer-sandbox:local").notNull(),
    pidLimit: integer("pid_limit").notNull().default(128),
    workspaceMb: integer("workspace_mb").notNull().default(256),
    networkHosts: text("network_hosts").array().notNull().default([]),
    expiresAt: timestamp("expires_at", { mode: "date", precision: 3 }),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("sandbox_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

export const agentRun = pgTable(
  "agent_run",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    sandboxId: text("sandbox_id")
      .notNull()
      .references(() => sandbox.id),
    task: text("task").notNull(),
    systemInstructions: text("system_instructions"),
    toolPermissions: text("tool_permissions").array().notNull().default([]),
    status: runStatusEnum("status").default("QUEUED").notNull(),
    result: jsonb("result"),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    startedAt: timestamp("started_at", { mode: "date", precision: 3 }),
    completedAt: timestamp("completed_at", { mode: "date", precision: 3 }),
    sessionId: text("session_id").references(() => agentSession.id, {
      onDelete: "set null",
    }),
    provider: text("provider").default("openai").notNull(),
    model: text("model"),
    cancelRequestedAt: timestamp("cancel_requested_at", {
      mode: "date",
      precision: 3,
    }),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      mode: "date",
      precision: 3,
    }),
    attempt: integer("attempt").default(0).notNull(),
    idempotencyKey: text("idempotency_key"),
  },
  (table) => [
    index("agent_run_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("agent_run_status_created_idx").on(table.status, table.createdAt),
    uniqueIndex("agent_run_org_idempotency_idx").on(
      table.organizationId,
      table.idempotencyKey,
    ),
  ],
);

export const agentEvent = pgTable(
  "agent_event",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    runId: text("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    sequence: integer("sequence").default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_event_run_created_idx").on(table.runId, table.createdAt),
  ],
);

export const membership = pgTable(
  "membership",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("developer"),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("membership_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const invitation = pgTable("invitation", {
  tokenHash: text("token_hash").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  email: text("email").notNull(),
  role: text("role").notNull(),
  expiresAt: timestamp("expires_at", { mode: "date", precision: 3 }).notNull(),
});

export const providerConfiguration = pgTable(
  "provider_configuration",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    credential: text("credential").notNull(),
    settings: jsonb("settings").notNull().default({}),
  },
  (table) => [
    uniqueIndex("provider_configuration_org_provider_idx").on(
      table.organizationId,
      table.provider,
    ),
  ],
);

export const execution = pgTable(
  "execution",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    sandboxId: text("sandbox_id")
      .notNull()
      .references(() => sandbox.id),
    command: text("command").notNull(),
    idempotencyKey: text("idempotency_key"),
    options: jsonb("options").notNull().default({}),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      mode: "date",
      precision: 3,
    }),
    cancelRequestedAt: timestamp("cancel_requested_at", {
      mode: "date",
      precision: 3,
    }),
    status: text("status").notNull().default("QUEUED"),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { mode: "date", precision: 3 }),
  },
  (table) => [
    index("execution_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const agentSession = pgTable(
  "agent_session",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    userId: text("user_id").references(() => user.id),
    apiKeyId: text("api_key_id").references(() => apiKey.id),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_session_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const message = pgTable("message", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  sessionId: text("session_id")
    .notNull()
    .references(() => agentSession.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: jsonb("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date", precision: 3 })
    .defaultNow()
    .notNull(),
});

export const artifact = pgTable(
  "artifact",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    sandboxId: text("sandbox_id").references(() => sandbox.id),
    runId: text("run_id").references(() => agentRun.id),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    checksum: text("checksum").notNull(),
    objectKey: text("object_key").notNull().unique(),
    status: text("status").notNull().default("UPLOADING"),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("artifact_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

export const browserSession = pgTable("browser_session", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  sandboxId: text("sandbox_id")
    .notNull()
    .references(() => sandbox.id),
  status: text("status").notNull().default("OPEN"),
  encryptedState: text("encrypted_state"),
  createdAt: timestamp("created_at", { mode: "date", precision: 3 })
    .defaultNow()
    .notNull(),
});

export const secret = pgTable(
  "secret",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    ciphertext: text("ciphertext").notNull(),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("secret_org_name_idx").on(table.organizationId, table.name),
  ],
);

export const approval = pgTable("approval", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  runId: text("run_id").references(() => agentRun.id),
  actionHash: text("action_hash").notNull(),
  action: jsonb("action").notNull(),
  status: text("status").notNull().default("PENDING"),
  decidedBy: text("decided_by").references(() => user.id),
  createdAt: timestamp("created_at", { mode: "date", precision: 3 }).defaultNow(),
  expiresAt: timestamp("expires_at", { mode: "date", precision: 3 }).notNull(),
});

export const auditRecord = pgTable(
  "audit_record",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    resourceId: text("resource_id"),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

export const quota = pgTable(
  "quota",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    metric: text("metric").notNull(),
    limit: numeric("limit", { precision: 20, scale: 6 }).notNull(),
    period: text("period").default("month").notNull(),
  },
  (table) => [
    uniqueIndex("quota_org_metric_idx").on(table.organizationId, table.metric),
  ],
);

export const checkpoint = pgTable("checkpoint", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  runId: text("run_id")
    .notNull()
    .references(() => agentRun.id, { onDelete: "cascade" }),
  state: jsonb("state").notNull(),
  sequence: integer("sequence").notNull(),
  createdAt: timestamp("created_at", { mode: "date", precision: 3 })
    .defaultNow()
    .notNull(),
});

export const outbox = pgTable(
  "outbox",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    publishedAt: timestamp("published_at", { mode: "date", precision: 3 }),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("outbox_published_created_idx").on(
      table.publishedAt,
      table.createdAt,
    ),
  ],
);

export const executionPolicy = pgTable("execution_policy", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id),
  allowedTools: text("allowed_tools")
    .array()
    .notNull()
    .default(["execute_command", "read_file", "list_directory"]),
  approvedHosts: text("approved_hosts").array().notNull().default([]),
  requireApproval: text("require_approval")
    .array()
    .notNull()
    .default(["execute_command", "write_file"]),
  maxTokens: integer("max_tokens").notNull().default(32000),
  maxToolCalls: integer("max_tool_calls").notNull().default(32),
  allowedCommands: text("allowed_commands").array().notNull().default([]),
  deadlineMs: integer("deadline_ms").notNull().default(300000),
});

export const mcpServer = pgTable("mcp_server", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  name: text("name").notNull(),
  transport: text("transport").notNull(),
  configuration: jsonb("configuration").notNull(),
});

export const toolDefinition = pgTable(
  "tool_definition",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    version: text("version").notNull(),
    description: text("description").notNull(),
    inputSchema: jsonb("input_schema").notNull(),
    permission: text("permission").notNull(),
    risk: text("risk").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
  },
  (table) => [
    uniqueIndex("tool_definition_org_name_idx").on(
      table.organizationId,
      table.name,
    ),
  ],
);

export const toolExecution = pgTable(
  "tool_execution",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    runId: text("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    input: jsonb("input").notNull(),
    result: jsonb("result"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { mode: "date", precision: 3 }),
  },
  (table) => [
    index("tool_execution_org_run_idx").on(table.organizationId, table.runId),
  ],
);

export const apiKey = pgTable("api_key", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").unique().notNull(),
  scopes: text("scopes").array().notNull(), // maps to String[]
  revokedAt: timestamp("revoked_at", { mode: "date", precision: 3 }),
  expiresAt: timestamp("expires_at", { mode: "date", precision: 3 }),
  createdAt: timestamp("created_at", { mode: "date", precision: 3 })
    .defaultNow()
    .notNull(),
});

export const usageEvent = pgTable(
  "usage_event",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    metric: text("metric").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(), // maps to Decimal(20,6)
    unit: text("unit").notNull(),
    idempotencyKey: text("idempotency_key").unique().notNull(),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("usage_event_org_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
  ],
);

export const organizationRelations = relations(organization, ({ many }) => ({
  sandboxes: many(sandbox),
  runs: many(agentRun),
  apiKeys: many(apiKey),
  usage: many(usageEvent),
}));

export const sandboxRelations = relations(sandbox, ({ one, many }) => ({
  organization: one(organization, {
    fields: [sandbox.organizationId],
    references: [organization.id],
  }),
  runs: many(agentRun),
}));

export const agentRunRelations = relations(agentRun, ({ one, many }) => ({
  organization: one(organization, {
    fields: [agentRun.organizationId],
    references: [organization.id],
  }),
  sandbox: one(sandbox, {
    fields: [agentRun.sandboxId],
    references: [sandbox.id],
  }),
  events: many(agentEvent),
}));

export const agentEventRelations = relations(agentEvent, ({ one }) => ({
  run: one(agentRun, {
    fields: [agentEvent.runId],
    references: [agentRun.id],
  }),
}));

export const apiKeyRelations = relations(apiKey, ({ one }) => ({
  organization: one(organization, {
    fields: [apiKey.organizationId],
    references: [organization.id],
  }),
}));

export const usageEventRelations = relations(usageEvent, ({ one }) => ({
  organization: one(organization, {
    fields: [usageEvent.organizationId],
    references: [organization.id],
  }),
}));
