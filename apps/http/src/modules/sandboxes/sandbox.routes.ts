import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SandboxService } from "./sandbox.service";
import { readPage, sendPage } from "../../lib/pagination";
import { authorize } from "../platform/authorization";

import { createSandboxSchema } from "./sandbox.validation";

const params = z.object({ id: z.string().min(1).max(100) });
export function registerSandboxRoutes(
  app: FastifyInstance,
  service: SandboxService,
) {
  app.get("/sandboxes", async (request, reply) => {
    authorize(request, "sandbox.read");
    const page = readPage(request.query, [
      "CREATING",
      "RUNNING",
      "STOPPED",
      "PAUSED",
      "DESTROYED",
      "FAILED",
    ]);
    return sendPage(
      reply,
      await service.list(request.user.organizationId, page),
      page.limit,
    );
  });
  app.post(
    "/sandboxes",
    {
      schema: {
        body: bodySchema(createSandboxSchema),
      },
    },
    async (request, reply) => {
      authorize(request, "sandbox.write");
      const input = createSandboxSchema.parse(request.body);
      return reply
        .code(201)
        .send(await service.create(request.user.organizationId, input));
    },
  );
  app.post(
    "/sandboxes/:id/exec",
    {
      schema: {
        body: bodySchema(
          z.object({ command: z.string().trim().min(1).max(4000) }),
        ),
      },
    },
    async (request) => {
      authorize(request, "sandbox.execute");
      const { id } = params.parse(request.params);
      const { command } = z
        .object({ command: z.string().trim().min(1).max(4000) })
        .parse(request.body);
      return service.execute(request.user.organizationId, id, command);
    },
  );
  app.delete("/sandboxes/:id", async (request, reply) => {
    authorize(request, "sandbox.write");
    const { id } = params.parse(request.params);
    await service.destroy(request.user.organizationId, id);
    return reply.code(204).send();
  });
}
