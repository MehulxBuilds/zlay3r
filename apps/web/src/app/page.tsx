"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function Home() {
  const [apiKey, setApiKey] = useState("dev-change-me");
  const [sandboxes, setSandboxes] = useState<any[]>([]);
  const [name, setName] = useState("my-sandbox");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setBusy(true);
    try {
      const response = await fetch(`${API}/v1/sandboxes`, {
        headers: { authorization: `Bearer ${apiKey}` }
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
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ name, memoryMb: 512, cpu: 1 })
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
        <p className="muted">Manage development sandboxes and inspect platform state.</p>
      </header>

      <section className="panel" style={{ padding: 20, marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>API connection</h2>
        <label className="muted">Development API key</label>
        <input
          value={apiKey}
          onChange={event => setApiKey(event.target.value)}
          style={{ display: "block", width: "100%", marginTop: 8, padding: 12, background: "#090d16", border: "1px solid #374151", borderRadius: 8, color: "white" }}
        />
      </section>

      <section className="panel" style={{ padding: 20, marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Create sandbox</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            style={{ flex: 1, minWidth: 200, padding: 12, background: "#090d16", border: "1px solid #374151", borderRadius: 8, color: "white" }}
          />
          <button disabled={busy} onClick={create} style={{ padding: "12px 18px", background: "#2563eb", borderRadius: 8 }}>
            Create
          </button>
          <button disabled={busy} onClick={load} style={{ padding: "12px 18px", background: "#374151", borderRadius: 8 }}>
            Refresh
          </button>
        </div>
        {message && <p style={{ color: "#fca5a5", marginTop: 12 }}>{message}</p>}
      </section>

      <section className="panel" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>Sandboxes ({sandboxes.length})</h2>
        {sandboxes.length === 0 ? (
          <p className="muted">No sandboxes loaded. Click Refresh.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {sandboxes.map(sandbox => (
              <div key={sandbox.id} style={{ padding: 14, background: "#0b1220", borderRadius: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <strong>{sandbox.name}</strong>
                  <span style={{ color: sandbox.status === "RUNNING" ? "#86efac" : "#fbbf24" }}>{sandbox.status}</span>
                </div>
                <p className="muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{sandbox.id}</p>
                <p className="muted" style={{ fontSize: 12 }}>{sandbox.memoryMb} MB · {sandbox.cpu} CPU</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
