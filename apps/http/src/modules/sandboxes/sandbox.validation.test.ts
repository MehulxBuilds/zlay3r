import { expect, test } from "bun:test";
import { createSandboxSchema } from "./sandbox.validation";

test("sandbox validation defaults to Kata and enforces shared resource bounds", () => {
  expect(createSandboxSchema.parse({})).toEqual({
    type: "KATA",
    name: "sandbox",
    memoryMb: 512,
    cpu: 1,
  });
  for (const input of [
    { memoryMb: 128 },
    { memoryMb: -1 },
    { memoryMb: 513.5 },
    { cpu: 0 },
    { cpu: 3 },
    { type: "DOCKER" },
    { name: "../escape" },
    { unexpected: true },
  ]) {
    expect(createSandboxSchema.safeParse(input).success).toBe(false);
  }
});

test("Firecracker requires whole vCPUs while Kata retains fractional CPU quotas", () => {
  expect(
    createSandboxSchema.safeParse({ type: "KATA", cpu: 0.25 }).success,
  ).toBe(true);
  expect(
    createSandboxSchema.safeParse({ type: "FIRECRACKER", cpu: 0.5 }).success,
  ).toBe(false);
  expect(
    createSandboxSchema.safeParse({ type: "FIRECRACKER", cpu: 2 }).success,
  ).toBe(true);
});
