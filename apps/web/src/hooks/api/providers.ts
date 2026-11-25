"use client";
import { z } from "zod";
import { providerSchema, providerNameSchema } from "@repo/web/lib/schemas";
import { useApiQuery, useApiAction, noContentSchema, remove } from "./core";
export const useProviders = () =>
  useApiQuery("providers", "/v1/providers", z.array(providerSchema));
export const providerFormSchema = z.object({
  provider: providerNameSchema,
  model: z.string().min(1).max(200),
  apiKey: z.string().min(1).max(4096),
  fallbacks: z.array(providerNameSchema).max(3).default([]),
  aliases: z
    .array(z.string().regex(/^[^=]+=.+$/, "Add aliases as name=model"))
    .default([]),
  routingOrder: z.array(z.string()).default([]),
  inputPrice: z.string().optional(),
  outputPrice: z.string().optional(),
});
export const useConfigureProvider = () =>
  useApiAction(
    "providers",
    (client, input: z.infer<typeof providerFormSchema>) => {
      const aliases = Object.fromEntries(
        input.aliases.map((value) => {
          const [alias, ...model] = value.split("=");
          return [
            z.string().min(1).parse(alias),
            z.string().min(1).parse(model.join("=")),
          ];
        }),
      );
      return client.configureProvider(input.provider, {
        model: input.model,
        apiKey: input.apiKey,
        settings: {
          aliases,
          fallbacks: input.fallbacks,
          ...(input.routingOrder.length
            ? { routing: { order: input.routingOrder, allow_fallbacks: false } }
            : {}),
          ...(input.inputPrice
            ? {
                inputPricePerMillion: z.coerce
                  .number()
                  .nonnegative()
                  .parse(input.inputPrice),
              }
            : {}),
          ...(input.outputPrice
            ? {
                outputPricePerMillion: z.coerce
                  .number()
                  .nonnegative()
                  .parse(input.outputPrice),
              }
            : {}),
        },
      });
    },
    providerSchema,
    "Model provider configured",
  );
export const useDeleteProvider = () =>
  useApiAction(
    "providers",
    (client, provider: string) => remove(client, `/v1/providers/${provider}`),
    noContentSchema,
    "Provider removed",
  );
