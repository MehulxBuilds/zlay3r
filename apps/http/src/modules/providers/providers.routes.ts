import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, and, eq, providerConfiguration, encrypt } from "@repo/db";
import { authorize } from "../platform/authorization";
import type { SandboxProvider } from "@repo/sandbox";
import { providers, safeProvider } from "../platform/platform.contracts";
export async function registerProvidersRoutes(
  app: FastifyInstance,
  provider: SandboxProvider,
) {
  app.get("/providers", async (request) => {
    authorize(request, "models.read");
    return (
      await db
        .select()
        .from(providerConfiguration)
        .where(
          eq(providerConfiguration.organizationId, request.user.organizationId),
        )
    ).map(safeProvider);
  });
  app.put(
    "/providers/:provider",
    {
      schema: {
        body: bodySchema(
          z.object({
            model: z.string().min(1).max(200),
            apiKey: z.string().min(1).max(4096),
            settings: z
              .object({
                routing: z.record(z.string(), z.unknown()).optional(),
                aliases: z.record(z.string(), z.string()).optional(),
                fallbacks: z.array(providers).max(3).optional(),
                inputPricePerMillion: z.number().nonnegative().optional(),
                outputPricePerMillion: z.number().nonnegative().optional(),
              })
              .default({}),
          }),
        ),
      },
    },
    async (request) => {
      authorize(request, "providers.admin");
      const { provider } = z
        .object({ provider: providers })
        .parse(request.params);
      const input = z
        .object({
          model: z.string().min(1).max(200),
          apiKey: z.string().min(1).max(4096),
          settings: z
            .object({
              routing: z.record(z.string(), z.unknown()).optional(),
              aliases: z.record(z.string(), z.string()).optional(),
              fallbacks: z.array(providers).max(3).optional(),
              inputPricePerMillion: z.number().nonnegative().optional(),
              outputPricePerMillion: z.number().nonnegative().optional(),
            })
            .default({}),
        })
        .parse(request.body);
      const values = {
        organizationId: request.user.organizationId,
        provider,
        model: input.model,
        credential: encrypt(input.apiKey, request.user.organizationId),
        settings: input.settings,
      };
      const [record] = await db
        .insert(providerConfiguration)
        .values(values)
        .onConflictDoUpdate({
          target: [
            providerConfiguration.organizationId,
            providerConfiguration.provider,
          ],
          set: values,
        })
        .returning();
      return safeProvider(record!);
    },
  );
  app.delete("/providers/:provider", async (request, reply) => {
    authorize(request, "providers.admin");
    const { provider } = z
      .object({ provider: providers })
      .parse(request.params);
    await db
      .delete(providerConfiguration)
      .where(
        and(
          eq(providerConfiguration.organizationId, request.user.organizationId),
          eq(providerConfiguration.provider, provider),
        ),
      );
    return reply.code(204).send();
  });
}
