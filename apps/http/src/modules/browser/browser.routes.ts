import { readPage, cursorFilter, sendPage } from "../../lib/pagination";
import { sql, desc } from "@repo/db";
import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  and,
  db,
  eq,
  browserSession,
  sandbox,
  encrypt,
  decrypt,
} from "@repo/db";
import type { SandboxProvider } from "@repo/sandbox";
import { executionPolicy, evaluateAction } from "@repo/db";
import { authorize } from "../platform/authorization";
import { uploadArtifact } from "@repo/storage";
import { HttpError } from "../../lib/errors";

export async function registerBrowserRoutes(
  app: FastifyInstance,
  provider: SandboxProvider,
) {
  async function context(org: string, id: string) {
    const [session] = await db
      .select()
      .from(browserSession)
      .where(
        and(eq(browserSession.id, id), eq(browserSession.organizationId, org)),
      )
      .limit(1);
    if (!session) throw new HttpError(404, "BROWSER_NOT_FOUND");
    const [box] = await db
      .select()
      .from(sandbox)
      .where(
        and(
          eq(sandbox.id, session.sandboxId),
          eq(sandbox.organizationId, org),
          eq(sandbox.status, "RUNNING"),
        ),
      )
      .limit(1);
    if (!box?.resourceId) throw new HttpError(409, "SANDBOX_NOT_READY");
    return { session, box };
  }
  app.get("/browsers", async (request, reply) => {
    authorize(request, "browser.read");
    const page = readPage(request.query, ["OPEN", "CLOSED"]);
    const rows = await db
      .select({
        id: browserSession.id,
        sandboxId: browserSession.sandboxId,
        status: browserSession.status,
        createdAt: browserSession.createdAt,
      })
      .from(browserSession)
      .where(
        and(
          eq(browserSession.organizationId, request.user.organizationId),
          cursorFilter(browserSession.createdAt, browserSession.id, page),
          page.status
            ? sql`${browserSession.status} = ${page.status}`
            : undefined,
        ),
      )
      .orderBy(desc(browserSession.createdAt), desc(browserSession.id))
      .limit(page.limit);
    return sendPage(reply, rows, page.limit);
  });
  app.post(
    "/browsers",
    {
      schema: { body: bodySchema(z.object({ sandboxId: z.string().uuid() })) },
    },
    async (request, reply) => {
      authorize(request, "browser.write");
      const [policy] = await db
        .select()
        .from(executionPolicy)
        .where(eq(executionPolicy.organizationId, request.user.organizationId))
        .limit(1);
      if (!policy?.allowedTools.some((name) => name.startsWith("browser_")))
        throw new HttpError(403, "BROWSER_POLICY_DENIED");
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.body);
      const [box] = await db
        .select()
        .from(sandbox)
        .where(
          and(
            eq(sandbox.id, sandboxId),
            eq(sandbox.organizationId, request.user.organizationId),
            eq(sandbox.status, "RUNNING"),
          ),
        )
        .limit(1);
      if (!box?.resourceId) throw new HttpError(404, "SANDBOX_NOT_FOUND");
      const id = randomUUID();
      await provider.service(box.resourceId, { op: "browser.create", id });
      try {
        const [record] = await db
          .insert(browserSession)
          .values({
            id,
            sandboxId,
            organizationId: request.user.organizationId,
          })
          .returning({
            id: browserSession.id,
            status: browserSession.status,
            sandboxId: browserSession.sandboxId,
            createdAt: browserSession.createdAt,
          });
        return reply.code(201).send(record);
      } catch (error) {
        await provider.service(box.resourceId, { op: "browser.close", id });
        throw error;
      }
    },
  );
  app.post(
    "/browsers/:id/actions",
    {
      schema: {
        body: bodySchema(
          z.discriminatedUnion("action", [
            z.object({ action: z.literal("navigate"), url: z.url().max(4096) }),
            z.object({
              action: z.literal("click"),
              selector: z.string().min(1).max(1000),
            }),
            z.object({
              action: z.literal("type"),
              selector: z.string().min(1).max(1000),
              text: z.string().max(10000),
            }),
            z.object({
              action: z.literal("scroll"),
              y: z.number().min(-10000).max(10000),
            }),
            z.object({ action: z.literal("inspect") }),
            z.object({ action: z.literal("screenshot") }),
            z.object({
              action: z.literal("download"),
              selector: z.string().min(1).max(1000),
            }),
            z.object({ action: z.literal("persist") }),
            z.object({ action: z.literal("restore") }),
          ]),
        ),
      },
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const action = z
        .discriminatedUnion("action", [
          z.object({ action: z.literal("navigate"), url: z.url().max(4096) }),
          z.object({
            action: z.literal("click"),
            selector: z.string().min(1).max(1000),
          }),
          z.object({
            action: z.literal("type"),
            selector: z.string().min(1).max(1000),
            text: z.string().max(10000),
          }),
          z.object({
            action: z.literal("scroll"),
            y: z.number().min(-10000).max(10000),
          }),
          z.object({ action: z.literal("inspect") }),
          z.object({ action: z.literal("screenshot") }),
          z.object({
            action: z.literal("download"),
            selector: z.string().min(1).max(1000),
          }),
          z.object({ action: z.literal("persist") }),
          z.object({ action: z.literal("restore") }),
        ])
        .parse(request.body);
      authorize(
        request,
        action.action === "inspect" ? "browser.read" : "browser.write",
      );
      const { session, box } = await context(request.user.organizationId, id);
      const tool =
        action.action === "navigate"
          ? "browser_navigate"
          : action.action === "inspect"
            ? "browser_inspect"
            : action.action === "screenshot"
              ? "browser_screenshot"
              : action.action === "download"
                ? "browser_download"
                : "browser_interact";
      const decision = await evaluateAction(
        request.user.organizationId,
        tool,
        action,
        box.id,
      );
      if (!decision.allowed)
        throw new HttpError(409, decision.reason!, {
          approvalId: decision.approvalId,
        });
      if (action.action === "persist") {
        const state = await provider.service<{ state: unknown }>(
          box.resourceId!,
          { op: "browser.state", id },
        );
        await db
          .update(browserSession)
          .set({
            encryptedState: encrypt(
              JSON.stringify(state.state),
              request.user.organizationId,
            ),
          })
          .where(eq(browserSession.id, id));
        return { persisted: true };
      }
      if (action.action === "restore") {
        if (!session.encryptedState)
          throw new HttpError(409, "NO_SAVED_BROWSER_STATE");
        return provider.service(box.resourceId!, {
          op: "browser.create",
          id,
          state: JSON.parse(
            decrypt(session.encryptedState, request.user.organizationId),
          ),
        });
      }
      if (["screenshot", "download"].includes(action.action))
        authorize(request, "artifacts.write");
      const result = await provider.service<Record<string, unknown>>(
        box.resourceId!,
        { ...action, op: `browser.${action.action}`, id },
      );
      if (action.action === "screenshot" || action.action === "download") {
        return uploadArtifact(request.user.organizationId, {
          data: Buffer.from(result.data as string, "base64"),
          filename:
            action.action === "screenshot"
              ? `${id}.png`
              : (result.filename as string),
          mimeType:
            action.action === "screenshot"
              ? "image/png"
              : "application/octet-stream",
          sandboxId: box.id,
        });
      }
      return result;
    },
  );
  app.delete("/browsers/:id", async (request, reply) => {
    authorize(request, "browser.write");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { box } = await context(request.user.organizationId, id);
    await provider.service(box.resourceId!, { op: "browser.close", id });
    await db
      .update(browserSession)
      .set({ status: "CLOSED", encryptedState: null })
      .where(
        and(
          eq(browserSession.id, id),
          eq(browserSession.organizationId, request.user.organizationId),
        ),
      );
    return reply.code(204).send();
  });
}
