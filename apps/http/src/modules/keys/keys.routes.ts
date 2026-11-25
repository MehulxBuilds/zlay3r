import { readPage, cursorFilter, sendPage } from "../../lib/pagination";
import { sql, desc } from "@repo/db";
import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db, and, eq, apiKey, tokenDigest } from "@repo/db";
import { authorize } from "../platform/authorization";
import { HttpError } from "../../lib/errors";
import type { SandboxProvider } from "@repo/sandbox";
import { idParams } from "../platform/platform.contracts";
const keyScopes = z.enum([
  "sandbox.read",
  "sandbox.write",
  "sandbox.execute",
  "execution.read",
  "files.read",
  "files.write",
  "artifacts.read",
  "artifacts.write",
  "runs.read",
  "runs.write",
  "sessions.read",
  "sessions.write",
  "browser.read",
  "browser.write",
  "models.read",
  "models.use",
  "mcp.execute",
  "tools.read",
  "events.read",
  "secrets.use",
]);
export async function registerKeysRoutes(
  app: FastifyInstance,
  _provider: SandboxProvider,
) {
  app.get("/api-keys", async (request, reply) => {
    authorize(request, "keys.admin");
    const page = readPage(request.query, []);
    const rows = await db
      .select({
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
        revokedAt: apiKey.revokedAt,
        createdAt: apiKey.createdAt,
      })
      .from(apiKey)
      .where(
        and(
          eq(apiKey.organizationId, request.user.organizationId),
          cursorFilter(apiKey.createdAt, apiKey.id, page),
        ),
      )
      .orderBy(desc(apiKey.createdAt), desc(apiKey.id))
      .limit(page.limit);
    return sendPage(reply, rows, page.limit);
  });
  app.post(
    "/api-keys",
    {
      schema: {
        body: bodySchema(
          z.object({
            name: z.string().min(1).max(100),
            scopes: z.array(keyScopes).min(1).max(30),
            expiresAt: z.iso.datetime().optional(),
          }),
        ),
      },
    },
    async (request, reply) => {
      authorize(request, "keys.admin");
      const input = z
        .object({
          name: z.string().min(1).max(100),
          scopes: z.array(keyScopes).min(1).max(30),
          expiresAt: z.iso.datetime().optional(),
        })
        .parse(request.body);
      const token = `zk_${randomBytes(32).toString("base64url")}`;
      const [record] = await db
        .insert(apiKey)
        .values({
          name: input.name,
          scopes: input.scopes,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          organizationId: request.user.organizationId,
          prefix: token.slice(0, 10),
          keyHash: tokenDigest(token),
        })
        .returning({ id: apiKey.id, name: apiKey.name });
      reply.header("cache-control", "no-store");
      return reply.code(201).send({ ...record, token });
    },
  );
  app.delete("/api-keys/:id", async (request, reply) => {
    authorize(request, "keys.admin");
    const { id } = idParams.parse(request.params);
    await db
      .update(apiKey)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKey.id, id),
          eq(apiKey.organizationId, request.user.organizationId),
        ),
      );
    return reply.code(204).send();
  });
  app.post("/api-keys/:id/rotate", async (request, reply) => {
    authorize(request, "keys.admin");
    const { id } = idParams.parse(request.params);
    const token = `zk_${randomBytes(32).toString("base64url")}`;
    const created = await db.transaction(async (tx) => {
      const [existing] = await tx
        .update(apiKey)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiKey.id, id),
            eq(apiKey.organizationId, request.user.organizationId),
            sql`${apiKey.revokedAt} is null`,
          ),
        )
        .returning();
      if (!existing) throw new HttpError(404, "API_KEY_NOT_FOUND");
      const [record] = await tx
        .insert(apiKey)
        .values({
          organizationId: existing.organizationId,
          name: existing.name,
          scopes: existing.scopes,
          expiresAt: existing.expiresAt,
          prefix: token.slice(0, 10),
          keyHash: tokenDigest(token),
        })
        .returning({ id: apiKey.id, name: apiKey.name });
      return record;
    });
    reply.header("cache-control", "no-store");
    return reply.code(201).send({ ...created, token });
  });
}
