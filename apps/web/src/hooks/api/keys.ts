"use client";
import { z } from "zod";
import { keySchema, credentialSchema } from "@repo/web/lib/schemas";
import { useApiPages, useApiAction, noContentSchema } from "./core";
export const scopes = [
  "sandbox.read",
  "sandbox.write",
  "sandbox.execute",
  "execution.read",
  "files.read",
  "files.write",
  "artifacts.read",
  "artifacts.write",
  "runs.read",
  "runs.write",
  "sessions.read",
  "sessions.write",
  "browser.read",
  "browser.write",
  "models.read",
  "models.use",
  "mcp.execute",
  "tools.read",
  "events.read",
  "secrets.use",
] as const;
export const createKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(z.enum(scopes))
    .min(1, "Select at least one permission")
    .prefault([]),
});
export const useApiKeys = () => useApiPages("keys", "/v1/api-keys", keySchema);
export const useCreateApiKey = () =>
  useApiAction(
    "keys",
    (client, input: z.infer<typeof createKeySchema>) =>
      client.createApiKey(input),
    credentialSchema,
    "API key created. Copy it before closing.",
  );
export const useRotateApiKey = () =>
  useApiAction(
    "keys",
    (client, id: string) => client.rotateApiKey(id),
    credentialSchema,
    "API key rotated. The previous key is revoked.",
  );
export const useRevokeApiKey = () =>
  useApiAction(
    "keys",
    (client, id: string) => client.revokeApiKey(id),
    noContentSchema,
    "API key revoked",
  );
