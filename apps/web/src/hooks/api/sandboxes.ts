"use client";
import { z } from "zod";
import {
  sandboxSchema,
  jsonObjectSchema,
  artifactSchema,
} from "@repo/web/lib/schemas";
import {
  useApiPages,
  useApiQuery,
  useApiAction,
  noContentSchema,
  post,
  remove,
} from "./core";
export const createSandboxSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, underscores or hyphens"),
  memoryMb: z.coerce.number().int().min(512).max(2048),
  cpu: z.coerce.number().min(0.25).max(2),
});
export const useSandboxes = () =>
  useApiPages("sandboxes", "/v1/sandboxes", sandboxSchema, 5000);
export const useCreateSandbox = () =>
  useApiAction(
    "sandboxes",
    (client, input: z.infer<typeof createSandboxSchema>) =>
      client.createSandbox(input),
    sandboxSchema,
    "Sandbox created",
  );
export const useSandboxLifecycle = () =>
  useApiAction(
    "sandboxes",
    (
      client,
      input: {
        id: string;
        action: "start" | "stop" | "pause" | "resume" | "restart";
      },
    ) => client.sandboxLifecycle(input.id, input.action),
    sandboxSchema,
    "Sandbox updated",
  );
export const useDestroySandbox = () =>
  useApiAction(
    "sandboxes",
    (client, id: string) => remove(client, `/v1/sandboxes/${id}`),
    noContentSchema,
    "Sandbox destroyed",
  );
export const useSandboxStats = (id: string) =>
  useApiQuery("sandboxes", `/v1/sandboxes/${id}/stats`, jsonObjectSchema, !!id);
export const fileOperationSchema = z.object({
  op: z.enum(["list", "read", "write", "stat", "mkdir", "move", "delete"]),
  path: z.string().min(1),
  destination: z.string().optional(),
  data: z.string().optional(),
});
export const useFileOperation = () =>
  useApiAction(
    "files",
    (
      client,
      input: z.infer<typeof fileOperationSchema> & { sandboxId: string },
    ) =>
      post(
        client,
        `/v1/sandboxes/${input.sandboxId}/files`,
        fileOperationSchema.parse(input),
      ),
    jsonObjectSchema,
    "",
  );
export const useCollectArtifact = () =>
  useApiAction(
    "artifacts",
    (client, input: { sandboxId: string; path: string; filename: string }) =>
      client.collectArtifact(input.sandboxId, input),
    artifactSchema,
    "File saved to Artifacts",
  );
