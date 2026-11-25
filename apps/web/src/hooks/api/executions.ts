"use client";
import { z } from "zod";
import { executionSchema } from "@repo/web/lib/schemas";
import {
  useApiPages,
  useApiQuery,
  useApiAction,
  cancellationSchema,
} from "./core";
export const createExecutionSchema = z.object({
  sandboxId: z.string().min(1, "Choose a sandbox"),
  command: z.string().trim().min(1).max(4000),
  cwd: z.string().default("."),
  timeoutMs: z.coerce.number().min(100).max(300000).default(30000),
  secretNames: z.array(z.string()).default([]),
});
export const useExecutions = () =>
  useApiPages("executions", "/v1/executions", executionSchema, 4000);
export const useExecution = (id: string) =>
  useApiQuery(
    "executions",
    `/v1/executions/${id}`,
    executionSchema,
    !!id,
    4000,
  );
export const useCreateExecution = () =>
  useApiAction(
    "executions",
    (client, input: z.infer<typeof createExecutionSchema>) =>
      client.createExecution(
        {
          sandboxId: input.sandboxId,
          command: input.command,
          options: {
            cwd: input.cwd,
            timeoutMs: input.timeoutMs,
            secretNames: input.secretNames,
          },
        },
        { idempotencyKey: crypto.randomUUID() },
      ),
    executionSchema,
    "Command queued",
  );
export const useCancelExecution = () =>
  useApiAction(
    "executions",
    (client, id: string) => client.cancelExecution(id),
    cancellationSchema,
    "Cancellation requested",
  );
