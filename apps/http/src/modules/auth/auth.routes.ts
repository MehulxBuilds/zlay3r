import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { server_env as env } from "@repo/env";
import { HttpError } from "../../lib/errors";
import {
  SESSION_SECONDS,
  type AuthService,
  type AuthUser,
} from "./auth.service";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
  }
}

const COOKIE = "zlayer_session";
const cookieOptions = {
  path: "/",
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
};
const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const password = z.string().min(12).max(128);

export function getToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  return authorization
    ? authorization.match(/^Bearer (\S+)$/)?.[1]
    : request.cookies[COOKIE];
}

export function authenticate(auth: AuthService) {
  return async (request: FastifyRequest) => {
    request.user = await auth.authenticate(getToken(request));
  };
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService) {
  const options = {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  };
  function respond(
    reply: FastifyReply,
    result: Awaited<ReturnType<AuthService["login"]>>,
  ) {
    reply.header("cache-control", "no-store");
    reply.setCookie(COOKIE, result.token, {
      ...cookieOptions,
      maxAge: SESSION_SECONDS,
    });
    return {
      user: result.user,
      token: result.token,
      expiresAt: result.expiresAt,
    };
  }
  app.post("/register", options, async (request, reply) => {
    const input = z
      .object({ email, password, name: z.string().trim().min(1).max(100) })
      .parse(request.body);
    return respond(reply.code(201), await auth.register(input));
  });
  app.post("/login", options, async (request, reply) => {
    const input = z
      .object({ email, password: z.string().min(1).max(128) })
      .parse(request.body);
    return respond(reply, await auth.login(input));
  });
  app.post("/google", options, async (request, reply) => {
    const { credential } = z
      .object({ credential: z.string().min(1).max(10000) })
      .parse(request.body);
    return respond(reply, await auth.google(credential));
  });
  app.get("/me", { preHandler: authenticate(auth) }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    return { user: request.user };
  });
  app.post(
    "/logout",
    { preHandler: authenticate(auth) },
    async (request, reply) => {
      const token = getToken(request);
      if (!token) throw new HttpError(401, "UNAUTHORIZED");
      await auth.logout(token);
      return reply.clearCookie(COOKIE, cookieOptions).code(204).send();
    },
  );
}
