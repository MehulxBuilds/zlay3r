import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SandboxService } from "./sandbox.service";

const params = z.object({ id: z.string().min(1).max(100) });
export function registerSandboxRoutes(
  app: FastifyInstance,
  service: SandboxService,
) {
  app.get("/sandboxes", (request) => service.list(request.user.organizationId));
  app.post("/sandboxes", async (request, reply) => {
    const input = z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .regex(/^[a-zA-Z0-9_-]+$/)
          .default("sandbox"),
        memoryMb: z.number().int().min(128).max(2048).default(512),
        cpu: z.number().min(0.25).max(2).default(1),
      })
      .parse(request.body);
    return reply
      .code(201)
      .send(await service.create(request.user.organizationId, input));
  });
  app.post("/sandboxes/:id/exec", async (request) => {
    const { id } = params.parse(request.params);
    const { command } = z
      .object({ command: z.string().trim().min(1).max(4000) })
      .parse(request.body);
    return service.execute(request.user.organizationId, id, command);
  });
  app.delete("/sandboxes/:id", async (request, reply) => {
    const { id } = params.parse(request.params);
    await service.destroy(request.user.organizationId, id);
    return reply.code(204).send();
  });
}
