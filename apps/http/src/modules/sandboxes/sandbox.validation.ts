import { z } from "zod";

export const createSandboxSchema = z
  .strictObject({
    type: z.enum(["KATA", "FIRECRACKER"]).default("KATA"),
    name: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default("sandbox"),
    memoryMb: z.number().int().min(512).max(2048).default(512),
    cpu: z.number().min(0.25).max(2).default(1),
  })
  .superRefine((input, context) => {
    if (input.type === "FIRECRACKER" && !Number.isInteger(input.cpu)) {
      context.addIssue({
        code: "custom",
        path: ["cpu"],
        message: "Firecracker requires 1 or 2 whole CPU cores.",
      });
    }
  });
export type CreateSandboxInput = z.infer<typeof createSandboxSchema>;
