import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RunService } from "./run.service";
import { can } from "@repo/db";
import { authorize } from "../platform/authorization";

export function registerRunRoutes(app: FastifyInstance, service: RunService) {
  app.post(
    "/runs",
    {
      schema: {
        body: bodySchema(
          z.object({
            sandboxId: z.string().min(1).max(100),
            task: z.string().trim().min(1).max(20000),
            sessionId: z.string().uuid().optional(),
            provider: z
              .enum(["openai", "anthropic", "deepseek", "openrouter"])
              .optional(),
            model: z.string().min(1).max(200).optional(),
            systemInstructions: z.string().max(10000).optional(),
          }),
        ),
      },
    },
    async (request, reply) => {
      authorize(request, "models.use");
      authorize(request, "runs.write");
      const input = z
        .object({
          sandboxId: z.string().min(1).max(100),
          task: z.string().trim().min(1).max(20000),
          sessionId: z.string().uuid().optional(),
          provider: z
            .enum(["openai", "anthropic", "deepseek", "openrouter"])
            .optional(),
          model: z.string().min(1).max(200).optional(),
          systemInstructions: z.string().max(10000).optional(),
        })
        .parse(request.body);
      return reply.code(202).send(
        await service.create(request.user.organizationId, {
          ...input,
          toolPermissions: [
            "sandbox.execute",
            "files.read",
            "files.write",
            "browser.read",
            "browser.write",
            "mcp.execute",
            "artifacts.write",
            "secrets.use",
          ].filter((permission) =>
            request.apiScopes
              ? request.apiScopes.includes(permission)
              : can(request.platformRole, permission),
          ),
          idempotencyKey: z
            .string()
            .min(1)
            .max(128)
            .optional()
            .parse(request.headers["idempotency-key"]),
        }),
      );
    },
  );
  app.get("/runs/:id", (request) => {
    authorize(request, "runs.read");
    const { id } = z
      .object({ id: z.string().min(1).max(100) })
      .parse(request.params);
    return service.get(request.user.organizationId, id);
  });
}
