import { expect, spyOn, test } from "bun:test";
import Fastify from "fastify";
import {
  db,
  evaluateAction,
  executionPolicy,
  agentRun,
  approval,
} from "@repo/db";
import { sessionInput, sessionUpdate } from "./sessions.validation";
import { responseSchemas } from "../../lib/response-schema";
import { sessionSchema } from "../../../../web/src/lib/schemas";

function memoryApprovalCheck(
  type: string | null | undefined,
  settings: { allowedTools?: string[]; allowedCommands?: string[] } = {},
) {
  const inserted: unknown[] = [];
  const tables: unknown[] = [];
  const tx = {
    select() {
      let table: unknown;
      const query = {
        from(value: unknown) {
          table = value;
          tables.push(value);
          return query;
        },
        innerJoin() {
          return query;
        },
        where() {
          return query;
        },
        async limit() {
          if (table === executionPolicy)
            return [
              {
                allowedTools: settings.allowedTools ?? ["execute_command"],
                allowedCommands: settings.allowedCommands ?? [],
                requireApproval: ["execute_command"],
              },
            ];
          if (table === agentRun)
            return type === undefined ? [] : [{ approvalType: type }];
          if (table === approval) return [];
          throw new Error("UNEXPECTED_TABLE");
        },
      };
      return query;
    },
    async execute() {},
    insert() {
      return {
        values(value: unknown) {
          inserted.push(value);
          return {
            async returning() {
              return [{ id: "pending" }];
            },
          };
        },
      };
    },
  };
  const transaction = spyOn(db, "transaction").mockImplementation(
    async (callback) => callback(tx as never),
  );
  return { inserted, tables, transaction };
}

for (const type of ["APPROVE_FOR_ME", "ASK_FOR_APPROVAL", null, undefined]) {
  test(`session approval mode ${type} controls run consent`, async () => {
    const fixture = memoryApprovalCheck(type);
    try {
      const result = await evaluateAction(
        "org",
        "execute_command",
        { command: "ls" },
        "sandbox",
        "run",
      );
      expect(result.allowed).toBe(type === "APPROVE_FOR_ME");
      expect(fixture.inserted.length).toBe(type === "APPROVE_FOR_ME" ? 0 : 1);
      if (!result.allowed) expect(result.reason).toBe("APPROVAL_REQUIRED");
    } finally {
      fixture.transaction.mockRestore();
    }
  });
}
test("automatic approval preserves tool and command restrictions", async () => {
  for (const settings of [{ allowedTools: [] }, { allowedCommands: ["pwd"] }]) {
    const fixture = memoryApprovalCheck("APPROVE_FOR_ME", settings);
    try {
      const result = await evaluateAction(
        "org",
        "execute_command",
        { command: "ls" },
        "sandbox",
        "run",
      );
      expect(result.allowed).toBe(false);
      expect(fixture.inserted).toHaveLength(0);
    } finally {
      fixture.transaction.mockRestore();
    }
  }
});
test("standalone actions do not inherit any session mode", async () => {
  const fixture = memoryApprovalCheck("APPROVE_FOR_ME");
  try {
    expect(
      (
        await evaluateAction(
          "org",
          "execute_command",
          { command: "ls" },
          "sandbox",
        )
      ).reason,
    ).toBe("APPROVAL_REQUIRED");
    expect(fixture.tables).not.toContain(agentRun);
  } finally {
    fixture.transaction.mockRestore();
  }
});
test("session validation defaults to asking and validates edits", () => {
  expect(sessionInput.parse({ title: " Test " })).toEqual({
    title: "Test",
    approvalType: "ASK_FOR_APPROVAL",
  });
  expect(sessionUpdate.parse({ title: "Renamed" })).toEqual({
    title: "Renamed",
  });
  for (const input of [
    {},
    { approvalType: "invalid" },
    { approvalType: null },
    { title: " " },
    { organizationId: "other" },
  ])
    expect(sessionUpdate.safeParse(input).success).toBe(false);
});
test("session approval mode survives create, list, detail and edit serialization", async () => {
  const app = Fastify();
  let approvalType: string | null = null;
  const record = () => ({ id: "test", title: "Session", approvalType });
  for (const method of ["GET", "POST", "PATCH"] as const) {
    const url = method === "POST" ? "/v1/sessions" : "/v1/sessions/test";
    app.route({
      method,
      url,
      schema: { response: responseSchemas(url, method) },
      handler: async (_request, reply) =>
        reply.code(method === "POST" ? 201 : 200).send(record()),
    });
  }
  app.get(
    "/v1/sessions",
    { schema: { response: responseSchemas("/v1/sessions", "GET") } },
    async () => ({ items: [record()], nextCursor: null }),
  );
  try {
    for (const type of ["APPROVE_FOR_ME", "ASK_FOR_APPROVAL", null] as const) {
      approvalType = type;
      for (const method of ["GET", "POST", "PATCH"] as const) {
        const response = await app.inject({
          method,
          url: method === "POST" ? "/v1/sessions" : "/v1/sessions/test",
        });
        expect(response.statusCode).toBe(method === "POST" ? 201 : 200);
        expect(sessionSchema.parse(response.json()).approvalType).toBe(
          type ?? "ASK_FOR_APPROVAL",
        );
      }
      const listing = await app.inject({ method: "GET", url: "/v1/sessions" });
      expect(sessionSchema.parse(listing.json().items[0]).approvalType).toBe(
        type ?? "ASK_FOR_APPROVAL",
      );
    }
  } finally {
    await app.close();
  }
});
