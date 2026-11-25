import { z } from "zod";
import { providerConfiguration } from "@repo/db";
export const idParams = z.object({ id: z.string().uuid() });
export const roleSchema = z.enum(["admin", "developer", "viewer"]);
export const providers = z.enum([
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
]);
export const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().uuid().optional(),
});
export const safeProvider = (
  record: typeof providerConfiguration.$inferSelect,
) => ({
  id: record.id,
  provider: record.provider,
  model: record.model,
  settings: record.settings,
  configured: true,
});
