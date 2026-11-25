import { z } from "zod";

export const modelMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().max(1048576).nullable(),
  stopReason: z.enum(["stop", "tools", "limit", "continue"]).optional(),
  toolCalls: z
    .array(
      z.object({
        id: z.string().max(200),
        name: z.string().max(64),
        arguments: z.string().max(262144),
      }),
    )
    .max(128)
    .optional(),
  toolCallId: z.string().max(200).optional(),
  native: z.unknown().optional(),
  reasoning: z.string().max(1048576).optional(),
});
export const usageSchema = z.strictObject({
  iterations: z.number().int().nonnegative().max(32).optional(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  toolCallsExecuted: z.number().int().nonnegative(),
});
export const toolMetadataSchema = z.strictObject({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  description: z.string().max(65536),
  inputSchema: z.record(z.string(), z.unknown()),
  version: z.string().max(100),
  permission: z.string().max(100),
  risk: z.enum(["read", "write", "execute"]),
  timeoutMs: z.number().int().positive().max(300000),
});
export const launchSchema = z.strictObject({
  tools: z.array(toolMetadataSchema).max(128),
  input: z.strictObject({
    sandboxId: z.string().max(200),
    task: z.string().max(20000),
    provider: z.enum(["anthropic", "openai", "deepseek", "openrouter"]),
    model: z.string().max(200).optional(),
    systemInstructions: z.string().max(10000).optional(),
    messages: z.array(modelMessageSchema).max(2000).optional(),
    previousUsage: usageSchema.optional(),
    maxTokens: z.number().int().positive(),
    maxToolCalls: z.number().int().nonnegative(),
    maxIterations: z.number().int().min(1).max(32).optional(),
    deadlineMs: z.number().int().positive().max(3600000),
  }),
});
export const modelCallSchema = z.strictObject({
  messages: z.array(modelMessageSchema).max(2000),
  maxTokens: z.number().int().positive().max(4096),
});
export const toolCallSchema = z.strictObject({
  name: z.string().max(64),
  input: z.record(z.string(), z.unknown()),
  callId: z.string().min(1).max(200),
});
export const checkpointSchema = z.strictObject({
  messages: z.array(modelMessageSchema).max(2000),
});
export const resultSchema = z.strictObject({
  status: z.enum(["COMPLETED", "LIMIT_REACHED"]),
  finalAnswer: z.string().max(1048576),
  iterations: z.number().int().nonnegative().max(32),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  toolCallsExecuted: z.number().int().nonnegative(),
});
export type AgentLaunch = z.infer<typeof launchSchema>;
export type AgentResult = z.infer<typeof resultSchema>;
