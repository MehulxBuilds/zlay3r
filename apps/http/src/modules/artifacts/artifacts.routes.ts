import { readPage, cursorFilter, sendPage } from "../../lib/pagination";
import { sql, desc } from "@repo/db";
import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, and, eq, artifact } from "@repo/db";
import { authorize } from "../platform/authorization";
import { downloadArtifact, uploadArtifact } from "@repo/storage";
import { removeArtifact } from "@repo/storage";
import type { SandboxProvider } from "@repo/sandbox";
import { idParams } from "../platform/platform.contracts";
export async function registerArtifactsRoutes(
  app: FastifyInstance,
  _provider: SandboxProvider,
) {
  app.delete("/artifacts/:id", async (request, reply) => {
    authorize(request, "artifacts.write");
    const { id } = idParams.parse(request.params);
    await removeArtifact(request.user.organizationId, id);
    return reply.code(204).send();
  });
  app.get("/artifacts", async (request, reply) => {
    authorize(request, "artifacts.read");
    const page = readPage(request.query, ["UPLOADING", "READY", "FAILED"]);
    const rows = await db
      .select({
        id: artifact.id,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
        size: artifact.size,
        status: artifact.status,
        sandboxId: artifact.sandboxId,
        runId: artifact.runId,
        createdAt: artifact.createdAt,
      })
      .from(artifact)
      .where(
        and(
          eq(artifact.organizationId, request.user.organizationId),
          cursorFilter(artifact.createdAt, artifact.id, page),
          page.status ? sql`${artifact.status} = ${page.status}` : undefined,
        ),
      )
      .orderBy(desc(artifact.createdAt), desc(artifact.id))
      .limit(page.limit);
    return sendPage(reply, rows, page.limit);
  });
  app.post(
    "/artifacts",
    {
      ...{ bodyLimit: 12 * 1048576 },
      schema: {
        body: bodySchema(
          z.object({
            filename: z.string().min(1).max(255),
            mimeType: z.string().min(1).max(100),
            data: z.string().max(12 * 1048576),
          }),
        ),
      },
    },
    async (request, reply) => {
      authorize(request, "artifacts.write");
      const input = z
        .object({
          filename: z.string().min(1).max(255),
          mimeType: z.string().min(1).max(100),
          data: z.string().max(12 * 1048576),
        })
        .parse(request.body);
      return reply.code(201).send(
        await uploadArtifact(request.user.organizationId, {
          ...input,
          data: Buffer.from(input.data, "base64"),
        }),
      );
    },
  );
  app.get("/artifacts/:id/download", async (request) => {
    authorize(request, "artifacts.read");
    const { id } = idParams.parse(request.params);
    return downloadArtifact(request.user.organizationId, id);
  });
}
