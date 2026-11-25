import { z } from "zod";
import { PlatformError } from "@repo/sdk";

export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return "The server returned data in an unexpected format. Refresh and try again.";
  if (error instanceof PlatformError) {
    const details = z
      .object({
        message: z.string().optional(),
        approvalId: z.string().optional(),
      })
      .safeParse(error.details);
    if (details.success && details.data.approvalId)
      return "This action needs approval. Review it in Approvals, then try again.";
    return details.success && details.data.message
      ? details.data.message
      : error.code.replaceAll("_", " ").toLowerCase();
  }
  const result = z.object({ message: z.string() }).safeParse(error);
  return result.success
    ? result.data.message
    : "Something went wrong. Please try again.";
}
export function display(value: unknown): string {
  const text = z.string().safeParse(value);
  return text.success
    ? text.data
    : (JSON.stringify(value, null, 2) ?? "\u2014");
}
export function dateLabel(value?: string) {
  const parsed = z.coerce.date().safeParse(value);
  return parsed.success
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed.data)
    : "\u2014";
}
export function numberLabel(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
export function bytesLabel(value: number) {
  return value < 1048576
    ? `${Math.ceil(value / 1024)} KB`
    : `${(value / 1048576).toFixed(1)} MB`;
}
