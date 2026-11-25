"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  providerNameSchema,
  runSchema,
  eventSchema,
  artifactSchema,
} from "@repo/web/lib/schemas";
import { useWorkspaceStore } from "@repo/web/stores/workspace-store";
import {
  useApiPages,
  useApiQuery,
  useApiAction,
  useApiClient,
  cancellationSchema,
} from "./core";
export const createRunSchema = z.object({
  sandboxId: z.string().min(1, "Choose a running sandbox"),
  task: z.string().trim().min(1).max(20000),
  provider: providerNameSchema,
  model: z.string().max(200).optional(),
  sessionId: z.string().optional(),
  systemInstructions: z.string().max(10000).optional(),
});
export const useRuns = () => useApiPages("runs", "/v1/runs", runSchema, 4000);
export const useRun = (id: string) =>
  useApiQuery("runs", `/v1/runs/${id}`, runSchema, !!id, 4000);
export const useCreateRun = () =>
  useApiAction(
    "runs",
    (client, input: z.infer<typeof createRunSchema>) =>
      client.createRun(
        {
          ...input,
          sessionId: input.sessionId || undefined,
          model: input.model || undefined,
          systemInstructions: input.systemInstructions || undefined,
        },
        { idempotencyKey: crypto.randomUUID() },
      ),
    runSchema,
    "Agent run queued",
  );
export const useCancelRun = () =>
  useApiAction(
    "runs",
    (client, id: string) => client.cancelRun(id),
    cancellationSchema,
    "Cancellation requested",
  );
export const useResumeRun = () =>
  useApiAction(
    "runs",
    (client, id: string) => client.resumeRun(id, true),
    runSchema,
    "Agent run resumed",
  );
export const useReplayRun = () =>
  useApiAction(
    "runs",
    (client, id: string) => client.replayRun(id),
    z.object({ reconstructedStatus: z.string(), events: z.array(eventSchema) }),
    "Replay loaded",
  );
export const useExportCheckpoint = () =>
  useApiAction(
    "runs",
    (client, id: string) => client.exportCheckpoint(id),
    artifactSchema,
    "Checkpoint saved to Artifacts",
  );
export function useRunEvents(id: string) {
  const client = useApiClient();
  const organizationId = useWorkspaceStore((state) => state.organizationId);
  const queries = useQueryClient();
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const value of client.events(id, {
          signal: controller.signal,
        })) {
          const event = eventSchema.parse(value);
          queries.setQueryData<z.infer<typeof eventSchema>[]>(
            ["workspace", organizationId, "run-events", id],
            (current = []) =>
              current.some((item) => item.sequence === event.sequence)
                ? current
                : [...current.slice(-499), event],
          );
        }
      } catch (error) {
        if (!controller.signal.aborted)
          await queries.invalidateQueries({
            queryKey: ["workspace", organizationId, "runs"],
          });
      }
    })();
    return () => controller.abort();
  }, [id, client, organizationId, queries]);
  return useQuery({
    queryKey: ["workspace", organizationId, "run-events", id],
    queryFn: async () => [] as z.infer<typeof eventSchema>[],
    enabled: false,
  });
}
