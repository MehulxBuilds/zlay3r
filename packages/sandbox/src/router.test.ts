import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { SandboxRouter } from "./router";
import type { SandboxProvider } from "./contracts";

function fixture() {
  const calls: string[] = [];
  const provider = (name: string) =>
    ({
      create: async () => {
        calls.push(`${name}.create`);
        return { resourceId: name };
      },
      inspect: async () => {
        calls.push(`${name}.inspect`);
        return {};
      },
      reconcileResources: async (ids: string[]) => {
        calls.push(`${name}.reconcile:${ids.join(",")}`);
      },
    }) as unknown as SandboxProvider & {
      reconcileResources(ids: string[]): Promise<void>;
    };
  return {
    calls,
    router: new SandboxRouter(provider("kata"), provider("firecracker")),
  };
}

test("provider selection is per sandbox and defaults existing clients to Kata", async () => {
  const { router, calls } = fixture();
  await router.create({ name: "a", cpu: 1, memoryMb: 512 });
  await router.create({
    type: "FIRECRACKER",
    name: "b",
    cpu: 1,
    memoryMb: 512,
  });
  expect(calls).toEqual(["kata.create", "firecracker.create"]);
});

test("resource routing survives a fresh router and rejects malformed identifiers", async () => {
  const { router, calls } = fixture();
  await router.inspect("a".repeat(64));
  await router.inspect(`firecracker:${randomUUID()}`);
  expect(calls).toEqual(["kata.inspect", "firecracker.inspect"]);
  expect(() => router.inspect("unknown:123")).toThrow();
  expect(() => router.inspect("firecracker:../../etc")).toThrow();
});

test("reconciliation keeps each provider's identifiers separate", async () => {
  const { router, calls } = fixture();
  const docker = "b".repeat(64),
    vm = `firecracker:${randomUUID()}`;
  await router.reconcileResources([docker, vm]);
  expect(calls).toEqual([
    `kata.reconcile:${docker}`,
    `firecracker.reconcile:${vm}`,
  ]);
});
