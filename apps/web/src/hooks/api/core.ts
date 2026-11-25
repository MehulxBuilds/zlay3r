"use client";
import { useMemo } from "react";
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import { AgentPlatformClient } from "@repo/sdk";
import { toast } from "@repo/ui";
import { web_env } from "@repo/web/lib/env";
import { errorMessage } from "@repo/web/lib/format";
import { useWorkspaceStore } from "@repo/web/stores/workspace-store";

export function useApiClient() {
  const organizationId = useWorkspaceStore((state) => state.organizationId);
  return useMemo(
    () =>
      new AgentPlatformClient({
        baseUrl: web_env.NEXT_PUBLIC_API_BASE,
        organizationId: organizationId || undefined,
      }),
    [organizationId],
  );
}
export function useApiQuery<T>(
  module: string,
  path: string,
  schema: z.ZodType<T>,
  enabled = true,
  refetchInterval?: number,
) {
  const organizationId = useWorkspaceStore((state) => state.organizationId);
  const client = useApiClient();
  return useQuery({
    queryKey: ["workspace", organizationId, module, path],
    queryFn: async ({ signal }) =>
      schema.parse(await client.request<unknown>(path, {}, { signal })),
    enabled: !!organizationId && enabled,
    refetchInterval,
  });
}
export function useApiPages<T>(
  module: string,
  path: string,
  schema: z.ZodType<T>,
  refetchInterval?: number,
) {
  const organizationId = useWorkspaceStore((state) => state.organizationId);
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: ["workspace", organizationId, module, "list", path],
    initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }) => {
      const page = await client
        .withSignal(signal)
        .page<unknown>(path, { cursor: pageParam ?? undefined, limit: 30 });
      return {
        items: z.array(schema).parse(page.items),
        nextCursor: z.string().nullable().parse(page.nextCursor),
      };
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: !!organizationId,
    refetchInterval,
  });
}
export function useApiAction<I, O>(
  module: string,
  work: (client: AgentPlatformClient, input: I) => Promise<unknown>,
  schema: z.ZodType<O>,
  acknowledgement: string,
) {
  const client = useApiClient();
  const organizationId = useWorkspaceStore((state) => state.organizationId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["workspace", organizationId, module],
    mutationFn: async (input: I) => schema.parse(await work(client, input)),
    onSuccess: async () => {
      useWorkspaceStore.getState().setMutationError(null);
      if (acknowledgement) toast.success(acknowledgement);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["workspace", organizationId],
        }),
        queryClient.invalidateQueries({ queryKey: ["organizations"] }),
      ]);
    },
    onError: (error) =>
      useWorkspaceStore.getState().setMutationError(errorMessage(error)),
  });
}
export const noContentSchema = z.void();
export const cancellationSchema = z.object({
  cancellationRequested: z.literal(true),
});
export function post(
  client: AgentPlatformClient,
  path: string,
  body?: unknown,
) {
  return client.request<unknown>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export function put(client: AgentPlatformClient, path: string, body: unknown) {
  return client.request<unknown>(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
export function remove(client: AgentPlatformClient, path: string) {
  return client.request<unknown>(path, { method: "DELETE" });
}
