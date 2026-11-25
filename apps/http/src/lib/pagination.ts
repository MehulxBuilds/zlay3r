import { z } from "zod";
import { sql, type AnyPgColumn } from "@repo/db";
import type { FastifyReply } from "fastify";
import { HttpError } from "./errors";

export interface PageOptions {
  limit: number;
  cursor?: { id: string; createdAt: string };
  status?: string;
}
export const paginationSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
    cursor: { type: "string", maxLength: 500 },
    status: { type: "string", maxLength: 40 },
  },
  additionalProperties: false,
};
export function readPage(
  query: unknown,
  statuses: readonly string[] = [],
): PageOptions {
  const input = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
      cursor: z.string().max(500).optional(),
      status: z.string().max(40).optional(),
    })
    .parse(query);
  if (input.status && !statuses.includes(input.status))
    throw new HttpError(400, "INVALID_STATUS_FILTER");
  let cursor: PageOptions["cursor"];
  if (input.cursor) {
    try {
      cursor = z
        .object({ id: z.string().uuid(), createdAt: z.iso.datetime() })
        .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
    } catch {
      throw new HttpError(400, "INVALID_CURSOR");
    }
  }
  return { ...input, cursor };
}
export function cursorFilter(
  createdAt: AnyPgColumn,
  id: AnyPgColumn,
  page: PageOptions,
) {
  return page.cursor
    ? sql`(${createdAt}, ${id}) < (${new Date(page.cursor.createdAt)}, ${page.cursor.id})`
    : undefined;
}
export function sendPage<T extends { id: string; createdAt: Date }>(
  reply: FastifyReply,
  items: T[],
  limit: number,
) {
  const last = items.at(-1);
  if (items.length === limit && last)
    reply.header(
      "x-next-cursor",
      Buffer.from(
        JSON.stringify({
          id: last.id,
          createdAt: last.createdAt.toISOString(),
        }),
      ).toString("base64url"),
    );
  return items;
}
