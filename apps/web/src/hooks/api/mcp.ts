"use client";
import { z } from "zod";
import { mcpSchema, toolSchema } from "@repo/web/lib/schemas";
import { useApiQuery, useApiAction, noContentSchema, remove } from "./core";
export const useMcpServers = () =>
  useApiQuery("mcp", "/v1/mcp-servers", z.array(mcpSchema));
export const mcpFormSchema = z.object({
  name: z.string().min(1),
  url: z
    .url()
    .refine((value) => value.startsWith("https://"), "Use an HTTPS endpoint"),
  authorizationSecret: z.string().optional(),
});
export const useCreateMcp = () =>
  useApiAction(
    "mcp",
    (client, input: z.infer<typeof mcpFormSchema>) =>
      client.configureMcp(input.name, {
        transport: "http",
        url: input.url,
        authorizationSecret: input.authorizationSecret || undefined,
      }),
    mcpSchema,
    "MCP connection added",
  );
export const useDiscoverMcp = () =>
  useApiAction(
    "mcp",
    (client, id: string) => client.discoverMcpTools(id),
    z.array(toolSchema.extend({ platformName: z.string() })),
    "Tools discovered",
  );
export const useDeleteMcp = () =>
  useApiAction(
    "mcp",
    (client, id: string) => remove(client, `/v1/mcp-servers/${id}`),
    noContentSchema,
    "MCP connection removed",
  );
