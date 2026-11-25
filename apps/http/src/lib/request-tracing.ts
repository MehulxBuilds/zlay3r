import type { FastifyInstance } from "fastify";
import { span, requestTrace, type RequestTrace } from "@repo/observability";
declare module "fastify" {
  interface FastifyRequest {
    telemetry?: RequestTrace;
  }
}

export function registerRequestTracing(app: FastifyInstance) {
  app.decorateRequest("telemetry");
  app.addHook("onRequest", (request, _reply, done) => {
    const carrier = Object.fromEntries(
      Object.entries(request.headers).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    request.telemetry = requestTrace(carrier, {
      "http.request.method": request.method,
      "http.route": request.routeOptions.url ?? "unknown",
      "request.id": request.id,
    });
    _reply.raw.once("close", () =>
      request.telemetry?.end(
        _reply.raw.writableFinished ? _reply.statusCode : 499,
      ),
    );
    request.telemetry.run(done);
  });
  app.addHook("onResponse", async (request, reply) => {
    request.telemetry?.end(reply.statusCode);
  });
  app.addHook("onRoute", (route) => {
    const handler = route.handler;
    route.handler = function (request, reply) {
      return span(
        "api.handler",
        {
          "http.request.method": request.method,
          "http.route": route.url,
          "request.id": request.id,
        },
        async () => handler.call(this, request, reply),
      );
    };
  });
}
