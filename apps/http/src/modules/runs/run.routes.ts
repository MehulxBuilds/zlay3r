import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RunService } from "./run.service";

export function registerRunRoutes(app: FastifyInstance, service: RunService) {
  app.post("/runs", async (request, reply) => {
    const input = z
      .object({
        sandboxId: z.string().min(1).max(100),
        task: z.string().trim().min(1).max(20000),
      })
      .parse(request.body);
    return reply
      .code(202)
      .send(await service.create(request.user.organizationId, input));
  });
  app.get("/runs/:id", (request) => {
    const { id } = z
      .object({ id: z.string().min(1).max(100) })
      .parse(request.params);
    return service.get(request.user.organizationId, id);
  });
}
