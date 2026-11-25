import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
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
import type IORedis from "ioredis";
import { registerRequestTracing } from "./lib/request-tracing";
import { registerApiContracts } from "./lib/openapi";
import { StorageError } from "@repo/storage";
import { SandboxError } from "@repo/sandbox";

export interface AppDependencies {
  auth: AuthService;
  sandboxes: SandboxService;
  runs: RunService;
  ready(): Promise<void>;
  close(): Promise<void>;
  authenticate?: (request: FastifyRequest) => Promise<void>;
  registerPlatform?: (app: FastifyInstance) => Promise<void>;
  rateLimitRedis?: IORedis;
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
  registerRequestTracing(app);
  registerApiContracts(app);
  await app.register(cors, {
    origin: new URL(env.WEB_URL).origin,
    credentials: true,
    exposedHeaders: ["x-next-cursor", "x-request-id"],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    ...(dependencies.rateLimitRedis
      ? { redis: dependencies.rateLimitRedis }
      : {}),
  });
  app.decorateRequest("user");
  app.decorateRequest("platformRole", "viewer");
  app.decorateRequest("apiScopes");
  app.addHook("onSend", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-request-id", _request.id);
    reply.header("cache-control", "no-store");
  });
  app.addHook("onRequest", async (request) => {
    if (
      request.headers["idempotency-key"] &&
      !["/v1/runs", "/v1/executions"].includes(request.url.split("?")[0]!)
    )
      throw new HttpError(400, "IDEMPOTENCY_NOT_SUPPORTED_FOR_OPERATION");
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
    if (error instanceof SandboxError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        requestId: request.id,
      });
    }
    if (error instanceof StorageError)
      return reply
        .code(error.statusCode)
        .send({ error: error.message, requestId: request.id });
    if (error instanceof Error && error.message === "QUOTA_EXCEEDED")
      return reply
        .code(429)
        .send({ error: "QUOTA_EXCEEDED", requestId: request.id });
    if (
      error instanceof Error &&
      [
        "R2_NOT_CONFIGURED",
        "ENCRYPTION_KEY_NOT_CONFIGURED",
        "PROVIDER_NOT_CONFIGURED",
      ].includes(error.message)
    )
      return reply
        .code(503)
        .send({ error: error.message, requestId: request.id });
    if (
      error instanceof Error &&
      ["SECRET_NOT_FOUND", "DUPLICATE_SECRET_NAMES"].includes(error.message)
    )
      return reply
        .code(400)
        .send({ error: error.message, requestId: request.id });
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        issues: error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      });
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({
        error: error.message,
        ...error.details,
        requestId: request.id,
      });
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    if (statusCode >= 400 && statusCode < 500)
      return reply.code(statusCode).send({
        error: statusCode === 429 ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
      });
    request.log.error({ err: error }, "Request failed");
    return reply.code(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: `An unexpected server error occurred. Check server logs using request ID ${request.id}.`,
      requestId: request.id,
    });
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
      protectedRoutes.addHook(
        "onRequest",
        dependencies.authenticate ?? authenticate(dependencies.auth),
      );
      registerSandboxRoutes(protectedRoutes, dependencies.sandboxes);
      registerRunRoutes(protectedRoutes, dependencies.runs);
      if (dependencies.registerPlatform)
        await dependencies.registerPlatform(protectedRoutes);
    },
    { prefix: "/v1" },
  );
  app.addHook("onClose", () => dependencies.close());
  return app;
}
