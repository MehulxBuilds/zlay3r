"use client";

import { useEffect, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { web_env as env } from "@repo/web/lib/env";
import type { SandboxDto } from "@repo/shared";

const API = env.NEXT_PUBLIC_API_BASE;

export default function Home() {
  const [user, setUser] = useState<{ name: string; email: string } | null>(
    null,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registering, setRegistering] = useState(false);
  const [sandboxes, setSandboxes] = useState<SandboxDto[]>([]);
  const [name, setName] = useState("my-sandbox");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch(`${API}/v1/auth/me`, { credentials: "include" })
      .then(async (response) => {
        if (response.ok) setUser((await response.json()).user);
      })
      .catch(() => setMessage("Unable to connect to the server."));
  }, []);

  async function signIn(path: string, body: Record<string, string>) {
    setBusy(true);
    try {
      const response = await fetch(`${API}/v1/auth/${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Sign-in failed");
      setUser(data.user);
      setPassword("");
      setSandboxes([]);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      const response = await fetch(`${API}/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok && response.status !== 401)
        throw new Error("Sign-out failed");
      setUser(null);
      setSandboxes([]);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-out failed");
    }
  }

  async function load() {
    setBusy(true);
    try {
      const response = await fetch(`${API}/v1/sandboxes`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(await response.text());
      setSandboxes(await response.json());
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    try {
      const response = await fetch(`${API}/v1/sandboxes`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ name, memoryMb: 512, cpu: 1 }),
      });
      if (!response.ok) throw new Error(await response.text());
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "48px auto", padding: 24 }}>
      <header style={{ marginBottom: 32 }}>
        <p className="muted">AGENT INFRASTRUCTURE</p>
        <h1 style={{ fontSize: 36, fontWeight: 700 }}>Control plane</h1>
        <p className="muted">
          Manage development sandboxes and inspect platform state.
        </p>
      </header>

      <section className="panel" style={{ padding: 20, marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>
          {user
            ? `Signed in as ${user.name}`
            : registering
              ? "Create account"
              : "Sign in"}
        </h2>
        {user ? (
          <button type="button" onClick={logout}>
            Sign out
          </button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void signIn(registering ? "register" : "login", {
                email,
                password,
                ...(registering ? { name: email.split("@")[0] ?? "User" } : {}),
              });
            }}
            style={{ display: "grid", gap: 12, maxWidth: 400 }}
          >
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                style={{
                  display: "block",
                  padding: 10,
                  color: "white",
                  background: "#090d16",
                }}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                minLength={registering ? 12 : 1}
                maxLength={128}
                autoComplete={registering ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={{
                  display: "block",
                  padding: 10,
                  color: "white",
                  background: "#090d16",
                }}
              />
            </label>
            <button disabled={busy} type="submit">
              {registering ? "Create account" : "Sign in"}
            </button>
            <button type="button" onClick={() => setRegistering(!registering)}>
              {registering
                ? "Already have an account? Sign in"
                : "Create an account"}
            </button>
            {env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
              <GoogleLogin
                onSuccess={(result) => {
                  if (result.credential)
                    void signIn("google", { credential: result.credential });
                }}
                onError={() => setMessage("Google sign-in failed")}
              />
            )}
          </form>
        )}
        {message && (
          <p role="alert" style={{ color: "#fca5a5", marginTop: 12 }}>
            {message}
          </p>
        )}
      </section>

      <section className="panel" style={{ padding: 20, marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Create sandbox</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            style={{
              flex: 1,
              minWidth: 200,
              padding: 12,
              background: "#090d16",
              border: "1px solid #374151",
              borderRadius: 8,
              color: "white",
            }}
          />
          <button
            type="button"
            disabled={busy || !user}
            onClick={create}
            style={{
              padding: "12px 18px",
              background: "#2563eb",
              borderRadius: 8,
            }}
          >
            Create
          </button>
          <button
            type="button"
            disabled={busy || !user}
            onClick={load}
            style={{
              padding: "12px 18px",
              background: "#374151",
              borderRadius: 8,
            }}
          >
            Refresh
          </button>
        </div>
        {message && (
          <p style={{ color: "#fca5a5", marginTop: 12 }}>{message}</p>
        )}
      </section>

      <section className="panel" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>
          Sandboxes ({sandboxes.length})
        </h2>
        {sandboxes.length === 0 ? (
          <p className="muted">No sandboxes loaded. Click Refresh.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {sandboxes.map((sandbox) => (
              <div
                key={sandbox.id}
                style={{ padding: 14, background: "#0b1220", borderRadius: 8 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <strong>{sandbox.name}</strong>
                  <span
                    style={{
                      color:
                        sandbox.status === "RUNNING" ? "#86efac" : "#fbbf24",
                    }}
                  >
                    {sandbox.status}
                  </span>
                </div>
                <p
                  className="muted"
                  style={{ fontSize: 12, overflowWrap: "anywhere" }}
                >
                  {sandbox.id}
                </p>
                <p className="muted" style={{ fontSize: 12 }}>
                  {sandbox.memoryMb} MB · {sandbox.cpu} CPU
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
