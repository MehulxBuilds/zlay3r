import { bodySchema } from "../../lib/route-schema";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  db,
  and,
  eq,
  sql,
  organization,
  membership,
  user,
  invitation,
  tokenDigest,
  executionPolicy,
} from "@repo/db";
import { authorize } from "../platform/authorization";
import { HttpError } from "../../lib/errors";
import type { SandboxProvider } from "@repo/sandbox";
import { idParams, roleSchema } from "../platform/platform.contracts";
export async function registerOrganizationsRoutes(
  app: FastifyInstance,
  _provider: SandboxProvider,
) {
  app.get("/organizations", async (request) => {
    if (request.apiScopes) throw new HttpError(403, "USER_SESSION_REQUIRED");
    return db
      .select({
        id: organization.id,
        name: organization.name,
        role: membership.role,
      })
      .from(membership)
      .innerJoin(organization, eq(organization.id, membership.organizationId))
      .where(eq(membership.userId, request.user.id));
  });
  app.post(
    "/organizations",
    {
      schema: {
        body: bodySchema(z.object({ name: z.string().trim().min(1).max(100) })),
      },
    },
    async (request, reply) => {
      if (request.apiScopes) throw new HttpError(403, "USER_SESSION_REQUIRED");
      const input = z
        .object({ name: z.string().trim().min(1).max(100) })
        .parse(request.body);
      const org = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(organization)
          .values(input)
          .returning();
        await tx.insert(membership).values({
          userId: request.user.id,
          organizationId: created!.id,
          role: "owner",
        });
        await tx
          .insert(executionPolicy)
          .values({ organizationId: created!.id });
        return created;
      });
      request.user = { ...request.user, organizationId: org!.id };
      return reply.code(201).send({ ...org, role: "owner" });
    },
  );
  app.patch(
    "/organizations/current",
    {
      schema: {
        body: bodySchema(z.object({ name: z.string().trim().min(1).max(100) })),
      },
    },
    async (request) => {
      authorize(request, "organization.admin");
      const input = z
        .object({ name: z.string().trim().min(1).max(100) })
        .parse(request.body);
      return (
        await db
          .update(organization)
          .set(input)
          .where(eq(organization.id, request.user.organizationId))
          .returning()
      )[0];
    },
  );
  app.get("/memberships", async (request) => {
    authorize(request, "organization.read");
    return db
      .select({
        id: membership.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        role: membership.role,
      })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(eq(membership.organizationId, request.user.organizationId));
  });
  app.post(
    "/organizations/current/transfer-owner",
    { schema: { body: bodySchema(z.object({ userId: z.string().uuid() })) } },
    async (request) => {
      if (request.platformRole !== "owner" || request.apiScopes)
        throw new HttpError(403, "OWNER_REQUIRED");
      const { userId } = z
        .object({ userId: z.string().uuid() })
        .parse(request.body);
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM organization WHERE id = ${request.user.organizationId} FOR UPDATE`,
        );
        const [target] = await tx
          .select()
          .from(membership)
          .where(
            and(
              eq(membership.organizationId, request.user.organizationId),
              eq(membership.userId, userId),
            ),
          )
          .limit(1);
        if (!target) throw new HttpError(404, "MEMBERSHIP_NOT_FOUND");
        await tx
          .update(membership)
          .set({ role: "admin" })
          .where(
            and(
              eq(membership.organizationId, request.user.organizationId),
              eq(membership.role, "owner"),
            ),
          );
        await tx
          .update(membership)
          .set({ role: "owner" })
          .where(eq(membership.id, target.id));
      });
      return { transferred: true };
    },
  );
  app.patch(
    "/memberships/:id",
    { schema: { body: bodySchema(z.object({ role: roleSchema })) } },
    async (request) => {
      authorize(request, "organization.admin");
      const { id } = idParams.parse(request.params);
      const input = z.object({ role: roleSchema }).parse(request.body);
      const [record] = await db
        .update(membership)
        .set(input)
        .where(
          and(
            eq(membership.id, id),
            eq(membership.organizationId, request.user.organizationId),
            sql`${membership.role} != 'owner'`,
          ),
        )
        .returning();
      if (!record) throw new HttpError(404, "MEMBERSHIP_NOT_FOUND");
      return record;
    },
  );
  app.delete("/memberships/:id", async (request, reply) => {
    authorize(request, "organization.admin");
    const { id } = idParams.parse(request.params);
    await db
      .delete(membership)
      .where(
        and(
          eq(membership.id, id),
          eq(membership.organizationId, request.user.organizationId),
          sql`${membership.role} != 'owner'`,
        ),
      );
    return reply.code(204).send();
  });
  app.post(
    "/invitations",
    {
      schema: {
        body: bodySchema(
          z.object({
            email: z.email().transform((v) => v.toLowerCase()),
            role: roleSchema,
          }),
        ),
      },
    },
    async (request, reply) => {
      authorize(request, "organization.admin");
      const input = z
        .object({
          email: z.email().transform((v) => v.toLowerCase()),
          role: roleSchema,
        })
        .parse(request.body);
      const token = randomBytes(32).toString("base64url"),
        expiresAt = new Date(Date.now() + 86400000);
      await db.insert(invitation).values({
        ...input,
        organizationId: request.user.organizationId,
        tokenHash: tokenDigest(token),
        expiresAt,
      });
      return reply.code(201).send({ token, expiresAt });
    },
  );
  app.post(
    "/invitations/accept",
    {
      schema: {
        body: bodySchema(z.object({ token: z.string().min(20).max(200) })),
      },
    },
    async (request) => {
      if (request.apiScopes) throw new HttpError(403, "USER_SESSION_REQUIRED");
      const { token } = z
        .object({ token: z.string().min(20).max(200) })
        .parse(request.body);
      const result = await db.transaction(async (tx) => {
        const [invite] = await tx
          .delete(invitation)
          .where(
            and(
              eq(invitation.tokenHash, tokenDigest(token)),
              eq(invitation.email, request.user.email),
              sql`${invitation.expiresAt} > now()`,
            ),
          )
          .returning();
        if (!invite) throw new HttpError(404, "INVITATION_NOT_FOUND");
        await tx
          .insert(membership)
          .values({
            organizationId: invite.organizationId,
            userId: request.user.id,
            role: invite.role,
          })
          .onConflictDoNothing();
        return { organizationId: invite.organizationId };
      });
      request.user = { ...request.user, organizationId: result.organizationId };
      return result;
    },
  );
}
