import { z } from "zod";

const sessionFields = z
  .object({
    title: z.string().trim().min(1).max(200),
    approvalType: z.enum(["APPROVE_FOR_ME", "ASK_FOR_APPROVAL"]),
  })
  .strict();
export const sessionInput = sessionFields.extend({
  approvalType: sessionFields.shape.approvalType.default("ASK_FOR_APPROVAL"),
});
export const sessionUpdate = sessionFields
  .partial()
  .refine(
    (input) => Object.keys(input).length > 0,
    "Provide at least one session field",
  );
