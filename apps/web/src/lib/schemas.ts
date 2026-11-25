import { z } from "zod";

export const roleSchema = z.enum(["owner", "admin", "developer", "viewer"]);
export const providerNameSchema = z.enum([
  "openai",
  "anthropic",
  "deepseek",
  "openrouter",
]);
export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  organizationId: z.string(),
});
export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: roleSchema,
});
export const memberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
});
export const sandboxSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  memoryMb: z.number(),
  cpu: z.number(),
  createdAt: z.string().optional(),
  networkHosts: z.array(z.string()).default([]),
});
export const eventSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  type: z.string(),
  payload: z.unknown(),
  createdAt: z.string().optional(),
});
export const runSchema = z.object({
  id: z.string(),
  sandboxId: z.string(),
  task: z.string(),
  status: z.string(),
  provider: z.string().optional(),
  model: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  result: z
    .object({ finalAnswer: z.string().optional() })
    .passthrough()
    .nullable()
    .optional(),
  events: z.array(eventSchema).optional(),
  createdAt: z.string().optional(),
});
export const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string().optional(),
  messages: z
    .array(z.object({ id: z.string(), role: z.string(), content: z.unknown() }))
    .optional(),
  runs: z.array(runSchema).optional(),
});
export const executionSchema = z.object({
  id: z.string(),
  sandboxId: z.string(),
  command: z.string(),
  status: z.string(),
  result: z
    .object({
      stdout: z.string(),
      stderr: z.string(),
      exitCode: z.number().nullable(),
      timedOut: z.boolean(),
    })
    .passthrough()
    .nullable()
    .optional(),
  createdAt: z.string().optional(),
});
export const browserSchema = z.object({
  id: z.string(),
  sandboxId: z.string(),
  status: z.string(),
  createdAt: z.string().optional(),
});
export const artifactSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  status: z.string(),
  createdAt: z.string().optional(),
});
export const providerSchema = z.object({
  id: z.string(),
  provider: providerNameSchema,
  model: z.string(),
  configured: z.boolean(),
  settings: z
    .object({
      aliases: z.record(z.string(), z.string()).optional(),
      fallbacks: z.array(providerNameSchema).optional(),
      routing: z.record(z.string(), z.unknown()).optional(),
      inputPricePerMillion: z.number().optional(),
      outputPricePerMillion: z.number().optional(),
    })
    .passthrough(),
});
export const keySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.string().nullable().optional(),
  revokedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});
export const approvalSchema = z.object({
  id: z.string(),
  status: z.string(),
  action: z.unknown(),
  runId: z.string().nullable().optional(),
  expiresAt: z.string(),
});
export const auditSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string(),
  resourceId: z.string().nullable().optional(),
  createdAt: z.string(),
});
export const activitySchema = z.object({
  id: z.string(),
  type: z.string(),
  resourceId: z.string(),
  payload: z.unknown(),
  createdAt: z.string(),
});
export const mcpSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.string(),
  configuration: z.record(z.string(), z.unknown()),
});
export const toolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});
export const policySchema = z.object({
  allowedTools: z.array(z.string()),
  allowedCommands: z.array(z.string()).default([]),
  requireApproval: z.array(z.string()),
  approvedHosts: z.array(z.string()),
  maxTokens: z.number(),
  maxToolCalls: z.number(),
  deadlineMs: z.number(),
});
export const usageSchema = z.object({
  totals: z.array(
    z.object({
      metric: z.string(),
      quantity: z.coerce.number(),
      unit: z.string(),
    }),
  ),
  reservations: z
    .array(z.object({ metric: z.string(), quantity: z.coerce.number() }))
    .default([]),
  quotas: z.array(z.object({ metric: z.string(), limit: z.coerce.number() })),
  models: z
    .array(
      z.object({
        provider: z.string().nullable(),
        model: z.string().nullable(),
        metric: z.string(),
        quantity: z.coerce.number(),
      }),
    )
    .default([]),
  storage: z
    .object({ bytes: z.coerce.number(), count: z.coerce.number() })
    .optional(),
});
export const credentialSchema = z.object({
  token: z.string(),
  expiresAt: z.string().optional(),
});
export const jsonObjectSchema = z.record(z.string(), z.unknown());
export type User = z.infer<typeof userSchema>;
export type Sandbox = z.infer<typeof sandboxSchema>;
export type Run = z.infer<typeof runSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Execution = z.infer<typeof executionSchema>;
export type BrowserSession = z.infer<typeof browserSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Policy = z.infer<typeof policySchema>;
