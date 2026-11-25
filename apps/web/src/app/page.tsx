"use client";

import { PixelPanel } from "@repo/web/components/pixel-panel";

import { useEffect, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { AgentPlatformClient } from "@repo/sdk";
import { web_env as env } from "@repo/web/lib/env";
import { Dashboard } from "@repo/web/components/dashboard";

const client = new AgentPlatformClient({ baseUrl: env.NEXT_PUBLIC_API_BASE });
export default function Home() {
  const [user, setUser] = useState<{ name: string; email: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void client
      .me()
      .then(({ user }) =>
        setUser({ name: String(user.name), email: String(user.email) }),
      )
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "UNAUTHORIZED")
          setError("Unable to restore your session. Check the API connection.");
      })
      .finally(() => setLoading(false));
  }, []);
  async function signIn(
    action: () => Promise<{ user: { [key: string]: unknown } }>,
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      setUser({
        name: String(result.user.name),
        email: String(result.user.email),
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message.replaceAll("_", " ")
          : "Sign in failed",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="auth-screen">
        <p className="pixel-label">LOADING WORKSPACE…</p>
      </main>
    );
  if (user)
    return (
      <Dashboard
        user={user}
        onLogout={async () => {
          await client.logout();
          setUser(null);
        }}
      />
    );
  return (
    <main className="auth-screen">
      <PixelPanel className="auth-panel">
        <div className="brand">
          <span className="brand-mark">Z</span> ZLAYER{" "}
          <span className="pixel-label">CONTROL PLANE</span>
        </div>
        <p className="eyebrow">YOUR AGENTS. YOUR WORKSPACE.</p>
        <h1>{registering ? "Build your next agent." : "Back to building."}</h1>
        <p className="muted">
          Isolated environments. Visible execution. One place to manage it all.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const email = String(data.get("email")),
              password = String(data.get("password"));
            void signIn(() =>
              registering
                ? client.register({
                    email,
                    password,
                    name: String(data.get("name")),
                  })
                : client.login(email, password),
            );
          }}
        >
          {registering && (
            <label>
              Your name
              <input name="name" required maxLength={100} autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={registering ? 12 : 1}
              maxLength={128}
              required
              autoComplete={registering ? "new-password" : "current-password"}
            />
          </label>
          {registering && (
            <p className="muted small">Use at least 12 characters.</p>
          )}
          <button
            className="pixel-button primary"
            disabled={busy}
            type="submit"
          >
            {busy
              ? "Please wait…"
              : registering
                ? "Create workspace →"
                : "Sign in →"}
          </button>
        </form>
        {env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
          <div className="google-signin">
            <GoogleLogin
              onSuccess={(result) => {
                if (result.credential)
                  void signIn(() => client.google(result.credential!));
              }}
              onError={() => setError("Google sign-in failed")}
            />
          </div>
        )}
        <button
          className="text-button"
          type="button"
          onClick={() => setRegistering(!registering)}
        >
          {registering
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
      </PixelPanel>
      <p className="pixel-label footer-label">
        A LITTLE PIXEL. A LOT OF POSSIBILITY.
      </p>
    </main>
  );
}
