import { readPage, cursorFilter, sendPage } from "../../lib/pagination";
import { desc } from "@repo/db";
import type { FastifyInstance } from "fastify";
import { db, and, eq, auditRecord, platformEvent } from "@repo/db";
import { authorize } from "../platform/authorization";
import type { SandboxProvider } from "@repo/sandbox";
export async function registerAuditRoutes(
  app: FastifyInstance,
  _provider: SandboxProvider,
) {
  app.get("/audit", async (request, reply) => {
    authorize(request, "audit.admin");
    const page = readPage(request.query, []);
    const rows = await db
      .select()
      .from(auditRecord)
      .where(
        and(
          eq(auditRecord.organizationId, request.user.organizationId),
          cursorFilter(auditRecord.createdAt, auditRecord.id, page),
        ),
      )
      .orderBy(desc(auditRecord.createdAt), desc(auditRecord.id))
      .limit(page.limit);
    return sendPage(reply, rows, page.limit);
  });
  app.get("/activity", async (request, reply) => {
    authorize(request, "events.read");
    const page = readPage(request.query, []);
    const rows = await db
      .select()
      .from(platformEvent)
      .where(
        and(
          eq(platformEvent.organizationId, request.user.organizationId),
          cursorFilter(platformEvent.createdAt, platformEvent.id, page),
        ),
      )
      .orderBy(desc(platformEvent.createdAt), desc(platformEvent.id))
      .limit(page.limit);
    return sendPage(reply, rows, page.limit);
  });
}
