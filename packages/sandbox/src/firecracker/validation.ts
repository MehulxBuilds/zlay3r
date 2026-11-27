import { z } from "zod";

export const vmIdSchema = z.uuid();
export const createVmSchema = z.strictObject({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  memoryMb: z.number().int().min(512).max(2048),
  cpu: z.number().int().min(1).max(2),
  approvedHosts: z
    .array(
      z
        .string()
        .max(253)
        .regex(
          /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
        ),
    )
    .max(100)
    .default([]),
});
export type CreateVm = z.infer<typeof createVmSchema>;
export const lifecycleSchema = z.enum([
  "start",
  "stop",
  "pause",
  "resume",
  "restart",
]);
export const guestRequestSchema = z.strictObject({
  kind: z.enum(["runner", "helper", "filesystem", "ping", "sync"]),
});

export function vmResourceId(id: string) {
  return `firecracker:${vmIdSchema.parse(id)}`;
}

export function parseVmResourceId(id: string) {
  if (!id.startsWith("firecracker:"))
    throw new Error("INVALID_FIRECRACKER_RESOURCE");
  return vmIdSchema.parse(id.slice("firecracker:".length));
}
