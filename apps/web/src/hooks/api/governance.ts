"use client";
import { z } from "zod";
import {
  policySchema,
  approvalSchema,
  usageSchema,
  auditSchema,
  activitySchema,
  toolSchema,
} from "@repo/web/lib/schemas";
import {
  useApiQuery,
  useApiPages,
  useApiAction,
  noContentSchema,
  put,
  post,
  remove,
} from "./core";
export const usePolicy = () =>
  useApiQuery("policies", "/v1/policies", policySchema);
export const useTools = () =>
  useApiQuery(
    "tools",
    "/v1/tools",
    z.object({
      builtins: z.array(toolSchema),
      registered: z.array(toolSchema),
    }),
  );
export const useUsage = () => useApiQuery("usage", "/v1/usage", usageSchema);
export const useApprovals = () =>
  useApiQuery(
    "approvals",
    "/v1/approvals",
    z.array(approvalSchema),
    true,
    5000,
  );
export const useAudit = () => useApiPages("audit", "/v1/audit", auditSchema);
export const useActivity = () =>
  useApiPages("activity", "/v1/activity", activitySchema, 5000);
export const useSecrets = () =>
  useApiQuery(
    "secrets",
    "/v1/secrets",
    z.array(z.object({ id: z.string(), name: z.string() })),
  );
export const useSavePolicy = () =>
  useApiAction(
    "policies",
    (client, input: z.infer<typeof policySchema>) =>
      put(client, "/v1/policies", policySchema.parse(input)),
    policySchema,
    "Execution policy saved",
  );
export const useDecideApproval = () =>
  useApiAction(
    "approvals",
    (client, input: { id: string; approve: boolean }) =>
      post(client, `/v1/approvals/${input.id}/decision`, {
        approve: input.approve,
      }),
    approvalSchema,
    "Decision recorded",
  );
export const useSaveSecret = () =>
  useApiAction(
    "secrets",
    (client, input: { name: string; value: string }) =>
      put(client, `/v1/secrets/${encodeURIComponent(input.name)}`, {
        value: input.value,
      }),
    noContentSchema,
    "Secret saved securely",
  );
export const useDeleteSecret = () =>
  useApiAction(
    "secrets",
    (client, name: string) =>
      remove(client, `/v1/secrets/${encodeURIComponent(name)}`),
    noContentSchema,
    "Secret deleted",
  );
export const useSaveQuota = () =>
  useApiAction(
    "usage",
    (client, input: { metric: string; limit: number }) =>
      put(client, "/v1/quotas", input),
    noContentSchema,
    "Quota updated",
  );
