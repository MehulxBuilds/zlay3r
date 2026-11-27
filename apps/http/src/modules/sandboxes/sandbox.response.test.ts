import { expect, test } from "bun:test";
import Fastify from "fastify";
import { responseSchemas } from "../../lib/response-schema";
import { sandboxSchema } from "../../../../web/src/lib/schemas";

test("sandbox responses preserve the selected type through HTTP serialization", async () => {
  const app = Fastify();
  const record = {
    id: "sandbox-test",
    type: "FIRECRACKER",
    name: "test",
    status: "RUNNING",
    memoryMb: 512,
    cpu: 1,
    createdAt: new Date(),
    networkHosts: [],
  };
  app.get(
    "/v1/sandboxes",
    {
      schema: { response: responseSchemas("/v1/sandboxes", "GET") },
    },
    async () => [record],
  );
  app.post(
    "/v1/sandboxes",
    {
      schema: { response: responseSchemas("/v1/sandboxes", "POST") },
    },
    async (_request, reply) => reply.code(201).send(record),
  );
  try {
    for (const type of ["KATA", "FIRECRACKER", null] as const) {
      Object.assign(record, { type });
      const listing = await app.inject({ method: "GET", url: "/v1/sandboxes" });
      expect(listing.statusCode).toBe(200);
      expect(sandboxSchema.parse(listing.json()[0]).type).toBe(type ?? "KATA");
      const created = await app.inject({
        method: "POST",
        url: "/v1/sandboxes",
      });
      expect(created.statusCode).toBe(201);
      expect(sandboxSchema.parse(created.json()).type).toBe(type ?? "KATA");
    }
  } finally {
    await app.close();
  }
});
