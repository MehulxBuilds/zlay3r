import {
  db,
  eq,
  organization,
  session,
  user,
  membership,
  executionPolicy,
} from "@repo/db";

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export interface AuthRepository {
  findByEmail(email: string): Promise<User | undefined>;
  findByGoogleId(googleId: string): Promise<User | undefined>;
  createUser(input: {
    email: string;
    name: string;
    passwordHash?: string;
    googleId?: string;
  }): Promise<User>;
  createSession(input: typeof session.$inferInsert): Promise<void>;
  findSession(
    tokenHash: string,
  ): Promise<{ session: Session; user: User } | undefined>;
  deleteSession(tokenHash: string): Promise<void>;
}

export const authRepository: AuthRepository = {
  async findByEmail(email) {
    return (
      await db.select().from(user).where(eq(user.email, email)).limit(1)
    )[0];
  },
  async findByGoogleId(googleId) {
    return (
      await db.select().from(user).where(eq(user.googleId, googleId)).limit(1)
    )[0];
  },
  async createUser(input) {
    return db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organization)
        .values({ name: `${input.name}'s workspace` })
        .returning();
      const [created] = await tx
        .insert(user)
        .values({ ...input, organizationId: org!.id })
        .returning();
      await tx.insert(membership).values({
        organizationId: org!.id,
        userId: created!.id,
        role: "owner",
      });
      await tx.insert(executionPolicy).values({ organizationId: org!.id });
      return created!;
    });
  },
  async createSession(input) {
    await db.insert(session).values(input);
  },
  async findSession(tokenHash) {
    return (
      await db
        .select({ session, user })
        .from(session)
        .innerJoin(user, eq(session.userId, user.id))
        .where(eq(session.tokenHash, tokenHash))
        .limit(1)
    )[0];
  },
  async deleteSession(tokenHash) {
    await db.delete(session).where(eq(session.tokenHash, tokenHash));
  },
};
