import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildApp, type AppDependencies } from "./app";
import {
  createAuthService,
  type GoogleVerifier,
} from "./modules/auth/auth.service";
import type {
  AuthRepository,
  Session,
  User,
} from "./modules/auth/auth.repository";
import { HttpError } from "./lib/errors";

function memoryRepository() {
  const users: User[] = [];
  const sessions = new Map<string, Session>();
  const repository: AuthRepository = {
    async findByEmail(email) {
      return users.find((user) => user.email === email);
    },
    async findByGoogleId(id) {
      return users.find((user) => user.googleId === id);
    },
    async createUser(input) {
      const user: User = {
        id: randomUUID(),
        organizationId: randomUUID(),
        email: input.email,
        name: input.name,
        googleId: input.googleId ?? null,
        passwordHash: input.passwordHash ?? null,
        createdAt: new Date(),
      };
      users.push(user);
      return user;
    },
    async createSession(input) {
      sessions.set(input.tokenHash, { ...input, createdAt: new Date() });
    },
    async findSession(hash) {
      const session = sessions.get(hash);
      const user = users.find((user) => user.id === session?.userId);
      return session && user ? { session, user } : undefined;
    },
    async deleteSession(hash) {
      sessions.delete(hash);
    },
  };
  return { repository, users, sessions };
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup(
  google: GoogleVerifier = async () => {
    throw new HttpError(401, "INVALID_GOOGLE_CREDENTIAL");
  },
) {
  const store = memoryRepository();
  const auth = createAuthService(store.repository, google);
  const calls: string[] = [];
  const deps: AppDependencies = {
    auth,
    sandboxes: {
      async list(org) {
        calls.push(org);
        return [];
      },
      async find() {
        throw new HttpError(404, "SANDBOX_NOT_FOUND");
      },
      async create() {
        throw new Error("Not used");
      },
      async execute() {
        throw new Error("Not used");
      },
      async destroy() {},
    },
    runs: {
      async create() {
        throw new Error("Not used");
      },
      async get() {
        throw new HttpError(404, "RUN_NOT_FOUND");
      },
    },
    async ready() {},
    async close() {},
  };
  const app = await buildApp(deps);
  apps.push(app);
  return { app, auth, store, calls, deps };
}

const credentials = {
  email: "Person@Example.com",
  name: "Person",
  password: "a-long-test-password",
};
const origin = "http://localhost:3000";

describe("authentication HTTP contract", () => {
  test("registration hashes passwords and session tokens; login and logout revoke access", async () => {
    const { app, store, calls } = await setup();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: credentials,
    });
    expect(registered.statusCode).toBe(201);
    const { token, user } = registered.json();
    expect(user.email).toBe("person@example.com");
    expect(user.passwordHash).toBeUndefined();
    expect(store.users[0]!.passwordHash).toStartWith("scrypt:");
    expect(store.sessions.has(token)).toBe(false);
    expect(store.sessions.size).toBe(1);
    expect(String(registered.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(registered.headers["set-cookie"])).toContain("SameSite=Lax");
    const headers = { authorization: `Bearer ${token}` };
    expect(
      (await app.inject({ url: "/v1/sandboxes", headers })).statusCode,
    ).toBe(200);
    expect(calls).toEqual([user.organizationId]);
    expect(
      (await app.inject({ url: "/v1/auth/me", headers })).json().user.id,
    ).toBe(user.id);
    expect(
      (await app.inject({ method: "POST", url: "/v1/auth/logout", headers }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ url: "/v1/sandboxes", headers })).statusCode,
    ).toBe(401);
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: credentials,
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().token).not.toBe(token);
  });

  test("unknown users, wrong passwords, expired sessions and the old development key are rejected", async () => {
    const { app, auth, store } = await setup();
    expect((await app.inject({ url: "/v1/sandboxes" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: "/v1/runs/abc",
          headers: { authorization: "Bearer dev-change-me" },
        })
      ).statusCode,
    ).toBe(401);
    const input = { ...credentials, email: credentials.email.toLowerCase() };
    const result = await auth.register(input);
    for (const payload of [
      { ...input, password: "incorrect" },
      { email: "nobody@example.com", password: input.password },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe("INVALID_CREDENTIALS");
    }
    for (const session of store.sessions.values())
      session.expiresAt = new Date(0);
    expect(
      (
        await app.inject({
          url: "/v1/auth/me",
          headers: { authorization: `Bearer ${result.token}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  test("duplicate accounts and invalid payloads are handled without leaking internals", async () => {
    const { app } = await setup();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: { ...credentials, password: "short" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: credentials,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: credentials,
        })
      ).statusCode,
    ).toBe(409);
  });

  test("cookie sessions work with trusted origins and reject CSRF", async () => {
    const { app } = await setup();
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: credentials,
    });
    const cookie = `zlayer_session=${registration.json().token}`;
    expect(
      (await app.inject({ url: "/v1/auth/me", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    for (const headers of [
      { cookie },
      { cookie, origin: "https://attacker.example" },
    ]) {
      expect(
        (await app.inject({ method: "POST", url: "/v1/auth/logout", headers }))
          .statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/logout",
          headers: { cookie, origin },
        })
      ).statusCode,
    ).toBe(204);
  });

  test("Google identities reuse subject IDs and cannot take over password accounts", async () => {
    const { app, store, auth } = await setup(async (credential) => {
      if (credential !== "valid")
        throw new HttpError(401, "INVALID_GOOGLE_CREDENTIAL");
      return {
        sub: "google-subject",
        email: "google@example.com",
        name: "Google User",
      };
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/google",
          payload: { credential: "invalid" },
        })
      ).statusCode,
    ).toBe(401);
    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/google",
      payload: { credential: "valid" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/google",
      payload: { credential: "valid" },
    });
    expect(first.statusCode).toBe(200);
    expect(second.json().user.id).toBe(first.json().user.id);
    expect(store.users).toHaveLength(1);
    expect(store.users[0]!.passwordHash).toBeNull();
    await auth.register({
      ...credentials,
      email: credentials.email.toLowerCase(),
    });
    const conflicting = createAuthService(store.repository, async () => ({
      sub: "other-subject",
      email: credentials.email.toLowerCase(),
    }));
    await expect(conflicting.google("valid")).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  test("rate limits auth attempts and keeps health endpoints public", async () => {
    const { app, deps } = await setup();
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
    deps.ready = async () => {
      throw new Error("offline");
    };
    expect((await app.inject({ url: "/health/ready" })).statusCode).toBe(503);
    for (let attempt = 0; attempt < 10; attempt++) {
      await app.inject({ method: "POST", url: "/v1/auth/login", payload: {} });
    }
    expect(
      (await app.inject({ method: "POST", url: "/v1/auth/login", payload: {} }))
        .statusCode,
    ).toBe(429);
  });
});
