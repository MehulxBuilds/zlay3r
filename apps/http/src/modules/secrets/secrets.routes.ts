import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, and, eq, secret, encrypt } from "@repo/db";
import { authorize } from "../platform/authorization";
import type { SandboxProvider } from "@repo/sandbox";
import { idParams } from "../platform/platform.contracts";
export async function registerSecretsRoutes(
  app: FastifyInstance,
  _provider: SandboxProvider,
) {
  app.get("/secrets", async (request) => {
    authorize(request, "secrets.admin");
    return db
      .select({ id: secret.id, name: secret.name, createdAt: secret.createdAt })
      .from(secret)
      .where(eq(secret.organizationId, request.user.organizationId));
  });
  app.put(
    "/secrets/:name",
    {
      schema: {
        body: bodySchema(z.object({ value: z.string().min(1).max(16384) })),
      },
    },
    async (request, reply) => {
      authorize(request, "secrets.admin");
      const { name } = z
        .object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/) })
        .parse(request.params);
      const { value } = z
        .object({ value: z.string().min(1).max(16384) })
        .parse(request.body);
      const values = {
        organizationId: request.user.organizationId,
        name,
        ciphertext: encrypt(value, request.user.organizationId),
      };
      await db
        .insert(secret)
        .values(values)
        .onConflictDoUpdate({
          target: [secret.organizationId, secret.name],
          set: { ciphertext: values.ciphertext },
        });
      return reply.code(204).send();
    },
  );
  app.delete("/secrets/:id", async (request, reply) => {
    authorize(request, "secrets.admin");
    const { id } = idParams.parse(request.params);
    await db
      .delete(secret)
      .where(
        and(
          eq(secret.id, id),
          eq(secret.organizationId, request.user.organizationId),
        ),
      );
    return reply.code(204).send();
  });
}
