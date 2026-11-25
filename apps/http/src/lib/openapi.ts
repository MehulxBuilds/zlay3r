import type { FastifyInstance, RouteOptions } from "fastify";
import { paginationSchema } from "./pagination";
import { responseSchemas, openApiSchema } from "./response-schema";

const paginatedRoutes = new Set([
  "/v1/sandboxes",
  "/v1/runs",
  "/v1/executions",
  "/v1/artifacts",
  "/v1/browsers",
  "/v1/audit",
  "/v1/activity",
  "/v1/api-keys",
]);
const publicRoutes = new Set([
  "/health",
  "/health/ready",
  "/openapi.json",
  "/v1/auth/register",
  "/v1/auth/login",
  "/v1/auth/google",
]);
type Document = Record<string, unknown>;

function attachContracts(route: RouteOptions) {
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  const primary = methods.find((method) => method !== "HEAD") ?? "GET";
  const responses = responseSchemas(route.url, primary);
  route.schema = {
    ...route.schema,
    ...(responses
      ? {
          response: {
            ...responses,
            ...(route.schema?.response as Document | undefined),
          },
        }
      : {}),
    ...(primary === "GET" && paginatedRoutes.has(route.url)
      ? { querystring: paginationSchema }
      : {}),
  };
}

function describeResponses(route: RouteOptions, method: string): Document {
  const responses: Document = {};
  for (const [status, schema] of Object.entries(route.schema?.response ?? {})) {
    responses[status.replace("xx", "XX")] = {
      description: status.startsWith("2")
        ? "Successful response"
        : "Error response",
      content: { "application/json": { schema: openApiSchema(schema) } },
    };
  }
  const noBody =
    method === "DELETE" ||
    route.url === "/v1/auth/logout" ||
    (method === "PUT" &&
      (route.url.startsWith("/v1/secrets/") || route.url === "/v1/quotas"));
  if (noBody)
    responses["204"] = { description: "Successful response with no body" };
  if (route.url.endsWith("/events"))
    responses["200"] = {
      description: "Ordered execution events",
      content: { "text/event-stream": { schema: { type: "string" } } },
    };
  if (route.url === "/openapi.json")
    responses["200"] = { description: "OpenAPI document" };
  return responses;
}

function describeOperation(route: RouteOptions, method: string): Document {
  const parameters: Document[] = [
    ...route.url.matchAll(/:([a-zA-Z0-9_]+)/g),
  ].map((match) => ({
    in: "path",
    name: match[1],
    required: true,
    schema: { type: "string" },
  }));
  const query = route.schema?.querystring as
    | { properties?: Document; required?: string[] }
    | undefined;
  for (const [name, schema] of Object.entries(query?.properties ?? {})) {
    parameters.push({
      in: "query",
      name,
      required: query?.required?.includes(name) ?? false,
      schema: openApiSchema(schema),
    });
  }
  return {
    security: publicRoutes.has(route.url)
      ? []
      : [{ bearer: [] }, { session: [] }],
    operationId: `${method.toLowerCase()}_${route.url.replace(/[^a-zA-Z0-9]/g, "_")}`,
    parameters,
    ...(route.schema?.body
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: openApiSchema(route.schema.body) },
            },
          },
        }
      : {}),
    responses: describeResponses(route, method),
  };
}

export function registerApiContracts(app: FastifyInstance) {
  const paths: Record<string, Document> = {};
  app.addHook("onRoute", (route) => {
    attachContracts(route);
    const url = route.url.replace(/:([a-zA-Z0-9_]+)/g, "{$1}");
    for (const method of Array.isArray(route.method)
      ? route.method
      : [route.method]) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      paths[url] ??= {};
      const path = paths[url]!;
      path[method.toLowerCase()] = describeOperation(route, method);
    }
  });
  app.get("/openapi.json", async () => ({
    openapi: "3.1.0",
    info: {
      title: "Zlayer API",
      version: "1.0.0",
      description:
        "Organization-scoped sandbox, agent, browser and artifact APIs.",
    },
    paths,
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer" },
        session: { type: "apiKey", in: "cookie", name: "zlayer_session" },
      },
    },
  }));
}
