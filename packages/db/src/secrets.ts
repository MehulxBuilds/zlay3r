import { db } from "./db";
import { secret } from "../schema/index";
import { and, eq, inArray } from "drizzle-orm";
import { decrypt } from "./security";
export async function resolveSecrets(organizationId: string, names: string[]) {
  if (!names.length) return {};
  if (new Set(names).size !== names.length)
    throw new Error("DUPLICATE_SECRET_NAMES");
  const rows = await db
    .select()
    .from(secret)
    .where(
      and(
        eq(secret.organizationId, organizationId),
        inArray(secret.name, names),
      ),
    );
  if (rows.length !== names.length) throw new Error("SECRET_NOT_FOUND");
  return Object.fromEntries(
    rows.map((row) => [row.name, decrypt(row.ciphertext, organizationId)]),
  );
}
