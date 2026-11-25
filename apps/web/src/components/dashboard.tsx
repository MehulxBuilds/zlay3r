"use client";

import {
  FileControls,
  BrowserControls,
} from "@repo/web/components/workspace-controls";
import { Settings } from "@repo/web/components/settings";
import { fields, display } from "@repo/web/components/dashboard-utils";
import { PixelPanel } from "@repo/web/components/pixel-panel";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AgentPlatformClient,
  PlatformError,
  type Resource,
  type ExecutionEvent,
} from "@repo/sdk";
import { web_env as env } from "@repo/web/lib/env";

const sections = [
  "Overview",
  "Sandboxes",
  "Runs",
  "Sessions",
  "Executions",
  "Browsers",
  "Artifacts",
  "Providers",
  "API keys",
  "Approvals",
  "Usage",
  "Settings",
  "Audit",
  "Activity",
  "MCP",
] as const;
type Section = (typeof sections)[number];
const paths: Partial<Record<Section, string>> = {
  Sandboxes: "sandboxes",
  Runs: "runs",
  Sessions: "sessions",
  Executions: "executions",
  Browsers: "browsers",
  Artifacts: "artifacts",
  Providers: "providers",
  "API keys": "api-keys",
  Approvals: "approvals",
  Usage: "usage",
  Settings: "policies",
  Audit: "audit",
  Activity: "activity",
  MCP: "mcp-servers",
};
const descriptions: Record<Section, string> = {
  Overview: "Your workspace at a glance.",
  Sandboxes: "Isolated workspaces for code, tools, and agents.",
  Runs: "Follow each agent from first thought to final result.",
  Sessions: "Persistent conversations and execution history.",
  Executions: "Commands, output, and execution status.",
  Browsers: "Isolated browser sessions and collected screenshots.",
  Artifacts: "Files and outputs collected in your private R2 storage.",
  Providers: "Choose the models your agents can use.",
  "API keys": "Scoped credentials for your applications.",
  Approvals: "Review sensitive actions before they execute.",
  Usage: "This month’s consumption and configured limits.",
  Settings: "Workspace identity, members, secrets, and execution policy.",
  Audit: "A record of changes in your workspace.",
  Activity: "Sandbox lifecycle and collected artifact events.",
  MCP: "Connect external tools through authorized MCP servers.",
};
export function Dashboard({
  user,
  onLogout,
}: {
  user: { name: string; email: string };
  onLogout(): Promise<void>;
}) {
  const [section, setSection] = useState<Section>("Overview");
  const [organizations, setOrganizations] = useState<
    { id: string; name: string; role: string }[]
  >([]);
  const [organizationId, setOrganizationId] = useState("");
  const [rows, setRows] = useState<Resource[]>([]);
  const [sandboxes, setSandboxes] = useState<Resource[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown>>({});
  const [detail, setDetail] = useState<Resource | null>(null);
  const selectedId = detail?.id;
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const role = organizations.find(
    (organization) => organization.id === organizationId,
  )?.role;
  const admin = role === "owner" || role === "admin";
  const writable = role !== "viewer";
  const client = useMemo(
    () =>
      new AgentPlatformClient({
        baseUrl: env.NEXT_PUBLIC_API_BASE,
        organizationId: organizationId || undefined,
      }),
    [organizationId],
  );
  useEffect(() => {
    void client
      .listOrganizations()
      .then((items) => {
        setOrganizations(items);
        setOrganizationId((current) => current || items[0]?.id || "");
      })
      .catch((error: unknown) =>
        setNotice(
          error instanceof Error
            ? error.message
            : "Unable to load organizations",
        ),
      );
  }, [client]);
  const refresh = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const boxes = await client.request<Resource[]>("/v1/sandboxes");
      setSandboxes(boxes);
      if (section === "Overview") {
        const [runs, usage] = await Promise.all([
          client.listRuns(),
          client.getUsage(),
        ]);
        setRows(runs as unknown as Resource[]);
        setSummary({
          sandboxes: boxes.length,
          running: boxes.filter((box) => box.status === "RUNNING").length,
          runs: runs.length,
          ...usage,
        });
      } else if (section !== "Usage" && section !== "Settings") {
        const result = await client.page<Resource>(`/v1/${paths[section]}`);
        setRows(result.items);
        setNextCursor(result.nextCursor);
        setSummary({});
      } else {
        const data = await client.request<unknown>(`/v1/${paths[section]}`);
        if (Array.isArray(data)) {
          setRows(data as Resource[]);
          setSummary({});
        } else {
          const record = (data as Record<string, unknown>) ?? {};
          setRows(
            Array.isArray(record.items) ? (record.items as Resource[]) : [],
          );
          setSummary(record);
        }
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to load workspace",
      );
    } finally {
      setLoading(false);
    }
  }, [client, organizationId, section]);
  useEffect(() => {
    setDetail(null);
    setNotice("");
    setNextCursor(null);
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (selectedId) setPreview("");
  }, [selectedId]);
  useEffect(() => {
    if (
      role &&
      !admin &&
      ["API keys", "Settings", "Audit", "MCP"].includes(section)
    )
      setSection("Overview");
  }, [role, admin, section]);
  useEffect(() => {
    if (!selectedId || section !== "Runs") return;
    const controller = new AbortController();
    setEvents([]);
    void (async () => {
      try {
        for await (const event of client.events(selectedId, {
          signal: controller.signal,
        }))
          setEvents((current) => [...current.slice(-499), event]);
      } catch (error) {
        if (!controller.signal.aborted)
          setNotice(
            error instanceof Error
              ? error.message
              : "Live connection interrupted. Reopen this run to reconnect.",
          );
      }
    })();
    return () => controller.abort();
  }, [client, selectedId, section]);
  async function act(action: () => Promise<unknown>, message = "Saved.") {
    setBusy(true);
    setNotice("");
    try {
      const result = await action();
      setNotice(message);
      await refresh();
      return result;
    } catch (error) {
      setNotice(
        error instanceof PlatformError
          ? `${typeof error.details.message === "string" ? error.details.message : error.code.replaceAll("_", " ")}${error.details.approvalId ? ". Review the action in Approvals, then retry." : ""}`
          : error instanceof Error
            ? error.message
            : "Action failed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const result = await client.page<Resource>(`/v1/${paths[section]}`, {
        cursor: nextCursor,
      });
      setRows((rows) => [...rows, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to load the next page",
      );
    } finally {
      setLoading(false);
    }
  }
  const post = (path: string, body: unknown) =>
    client.request<Resource>(`/v1/${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  const boxSelect = (
    <label>
      Sandbox
      <select name="sandboxId" required>
        <option value="">Select a running sandbox</option>
        {sandboxes
          .filter((box) => box.status === "RUNNING")
          .map((box) => (
            <option key={box.id} value={box.id}>
              {display(box.name)}
            </option>
          ))}
      </select>
    </label>
  );
  const columns =
    section === "Sandboxes"
      ? ["name", "status", "memoryMb", "cpu"]
      : section === "Runs" || section === "Overview"
        ? ["task", "status", "provider", "createdAt"]
        : section === "Artifacts"
          ? ["filename", "mimeType", "size", "status"]
          : section === "Providers"
            ? ["provider", "model", "configured"]
            : section === "API keys"
              ? ["name", "prefix", "scopes", "expiresAt"]
              : section === "Sessions"
                ? ["title", "createdAt"]
                : section === "Approvals"
                  ? ["status", "action", "expiresAt"]
                  : section === "Executions"
                    ? ["command", "status", "createdAt"]
                    : section === "Activity"
                      ? ["type", "resourceId", "createdAt"]
                      : section === "Audit"
                        ? ["action", "actorId", "createdAt"]
                        : ["name", "id", "status"];
  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">Z</span> ZLAYER
        </a>
        <p className="pixel-label">WORKSPACE</p>
        <label className="sr-only" htmlFor="organization">
          Organization
        </label>
        <select
          id="organization"
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
        >
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        <nav aria-label="Workspace navigation">
          {sections
            .filter(
              (item) =>
                admin ||
                !["API keys", "Settings", "Audit", "MCP"].includes(item),
            )
            .map((item, index) => (
              <button
                key={item}
                type="button"
                aria-current={section === item ? "page" : undefined}
                className={section === item ? "nav-item active" : "nav-item"}
                onClick={() => setSection(item)}
              >
                <span className="nav-pixel">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {item}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <strong>{user.name}</strong>
          <span className="muted small">{user.email}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => void act(onLogout, "Signed out")}
          >
            Sign out ↗
          </button>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="topbar">
          <span className="pixel-label">
            WORKSPACE / {section.toUpperCase()}
          </span>
          <span className="environment">
            <span className="status-dot" /> CONTROL PLANE
          </span>
        </header>
        <div className="page-heading">
          <div>
            <p className="eyebrow">BUILD · EXECUTE · OBSERVE</p>
            <h1>{section}</h1>
            <p className="muted">{descriptions[section]}</p>
          </div>
          <button
            className="pixel-button"
            disabled={loading || busy}
            type="button"
            onClick={() => void refresh()}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
        {notice && <output className="notice">{notice}</output>}
        {section === "Overview" && (
          <div className="stats-grid">
            {[
              ["TOTAL SANDBOXES", summary.sandboxes],
              ["RUNNING NOW", summary.running],
              ["RECENT RUNS", summary.runs],
            ].map(([label, value]) => (
              <PixelPanel className="stat" key={String(label)}>
                <span className="pixel-label">{String(label)}</span>
                <strong>{String(value ?? "—")}</strong>
                <span className="muted small">Current workspace</span>
              </PixelPanel>
            ))}
          </div>
        )}
        {writable &&
          (admin || !["Providers", "API keys", "MCP"].includes(section)) &&
          [
            "Sandboxes",
            "Runs",
            "Sessions",
            "Executions",
            "Browsers",
            "Providers",
            "API keys",
            "MCP",
          ].includes(section) && (
            <PixelPanel className="create-panel">
              <h2>
                {section === "Runs"
                  ? "Start an agent run"
                  : section === "Executions"
                    ? "Execute a command"
                    : `Create ${section === "API keys" ? "API key" : section === "MCP" ? "MCP connection" : section.toLowerCase().replace(/s$/, "")}`}
              </h2>
              <form
                className="form-grid"
                onSubmit={(event) => {
                  const form = event.currentTarget;
                  const data = fields(event);
                  void act(
                    async () => {
                      if (section === "Sandboxes")
                        return client.createSandbox({
                          name: String(data.name),
                          memoryMb: Number(data.memoryMb),
                          cpu: Number(data.cpu),
                        });
                      if (section === "Runs")
                        return client.createRun({
                          sandboxId: String(data.sandboxId),
                          task: String(data.task),
                          provider: String(data.provider) as "openai",
                          ...(data.sessionId
                            ? { sessionId: String(data.sessionId) }
                            : {}),
                        });
                      if (section === "Sessions")
                        return client.createSession(String(data.title));
                      if (section === "Executions")
                        return client.createExecution({
                          sandboxId: String(data.sandboxId),
                          command: String(data.command),
                        });
                      if (section === "Browsers")
                        return client.createBrowser(String(data.sandboxId));
                      if (section === "Providers")
                        return client.request(
                          `/v1/providers/${data.provider}`,
                          {
                            method: "PUT",
                            body: JSON.stringify({
                              model: data.model,
                              apiKey: data.apiKey,
                              settings: {
                                ...(String(data.routing ?? "").trim()
                                  ? {
                                      routing: JSON.parse(
                                        String(data.routing),
                                      ) as Record<string, unknown>,
                                    }
                                  : {}),
                                fallbacks: String(data.fallbacks ?? "")
                                  .split(",")
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                                aliases: Object.fromEntries(
                                  String(data.aliases ?? "")
                                    .split("\n")
                                    .filter((line) => line.trim())
                                    .map((line) => {
                                      const separator = line.indexOf("=");
                                      if (separator < 1)
                                        throw new Error(
                                          "Aliases must use alias=model",
                                        );
                                      return [
                                        line.slice(0, separator).trim(),
                                        line.slice(separator + 1).trim(),
                                      ];
                                    }),
                                ),
                                ...(data.inputPrice
                                  ? {
                                      inputPricePerMillion: Number(
                                        data.inputPrice,
                                      ),
                                    }
                                  : {}),
                                ...(data.outputPrice
                                  ? {
                                      outputPricePerMillion: Number(
                                        data.outputPrice,
                                      ),
                                    }
                                  : {}),
                              },
                            }),
                          },
                        );
                      if (section === "API keys") {
                        const result = await post("api-keys", {
                          name: data.name,
                          scopes: String(data.scopes)
                            .split(",")
                            .map((v) => v.trim()),
                        });
                        setNotice(
                          `Copy this key now; it will not be shown again: ${result.token}`,
                        );
                        return result;
                      }
                      if (section === "MCP")
                        return post("mcp-servers", {
                          name: data.name,
                          configuration: { transport: "http", url: data.url },
                        });
                    },
                    section === "API keys" ? "" : "Created.",
                  ).then((result) => {
                    if (result && ["Providers", "API keys"].includes(section))
                      form.reset();
                    if (section === "API keys" && result)
                      setNotice(
                        `Copy this key now; it will not be shown again: ${(result as Resource).token}`,
                      );
                  });
                }}
              >
                {section === "Sandboxes" && (
                  <>
                    <label>
                      Name
                      <input
                        name="name"
                        defaultValue="my-sandbox"
                        required
                        pattern="[a-zA-Z0-9_-]+"
                        maxLength={40}
                      />
                    </label>
                    <label>
                      Memory (MB)
                      <input
                        name="memoryMb"
                        type="number"
                        min={128}
                        max={2048}
                        defaultValue={512}
                        required
                      />
                    </label>
                    <label>
                      CPU cores
                      <input
                        name="cpu"
                        type="number"
                        min={0.25}
                        max={2}
                        step={0.25}
                        defaultValue={1}
                        required
                      />
                    </label>
                  </>
                )}
                {["Runs", "Executions", "Browsers"].includes(section) &&
                  boxSelect}
                {section === "Runs" && (
                  <>
                    <label className="wide">
                      Task
                      <textarea
                        name="task"
                        required
                        maxLength={20000}
                        placeholder="What should the agent accomplish?"
                      />
                    </label>
                    <label>
                      Session ID (optional)
                      <input name="sessionId" />
                    </label>
                  </>
                )}
                {["Runs", "Providers"].includes(section) && (
                  <label>
                    Provider
                    <select name="provider">
                      {["openai", "anthropic", "deepseek", "openrouter"].map(
                        (name) => (
                          <option key={name}>{name}</option>
                        ),
                      )}
                    </select>
                  </label>
                )}
                {section === "Executions" && (
                  <label className="wide">
                    Command
                    <input
                      name="command"
                      required
                      maxLength={4000}
                      placeholder="ls -la"
                    />
                  </label>
                )}
                {section === "Sessions" && (
                  <label className="wide">
                    Title
                    <input
                      name="title"
                      required
                      maxLength={200}
                      placeholder="A new conversation"
                    />
                  </label>
                )}
                {section === "Providers" && (
                  <>
                    <label>
                      Model
                      <input
                        name="model"
                        required
                        placeholder="Provider model identifier"
                      />
                    </label>
                    <label>
                      API key
                      <input
                        name="apiKey"
                        type="password"
                        required
                        autoComplete="off"
                      />
                    </label>
                  </>
                )}
                {section === "API keys" && (
                  <>
                    <label>
                      Name
                      <input name="name" required />
                    </label>
                    <label>
                      Permissions, separated by commas
                      <input
                        name="scopes"
                        defaultValue="sandbox.read,runs.read,runs.write,models.use,sandbox.execute,files.read"
                        required
                      />
                    </label>
                  </>
                )}
                {section === "Providers" && (
                  <>
                    <label>
                      Fallback providers (in order)
                      <input
                        name="fallbacks"
                        placeholder="Leave empty to disable fallback"
                      />
                    </label>
                    <label className="wide">
                      Model aliases (one alias=model per line)
                      <textarea
                        name="aliases"
                        placeholder="fast=your-model-id"
                      />
                    </label>
                    <label className="wide">
                      OpenRouter routing (optional JSON)
                      <textarea
                        name="routing"
                        placeholder={
                          '{"order":["provider"],"allow_fallbacks":false}'
                        }
                      />
                    </label>
                    <label>
                      Input price per million tokens (USD, optional)
                      <input
                        type="number"
                        min={0}
                        step="any"
                        name="inputPrice"
                      />
                    </label>
                    <label>
                      Output price per million tokens (USD, optional)
                      <input
                        type="number"
                        min={0}
                        step="any"
                        name="outputPrice"
                      />
                    </label>
                  </>
                )}
                {section === "MCP" && (
                  <>
                    <label>
                      Name
                      <input name="name" required />
                    </label>
                    <label>
                      HTTPS endpoint
                      <input name="url" type="url" required />
                    </label>
                  </>
                )}
                <button
                  className="pixel-button primary form-submit"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? "Working…" : "Create →"}
                </button>
              </form>
            </PixelPanel>
          )}
        {section === "Usage" && (
          <div className="stats-grid">
            {(
              (summary.totals as {
                metric: string;
                quantity: string;
                unit: string;
              }[]) ?? []
            ).map((row) => (
              <PixelPanel key={row.metric} className="stat">
                <span className="pixel-label">{row.metric.toUpperCase()}</span>
                <strong>{Number(row.quantity).toLocaleString()}</strong>
                <span className="muted">{row.unit}</span>
              </PixelPanel>
            ))}
          </div>
        )}
        {section === "Settings" && (
          <Settings client={client} policy={summary} act={act} />
        )}
        {section !== "Settings" && section !== "Usage" && (
          <PixelPanel className="data-panel">
            <div className="section-heading">
              <h2>{section === "Overview" ? "Recent agent runs" : section}</h2>
              <span className="pixel-label">{rows.length} RECORDS</span>
            </div>
            {loading ? (
              <p className="empty-state">Loading your workspace…</p>
            ) : rows.length === 0 ? (
              <div className="empty-state">
                <span className="empty-pixel">□</span>
                <h3>
                  No {section === "Overview" ? "runs" : section.toLowerCase()}{" "}
                  yet
                </h3>
                <p className="muted">
                  Your workspace activity will appear here.
                </p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column}>
                          {column.replaceAll(/([A-Z])/g, " $1")}
                        </th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id ?? String(row.provider)}>
                        {columns.map((column) => (
                          <td key={column}>
                            {column === "status" ? (
                              <span
                                className={`badge ${String(row[column]).toLowerCase()}`}
                              >
                                {display(row[column])}
                              </span>
                            ) : (
                              <span className="cell-value">
                                {display(row[column])}
                              </span>
                            )}
                          </td>
                        ))}
                        <td>
                          <div className="row-actions">
                            <button
                              className="text-button"
                              type="button"
                              onClick={() =>
                                void act(async () => {
                                  const selected = [
                                    "Runs",
                                    "Overview",
                                  ].includes(section)
                                    ? await client.request<Resource>(
                                        `/v1/runs/${row.id}`,
                                      )
                                    : section === "Sessions"
                                      ? await client.getSession(row.id)
                                      : row;
                                  setDetail(selected);
                                }, "")
                              }
                            >
                              Inspect ↗
                            </button>
                            {section === "Sandboxes" && (
                              <>
                                {[
                                  "start",
                                  "stop",
                                  "pause",
                                  "resume",
                                  "restart",
                                ].map((action) => (
                                  <button
                                    key={action}
                                    className="text-button"
                                    disabled={busy}
                                    type="button"
                                    onClick={() =>
                                      void act(() =>
                                        client.sandboxLifecycle(
                                          row.id,
                                          action as "start",
                                        ),
                                      )
                                    }
                                  >
                                    {action}
                                  </button>
                                ))}
                                <button
                                  className="text-button danger"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        "Destroy this sandbox and its ephemeral workspace?",
                                      )
                                    )
                                      void act(() =>
                                        client.destroySandbox(row.id),
                                      );
                                  }}
                                >
                                  Destroy
                                </button>
                              </>
                            )}
                            {section === "Runs" && (
                              <>
                                <button
                                  className="text-button"
                                  type="button"
                                  onClick={() =>
                                    void act(() => client.cancelRun(row.id))
                                  }
                                >
                                  Cancel
                                </button>
                                <button
                                  className="text-button"
                                  type="button"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        "Resume this run? An interrupted external action may have completed. Review its events before continuing.",
                                      )
                                    )
                                      void act(() =>
                                        client.resumeRun(row.id, true),
                                      );
                                  }}
                                >
                                  Resume
                                </button>
                              </>
                            )}
                            {section === "Executions" && (
                              <button
                                className="text-button"
                                type="button"
                                onClick={() =>
                                  void act(() => client.cancelExecution(row.id))
                                }
                              >
                                Cancel
                              </button>
                            )}
                            {section === "Artifacts" && (
                              <button
                                className="text-button"
                                type="button"
                                onClick={() =>
                                  void act(async () => {
                                    const result =
                                      await client.downloadArtifact(row.id);
                                    window.open(
                                      result.url,
                                      "_blank",
                                      "noopener,noreferrer",
                                    );
                                  }, "")
                                }
                              >
                                Download ↓
                              </button>
                            )}
                            {section === "API keys" && (
                              <button
                                className="text-button"
                                type="button"
                                onClick={() =>
                                  void act(
                                    () => post(`api-keys/${row.id}/rotate`, {}),
                                    "",
                                  ).then((result) => {
                                    if (result)
                                      setNotice(
                                        `Copy this rotated key now: ${(result as Resource).token}`,
                                      );
                                  })
                                }
                              >
                                Rotate
                              </button>
                            )}
                            {section === "API keys" && (
                              <button
                                className="text-button danger"
                                type="button"
                                onClick={() =>
                                  void act(() =>
                                    client.request(`/v1/api-keys/${row.id}`, {
                                      method: "DELETE",
                                    }),
                                  )
                                }
                              >
                                Revoke
                              </button>
                            )}
                            {admin &&
                              section === "Approvals" &&
                              row.status === "PENDING" && (
                                <>
                                  {[true, false].map((approve) => (
                                    <button
                                      key={String(approve)}
                                      className="text-button"
                                      type="button"
                                      onClick={() =>
                                        void act(
                                          () =>
                                            post(
                                              `approvals/${row.id}/decision`,
                                              { approve },
                                            ),
                                          "Decision saved. Resume the waiting run to continue.",
                                        )
                                      }
                                    >
                                      {approve ? "Approve" : "Reject"}
                                    </button>
                                  ))}
                                </>
                              )}
                            {section === "Browsers" && (
                              <button
                                className="text-button danger"
                                type="button"
                                onClick={() =>
                                  void act(() => client.closeBrowser(row.id))
                                }
                              >
                                Close
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PixelPanel>
        )}
        {nextCursor && !["Overview", "Usage", "Settings"].includes(section) && (
          <button
            className="pixel-button load-more"
            disabled={busy || loading}
            type="button"
            onClick={() => void loadMore()}
          >
            Load more ↓
          </button>
        )}
        {detail && (
          <PixelPanel className="detail-panel">
            <div className="section-heading">
              <h2>Inspection</h2>
              <button
                className="text-button"
                type="button"
                onClick={() => setDetail(null)}
              >
                Close ×
              </button>
            </div>
            {typeof detail.task === "string" && (
              <>
                <h3>Task</h3>
                <p>{detail.task}</p>
              </>
            )}
            {detail.result != null && (
              <>
                <h3>Result</h3>
                <pre>
                  {display(
                    typeof detail.result === "object" &&
                      "finalAnswer" in detail.result
                      ? detail.result.finalAnswer
                      : detail.result,
                  )}
                </pre>
              </>
            )}
            {Array.isArray(detail.messages) && (
              <div className="event-feed">
                {detail.messages.map((value, index) => {
                  const message = value as Record<string, unknown>;
                  return (
                    <article key={String(message.id ?? index)}>
                      <h3>{String(message.role)}</h3>
                      <pre>{display(message.content)}</pre>
                    </article>
                  );
                })}
              </div>
            )}
            <details>
              <summary>Resource details</summary>
              <pre>{display(detail)}</pre>
            </details>
            {events.length > 0 && (
              <>
                <h3>Live execution events</h3>
                <div className="event-feed">
                  {events.map((event) => (
                    <div key={event.id}>
                      <span className="pixel-label">
                        {event.sequence} · {event.type}
                      </span>
                      <pre>{display(event.payload)}</pre>
                    </div>
                  ))}
                </div>
              </>
            )}
            {section === "Browsers" && (
              <BrowserControls
                key={detail.id}
                client={client}
                id={detail.id}
                act={act}
                writable={writable}
              />
            )}
            {section === "Sandboxes" && (
              <FileControls
                key={detail.id}
                client={client}
                id={detail.id}
                act={act}
                writable={writable}
              />
            )}
          </PixelPanel>
        )}
        {section === "Artifacts" && (
          <PixelPanel className="create-panel">
            <h2>Upload a file</h2>
            <form
              onSubmit={(event) => {
                const data = new FormData(event.currentTarget);
                event.preventDefault();
                const file = data.get("file");
                if (!(file instanceof File)) return;
                void act(async () => {
                  if (file.size > 8 * 1048576)
                    throw new Error("Files must be 8 MB or smaller");
                  const encoded = await new Promise<string>(
                    (resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () =>
                        resolve(String(reader.result).split(",")[1]!);
                      reader.onerror = () =>
                        reject(new Error("Unable to read file"));
                      reader.readAsDataURL(file);
                    },
                  );
                  return client.uploadArtifact({
                    filename: file.name,
                    mimeType: file.type || "application/octet-stream",
                    data: encoded,
                  });
                });
              }}
            >
              <label>
                File
                <input name="file" type="file" required />
              </label>
              <button className="pixel-button" type="submit" disabled={busy}>
                Upload to R2
              </button>
            </form>
            <p className="muted small">
              Private storage · maximum 8 MB per file
            </p>
          </PixelPanel>
        )}
        {section === "Artifacts" &&
          detail &&
          String(detail.mimeType).startsWith("image/") && (
            <PixelPanel className="create-panel">
              <h2>Image preview</h2>
              <button
                className="pixel-button"
                type="button"
                onClick={() =>
                  void act(async () => {
                    setPreview((await client.downloadArtifact(detail.id)).url);
                  }, "")
                }
              >
                Load preview
              </button>
              {preview && (
                <img
                  className="artifact-preview"
                  src={preview}
                  alt={String(detail.filename ?? "Collected artifact")}
                />
              )}
            </PixelPanel>
          )}
        <footer className="page-footer pixel-label">
          ZLAYER / AGENT INFRASTRUCTURE <span>MAKE SOMETHING THAT WORKS.</span>
        </footer>
      </main>
    </div>
  );
}
