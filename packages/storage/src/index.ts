import { AwsClient } from "aws4fetch";
import { createHash, randomUUID } from "node:crypto";
import {
  and,
  artifact,
  db,
  eq,
  reserveUsage,
  usageEvent,
  appendPlatformEventTx,
} from "@repo/db";
import { server_env as env } from "@repo/env";
export class StorageError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function storage() {
  if (
    !env.R2_ACCOUNT_ID ||
    !env.R2_BUCKET ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY
  )
    throw new StorageError(503, "R2_NOT_CONFIGURED");
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}
function objectUrl(key: string) {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(env.R2_BUCKET)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
export async function uploadArtifact(
  organizationId: string,
  input: {
    filename: string;
    mimeType: string;
    data: Buffer;
    sandboxId?: string;
    runId?: string;
  },
) {
  const client = storage(),
    id = randomUUID();
  if (input.data.length > 8 * 1048576)
    throw new StorageError(413, "ARTIFACT_TOO_LARGE");
  const objectKey = `${organizationId}/${id}`;
  const checksum = createHash("sha256").update(input.data).digest("hex");
  const record = await db.transaction(async (tx) => {
    await reserveUsage(
      tx,
      organizationId,
      "artifact_bytes",
      input.data.length,
      "bytes",
      `${id}-artifact_bytes`,
    );
    const [created] = await tx
      .insert(artifact)
      .values({
        id,
        organizationId,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.data.length,
        checksum,
        objectKey,
        sandboxId: input.sandboxId,
        runId: input.runId,
      })
      .returning();
    return created!;
  });
  try {
    const response = await client.fetch(objectUrl(objectKey), {
      method: "PUT",
      body: new Uint8Array(input.data),
      headers: { "content-type": input.mimeType },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new StorageError(502, "ARTIFACT_UPLOAD_FAILED");
    await response.body?.cancel();
    await db.transaction(async (tx) => {
      await tx
        .update(artifact)
        .set({ status: "READY" })
        .where(eq(artifact.id, id));
      await tx
        .update(usageEvent)
        .set({ metadata: { reserved: false } })
        .where(eq(usageEvent.idempotencyKey, `${id}-artifact_bytes`));
      await appendPlatformEventTx(tx, organizationId, "artifact.created", id, {
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.data.length,
      });
    });
    return {
      id,
      filename: record!.filename,
      mimeType: input.mimeType,
      size: input.data.length,
      checksum,
      status: "READY",
    };
  } catch (error) {
    await db
      .update(usageEvent)
      .set({ quantity: "0", metadata: { released: true } })
      .where(eq(usageEvent.idempotencyKey, `${id}-artifact_bytes`));
    await db
      .update(artifact)
      .set({ status: "FAILED" })
      .where(eq(artifact.id, id));
    const cleanup = await client.fetch(objectUrl(objectKey), {
      method: "DELETE",
      signal: AbortSignal.timeout(10000),
    });
    await cleanup.body?.cancel();
    throw error;
  }
}
export async function removeArtifact(organizationId: string, id: string) {
  const [record] = await db
    .select()
    .from(artifact)
    .where(
      and(eq(artifact.id, id), eq(artifact.organizationId, organizationId)),
    )
    .limit(1);
  if (!record) return;
  const response = await storage().fetch(objectUrl(record.objectKey), {
    method: "DELETE",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok && response.status !== 404)
    throw new StorageError(502, "ARTIFACT_DELETE_FAILED");
  await response.body?.cancel();
  await db.transaction(async (tx) => {
    await tx
      .delete(artifact)
      .where(
        and(eq(artifact.id, id), eq(artifact.organizationId, organizationId)),
      );
    await tx
      .update(usageEvent)
      .set({ quantity: "0", metadata: { released: true } })
      .where(eq(usageEvent.idempotencyKey, `${id}-artifact_bytes`));
    await appendPlatformEventTx(tx, organizationId, "artifact.deleted", id);
  });
}
export async function reconcileUploads() {
  if (!env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY)
    return;
  const { sql } = await import("@repo/db");
  const records = await db
    .select()
    .from(artifact)
    .where(
      sql`${artifact.status} in ('UPLOADING','FAILED') AND ${artifact.createdAt} < now() - interval '10 minutes'`,
    )
    .limit(100);
  for (const record of records)
    await removeArtifact(record.organizationId, record.id);
}
export async function downloadArtifact(organizationId: string, id: string) {
  const [record] = await db
    .select()
    .from(artifact)
    .where(
      and(
        eq(artifact.id, id),
        eq(artifact.organizationId, organizationId),
        eq(artifact.status, "READY"),
      ),
    )
    .limit(1);
  if (!record) throw new StorageError(404, "ARTIFACT_NOT_FOUND");
  const url = new URL(objectUrl(record.objectKey));
  url.searchParams.set("X-Amz-Expires", "300");
  const signed = await storage().sign(url, {
    method: "GET",
    aws: { signQuery: true },
  });
  return {
    url: signed.url,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  };
}
