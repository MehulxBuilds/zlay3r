import { and, db, desc, eq, sandbox } from "@repo/db";
import type { DockerSandboxProvider } from "@repo/sandbox";
import { HttpError } from "../../lib/errors";

export function createSandboxService(provider: DockerSandboxProvider) {
  async function find(organizationId: string, id: string, running = false) {
    const [record] = await db
      .select()
      .from(sandbox)
      .where(
        and(
          eq(sandbox.id, id),
          eq(sandbox.organizationId, organizationId),
          running ? eq(sandbox.status, "RUNNING") : undefined,
        ),
      )
      .limit(1);
    if (!record) throw new HttpError(404, "SANDBOX_NOT_FOUND");
    return record;
  }
  return {
    find,
    async list(organizationId: string) {
      return db
        .select()
        .from(sandbox)
        .where(eq(sandbox.organizationId, organizationId))
        .orderBy(desc(sandbox.createdAt));
    },
    async create(
      organizationId: string,
      input: { name: string; memoryMb: number; cpu: number },
    ) {
      const [record] = await db
        .insert(sandbox)
        .values({ ...input, organizationId })
        .returning();
      try {
        const created = await provider.create({ ...input, name: record!.id });
        const [updated] = await db
          .update(sandbox)
          .set({ resourceId: created.resourceId, status: "RUNNING" })
          .where(
            and(
              eq(sandbox.id, record!.id),
              eq(sandbox.organizationId, organizationId),
            ),
          )
          .returning();
        return updated!;
      } catch (error) {
        await db
          .update(sandbox)
          .set({ status: "FAILED" })
          .where(eq(sandbox.id, record!.id));
        throw error;
      }
    },
    async execute(organizationId: string, id: string, command: string) {
      const record = await find(organizationId, id, true);
      if (!record.resourceId) throw new HttpError(409, "SANDBOX_NOT_READY");
      return provider.execute(record.resourceId, command);
    },
    async destroy(organizationId: string, id: string) {
      const record = await find(organizationId, id);
      if (record.resourceId) await provider.destroy(record.resourceId);
      await db
        .update(sandbox)
        .set({ status: "DESTROYED", resourceId: null })
        .where(
          and(eq(sandbox.id, id), eq(sandbox.organizationId, organizationId)),
        );
    },
  };
}

export type SandboxService = ReturnType<typeof createSandboxService>;
