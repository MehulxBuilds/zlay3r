import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  db,
  and,
  eq,
  desc,
  asc,
  sql,
  agentSession,
  message,
  agentRun,
} from "@repo/db";
import { authorize } from "../platform/authorization";
import { HttpError } from "../../lib/errors";
import type { SandboxProvider } from "@repo/sandbox";
import { idParams } from "../platform/platform.contracts";
import { readPage, cursorFilter } from "../../lib/pagination";
export async function registerSessionsRoutes(
  app: FastifyInstance,
  _provider: SandboxProvider,
) {
  app.get("/sessions", async (request) => {
    authorize(request, "sessions.read");
    const options = readPage(request.query);
    const { limit } = options;
    const items = await db
      .select()
      .from(agentSession)
      .where(
        and(
          eq(agentSession.organizationId, request.user.organizationId),
          cursorFilter(agentSession.createdAt, agentSession.id, options),
        ),
      )
      .orderBy(desc(agentSession.createdAt), desc(agentSession.id))
      .limit(limit + 1);
    return {
      items: items.slice(0, limit),
      nextCursor:
        items.length > limit
          ? Buffer.from(
              JSON.stringify({
                id: items[limit - 1]!.id,
                createdAt: items[limit - 1]!.createdAt.toISOString(),
              }),
            ).toString("base64url")
          : null,
    };
  });
  app.post(
    "/sessions",
    {
      schema: {
        body: bodySchema(
          z.object({ title: z.string().trim().min(1).max(200) }),
        ),
      },
    },
    async (request, reply) => {
      authorize(request, "sessions.write");
      const input = z
        .object({ title: z.string().trim().min(1).max(200) })
        .parse(request.body);
      return reply.code(201).send(
        (
          await db
            .insert(agentSession)
            .values({
              ...input,
              organizationId: request.user.organizationId,
              userId: request.apiScopes ? null : request.user.id,
              apiKeyId: request.apiScopes ? request.user.id : null,
            })
            .returning()
        )[0],
      );
    },
  );
  app.get("/sessions/:id", async (request) => {
    authorize(request, "sessions.read");
    const { id } = idParams.parse(request.params);
    const [record] = await db
      .select()
      .from(agentSession)
      .where(
        and(
          eq(agentSession.id, id),
          eq(agentSession.organizationId, request.user.organizationId),
        ),
      )
      .limit(1);
    if (!record) throw new HttpError(404, "SESSION_NOT_FOUND");
    return {
      ...record,
      messages: await db
        .select()
        .from(message)
        .where(eq(message.sessionId, id))
        .orderBy(asc(message.createdAt)),
      runs: await db
        .select()
        .from(agentRun)
        .where(
          and(
            eq(agentRun.sessionId, id),
            eq(agentRun.organizationId, request.user.organizationId),
          ),
        )
        .orderBy(desc(agentRun.createdAt)),
    };
  });
  app.delete("/sessions/:id", async (request, reply) => {
    authorize(request, "sessions.write");
    const { id } = idParams.parse(request.params);
    const active = await db
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(
        and(
          eq(agentRun.sessionId, id),
          eq(agentRun.organizationId, request.user.organizationId),
          sql`${agentRun.status} in ('RUNNING','QUEUED','AWAITING_APPROVAL')`,
        ),
      )
      .limit(1);
    if (active.length) throw new HttpError(409, "SESSION_HAS_ACTIVE_RUNS");
    await db
      .delete(agentSession)
      .where(
        and(
          eq(agentSession.id, id),
          eq(agentSession.organizationId, request.user.organizationId),
        ),
      );
    return reply.code(204).send();
  });
}
