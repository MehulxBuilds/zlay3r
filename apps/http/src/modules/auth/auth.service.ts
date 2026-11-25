import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "../../lib/errors";
import type { AuthRepository, User } from "./auth.repository";
import { hashPassword, verifyPassword } from "./password";

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
}
export type GoogleVerifier = (credential: string) => Promise<GoogleIdentity>;
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const publicUser = ({ id, email, name, organizationId }: User) => ({
  id,
  email,
  name,
  organizationId,
});

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (
    ("code" in error && error.code === "23505") ||
    ("cause" in error && isUniqueViolation(error.cause))
  );
}

export function createAuthService(
  repository: AuthRepository,
  verifyGoogle: GoogleVerifier,
) {
  // A real hash keeps unknown-email login on the same password verification path.
  const dummyHash = hashPassword(randomBytes(32).toString("hex"));
  async function startSession(user: User) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
    await repository.createSession({
      userId: user.id,
      tokenHash: digest(token),
      expiresAt,
    });
    return { token, expiresAt, user: publicUser(user) };
  }
  async function createUser(
    input: Parameters<AuthRepository["createUser"]>[0],
  ) {
    try {
      return await repository.createUser(input);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new HttpError(409, "ACCOUNT_ALREADY_EXISTS");
      throw error;
    }
  }
  return {
    async register(input: { email: string; password: string; name: string }) {
      if (await repository.findByEmail(input.email))
        throw new HttpError(409, "ACCOUNT_ALREADY_EXISTS");
      const created = await createUser({
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
      });
      return startSession(created);
    },
    async login(input: { email: string; password: string }) {
      const user = await repository.findByEmail(input.email);
      const valid = await verifyPassword(
        input.password,
        user?.passwordHash ?? (await dummyHash),
      );
      if (!user?.passwordHash || !valid)
        throw new HttpError(401, "INVALID_CREDENTIALS");
      return startSession(user);
    },
    async google(credential: string) {
      const identity = await verifyGoogle(credential);
      let user = await repository.findByGoogleId(identity.sub);
      if (!user) {
        // Linking by email alone could let an external identity take over a local account.
        if (await repository.findByEmail(identity.email))
          throw new HttpError(409, "SIGN_IN_WITH_EXISTING_METHOD");
        user = await createUser({
          email: identity.email,
          name: identity.name ?? identity.email,
          googleId: identity.sub,
        });
      }
      return startSession(user);
    },
    async authenticate(token?: string) {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new HttpError(401, "UNAUTHORIZED");
      const result = await repository.findSession(digest(token));
      if (!result || result.session.expiresAt.getTime() <= Date.now())
        throw new HttpError(401, "UNAUTHORIZED");
      return publicUser(result.user);
    },
    async logout(token: string) {
      await repository.deleteSession(digest(token));
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
export type AuthUser = Awaited<ReturnType<AuthService["authenticate"]>>;
