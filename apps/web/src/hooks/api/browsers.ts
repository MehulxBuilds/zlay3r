"use client";
import { z } from "zod";
import { browserSchema, jsonObjectSchema } from "@repo/web/lib/schemas";
import { useApiPages, useApiAction, noContentSchema } from "./core";
export const useBrowsers = () =>
  useApiPages("browsers", "/v1/browsers", browserSchema, 5000);
export const useCreateBrowser = () =>
  useApiAction(
    "browsers",
    (client, input: { sandboxId: string }) =>
      client.createBrowser(input.sandboxId),
    browserSchema,
    "Browser session opened",
  );
export const browserActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("navigate"), url: z.url() }),
  z.object({ action: z.literal("click"), selector: z.string().min(1) }),
  z.object({
    action: z.literal("type"),
    selector: z.string().min(1),
    text: z.string(),
  }),
  z.object({
    action: z.literal("scroll"),
    y: z.coerce.number().min(-10000).max(10000),
  }),
  z.object({ action: z.literal("download"), selector: z.string().min(1) }),
  ...["inspect", "screenshot", "persist", "restore"].map((action) =>
    z.object({ action: z.literal(action) }),
  ),
]);
export const useBrowserAction = () =>
  useApiAction(
    "browsers",
    (
      client,
      input: { id: string; action: z.infer<typeof browserActionSchema> },
    ) =>
      client.browserAction(input.id, browserActionSchema.parse(input.action)),
    jsonObjectSchema,
    "Browser action completed",
  );
export const useCloseBrowser = () =>
  useApiAction(
    "browsers",
    (client, id: string) => client.closeBrowser(id),
    noContentSchema,
    "Browser session closed",
  );
