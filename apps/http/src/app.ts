import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { server_env as env } from "@repo/env";
import { HttpError } from "./lib/errors";
import { authenticate, registerAuthRoutes } from "./modules/auth/auth.routes";
import type { AuthService } from "./modules/auth/auth.service";
import { registerSandboxRoutes } from "./modules/sandboxes/sandbox.routes";
import type { SandboxService } from "./modules/sandboxes/sandbox.service";
import { registerRunRoutes } from "./modules/runs/run.routes";
import type { RunService } from "./modules/runs/run.service";

export interface AppDependencies {
  auth: AuthService;
  sandboxes: SandboxService;
  runs: RunService;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export async function buildApp(dependencies: AppDependencies) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        'res.headers["set-cookie"]',
      ],
    },
    bodyLimit: 64 * 1024,
  });
  await app.register(cors, {
    origin: new URL(env.WEB_URL).origin,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorateRequest("user");
  app.addHook("onRequest", async (request) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && origin !== new URL(env.WEB_URL).origin)
      throw new HttpError(403, "ORIGIN_NOT_ALLOWED");
    if (
      request.cookies.zlayer_session &&
      !request.headers.authorization &&
      !origin
    )
      throw new HttpError(403, "ORIGIN_REQUIRED");
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        issues: error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      });
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ error: error.message });
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    if (statusCode >= 400 && statusCode < 500)
      return reply.code(statusCode).send({
        error: statusCode === 429 ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
      });
    request.log.error({ err: error }, "Request failed");
    return reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });
  app.get("/health", async () => ({ ok: true }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await dependencies.ready();
      return { ready: true };
    } catch {
      return reply.code(503).send({ ready: false });
    }
  });
  await app.register(
    async (auth) => registerAuthRoutes(auth, dependencies.auth),
    { prefix: "/v1/auth" },
  );
  await app.register(
    async (protectedRoutes) => {
      protectedRoutes.addHook("onRequest", authenticate(dependencies.auth));
      registerSandboxRoutes(protectedRoutes, dependencies.sandboxes);
      registerRunRoutes(protectedRoutes, dependencies.runs);
    },
    { prefix: "/v1" },
  );
  app.addHook("onClose", () => dependencies.close());
  return app;
}
