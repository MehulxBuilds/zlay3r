import { z } from "zod";

export function bodySchema(schema: z.ZodType) {
  // Zod applies defaults after transport validation. AJV rejects defaults in unions.
  return z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
    override: ({ jsonSchema }) => {
      delete jsonSchema.default;
    },
  });
}
