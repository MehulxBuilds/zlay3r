import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, db, eq, sandbox, evaluateAction } from "@repo/db";
import type { SandboxProvider } from "@repo/sandbox";
import { authorize } from "../platform/authorization";
import { uploadArtifact } from "@repo/storage";
import { HttpError } from "../../lib/errors";
const params = z.object({ id: z.string().uuid() });
export async function registerFilesystemRoutes(
  app: FastifyInstance,
  provider: SandboxProvider,
) {
  async function find(org: string, id: string) {
    const [record] = await db
      .select()
      .from(sandbox)
      .where(and(eq(sandbox.id, id), eq(sandbox.organizationId, org)))
      .limit(1);
    if (!record?.resourceId) throw new HttpError(404, "SANDBOX_NOT_FOUND");
    return record;
  }
  app.post(
    "/sandboxes/:id/files",
    {
      ...{ bodyLimit: 12 * 1048576 },
      schema: {
        body: bodySchema(
          z.object({
            op: z.enum([
              "read",
              "write",
              "list",
              "mkdir",
              "delete",
              "move",
              "stat",
            ]),
            path: z.string().max(4096).default("."),
            data: z
              .string()
              .max(12 * 1048576)
              .optional(),
            destination: z.string().max(4096).optional(),
          }),
        ),
      },
    },
    async (request) => {
      const { id } = params.parse(request.params);
      const input = z
        .object({
          op: z.enum([
            "read",
            "write",
            "list",
            "mkdir",
            "delete",
            "move",
            "stat",
          ]),
          path: z.string().max(4096).default("."),
          data: z
            .string()
            .max(12 * 1048576)
            .optional(),
          destination: z.string().max(4096).optional(),
        })
        .parse(request.body);
      authorize(
        request,
        ["read", "list", "stat"].includes(input.op)
          ? "files.read"
          : "files.write",
      );
      if (
        (input.op === "write" && input.data === undefined) ||
        (input.op === "move" && !input.destination)
      )
        throw new HttpError(400, "MISSING_FILE_ARGUMENT");
      const record = await find(request.user.organizationId, id);
      const decision = await evaluateAction(
        request.user.organizationId,
        input.op === "list"
          ? "list_directory"
          : ["read", "stat"].includes(input.op)
            ? "read_file"
            : "write_file",
        input,
        id,
      );
      if (!decision.allowed)
        throw new HttpError(409, decision.reason!, {
          approvalId: decision.approvalId,
        });
      return provider.file(record.resourceId!, input);
    },
  );
  app.post(
    "/sandboxes/:id/artifacts",
    {
      schema: {
        body: bodySchema(
          z.object({
            path: z.string().min(1).max(4096),
            filename: z.string().min(1).max(255),
            mimeType: z.string().max(100).default("application/octet-stream"),
          }),
        ),
      },
    },
    async (request, reply) => {
      authorize(request, "artifacts.write");
      authorize(request, "files.read");
      const { id } = params.parse(request.params);
      const input = z
        .object({
          path: z.string().min(1).max(4096),
          filename: z.string().min(1).max(255),
          mimeType: z.string().max(100).default("application/octet-stream"),
        })
        .parse(request.body);
      const record = await find(request.user.organizationId, id);
      const file = await provider.file<{ data: string }>(record.resourceId!, {
        op: "read",
        path: input.path,
      });
      return reply.code(201).send(
        await uploadArtifact(request.user.organizationId, {
          ...input,
          sandboxId: id,
          data: Buffer.from(file.data, "base64"),
        }),
      );
    },
  );
}
