"use client";

import { useEffect, useState } from "react";
import type { AgentPlatformClient, Resource } from "@repo/sdk";
import { PixelPanel } from "@repo/web/components/pixel-panel";
import { fields, display } from "@repo/web/components/dashboard-utils";

export function Settings({
  client,
  policy,
  act,
}: {
  client: AgentPlatformClient;
  policy: Record<string, unknown>;
  act(action: () => Promise<unknown>, message?: string): Promise<unknown>;
}) {
  const [members, setMembers] = useState<Resource[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void client
      .request<Resource[]>("/v1/memberships")
      .then(setMembers)
      .catch((error: unknown) =>
        setError(
          error instanceof Error ? error.message : "Unable to load members",
        ),
      );
  }, [client]);
  return (
    <div className="settings-grid">
      <PixelPanel className="create-panel">
        <h2>Workspace members</h2>
        {error && <p role="alert">{error}</p>}
        {members.map((member) => (
          <div className="member-row" key={member.id}>
            <span>
              {display(member.name)}
              <small className="muted"> {display(member.email)}</small>
            </span>
            <label>
              <span className="sr-only">Role for {display(member.name)}</span>
              <select
                value={String(member.role)}
                disabled={member.role === "owner"}
                onChange={(event) =>
                  void act(async () => {
                    await client.request(`/v1/memberships/${member.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ role: event.target.value }),
                    });
                    setMembers(
                      await client.request<Resource[]>("/v1/memberships"),
                    );
                  })
                }
              >
                <option>owner</option>
                <option>admin</option>
                <option>developer</option>
                <option>viewer</option>
              </select>
            </label>
            {member.role !== "owner" && (
              <button
                className="text-button danger"
                type="button"
                onClick={() =>
                  void act(async () => {
                    await client.request(`/v1/memberships/${member.id}`, {
                      method: "DELETE",
                    });
                    setMembers(
                      await client.request<Resource[]>("/v1/memberships"),
                    );
                  })
                }
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </PixelPanel>
      <PixelPanel className="create-panel">
        <h2>Organization</h2>
        <form
          onSubmit={(event) => {
            const data = fields(event);
            void act(() =>
              client.request("/v1/organizations/current", {
                method: "PATCH",
                body: JSON.stringify({ name: data.name }),
              }),
            );
          }}
        >
          <label>
            Name
            <input name="name" required maxLength={100} />
          </label>
          <button className="pixel-button" type="submit">
            Rename workspace
          </button>
        </form>
        <form
          onSubmit={(event) => {
            const data = fields(event);
            void act(
              () =>
                client.request("/v1/organizations", {
                  method: "POST",
                  body: JSON.stringify({ name: data.name }),
                }),
              "Organization created. Reload to select it.",
            );
          }}
        >
          <label>
            New organization
            <input name="name" required />
          </label>
          <button className="pixel-button" type="submit">
            Create organization
          </button>
        </form>
      </PixelPanel>
      <PixelPanel className="create-panel">
        <h2>Invite a teammate</h2>
        <form
          onSubmit={(event) => {
            const data = fields(event);
            void act(
              () =>
                client.request<{ token: string }>("/v1/invitations", {
                  method: "POST",
                  body: JSON.stringify(data),
                }),
              "",
            ).then((result) => {
              if (result)
                window.prompt(
                  "Share this invitation token privately",
                  (result as { token: string }).token,
                );
            });
          }}
        >
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Role
            <select name="role">
              <option>developer</option>
              <option>viewer</option>
              <option>admin</option>
            </select>
          </label>
          <button className="pixel-button" type="submit">
            Create invitation
          </button>
        </form>
      </PixelPanel>
      <PixelPanel className="create-panel">
        <h2>Execution policy</h2>
        <p className="muted small">
          Host changes apply to new sandboxes. Approval lists restrict agent and
          direct shell actions.
        </p>
        <form
          key={display(policy)}
          onSubmit={(event) => {
            const data = fields(event);
            const list = (key: string) =>
              String(data[key] ?? "")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean);
            void act(() =>
              client.request("/v1/policies", {
                method: "PUT",
                body: JSON.stringify({
                  allowedTools: list("allowedTools"),
                  allowedCommands: String(data.allowedCommands ?? "")
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                  requireApproval: list("requireApproval"),
                  approvedHosts: list("approvedHosts"),
                  maxTokens: Number(data.maxTokens),
                  maxToolCalls: Number(data.maxToolCalls),
                  deadlineMs: Number(data.deadlineMs),
                }),
              }),
            );
          }}
        >
          <label>
            Allowed tools
            <input
              name="allowedTools"
              defaultValue={((policy.allowedTools as string[]) ?? []).join(",")}
            />
          </label>
          <label>
            Tools requiring approval
            <input
              name="requireApproval"
              defaultValue={((policy.requireApproval as string[]) ?? []).join(
                ",",
              )}
            />
          </label>
          <label>
            Allowed exact shell commands (one per line; empty allows any
            command)
            <textarea
              name="allowedCommands"
              defaultValue={((policy.allowedCommands as string[]) ?? []).join(
                "\n",
              )}
            />
          </label>
          <label>
            Allowed public hosts
            <input
              name="approvedHosts"
              defaultValue={((policy.approvedHosts as string[]) ?? []).join(
                ",",
              )}
              placeholder="example.com,api.example.com"
            />
          </label>
          <label>
            Token budget
            <input
              name="maxTokens"
              type="number"
              defaultValue={Number(policy.maxTokens ?? 32000)}
              required
            />
          </label>
          <label>
            Tool-call limit
            <input
              name="maxToolCalls"
              type="number"
              defaultValue={Number(policy.maxToolCalls ?? 32)}
              required
            />
          </label>
          <label>
            Deadline (milliseconds)
            <input
              name="deadlineMs"
              type="number"
              defaultValue={Number(policy.deadlineMs ?? 300000)}
              required
            />
          </label>
          <button className="pixel-button" type="submit">
            Save policy
          </button>
        </form>
      </PixelPanel>
      <PixelPanel className="create-panel">
        <h2>Secrets</h2>
        <p className="muted small">
          Stored encrypted. Values are never returned.
        </p>
        <form
          onSubmit={(event) => {
            const data = fields(event);
            void act(() =>
              client.request(
                `/v1/secrets/${encodeURIComponent(String(data.name))}`,
                { method: "PUT", body: JSON.stringify({ value: data.value }) },
              ),
            );
            event.currentTarget.reset();
          }}
        >
          <label>
            Name
            <input
              name="name"
              pattern="[A-Z][A-Z0-9_]*"
              required
              placeholder="SERVICE_TOKEN"
            />
          </label>
          <label>
            Value
            <input name="value" type="password" autoComplete="off" required />
          </label>
          <button className="pixel-button" type="submit">
            Save secret
          </button>
        </form>
      </PixelPanel>
      <PixelPanel className="create-panel">
        <h2>Monthly quotas</h2>
        <form
          onSubmit={(event) => {
            const data = fields(event);
            void act(() =>
              client.request("/v1/quotas", {
                method: "PUT",
                body: JSON.stringify({
                  metric: data.metric,
                  limit: Number(data.limit),
                }),
              }),
            );
          }}
        >
          <label>
            Metric
            <select name="metric">
              <option>tokens</option>
              <option>runs</option>
              <option>tool_calls</option>
              <option>artifact_bytes</option>
            </select>
          </label>
          <label>
            Limit
            <input name="limit" type="number" min={0} required />
          </label>
          <button className="pixel-button" type="submit">
            Save quota
          </button>
        </form>
      </PixelPanel>
      <PixelPanel className="create-panel">
        <h2>Accept invitation</h2>
        <form
          onSubmit={(event) => {
            const data = fields(event);
            void act(
              () =>
                client.request("/v1/invitations/accept", {
                  method: "POST",
                  body: JSON.stringify({ token: data.token }),
                }),
              "Joined the organization. Reload to select it.",
            );
          }}
        >
          <label>
            Invitation token
            <input name="token" required autoComplete="off" />
          </label>
          <button className="pixel-button" type="submit">
            Join workspace
          </button>
        </form>
      </PixelPanel>
      <PixelPanel className="create-panel">
        <h2>Transfer ownership</h2>
        <p className="muted small">
          Only the current owner can transfer ownership to an existing member.
        </p>
        <form
          onSubmit={(event) => {
            const data = fields(event);
            if (window.confirm("Transfer workspace ownership to this member?"))
              void act(
                () =>
                  client.request("/v1/organizations/current/transfer-owner", {
                    method: "POST",
                    body: JSON.stringify({ userId: data.userId }),
                  }),
                "Ownership transferred. Reload to update your role.",
              );
          }}
        >
          <label>
            New owner
            <select name="userId" required>
              <option value="">Choose a member</option>
              {members
                .filter((member) => member.role !== "owner")
                .map((member) => (
                  <option key={member.id} value={String(member.userId)}>
                    {display(member.name)}
                  </option>
                ))}
            </select>
          </label>
          <button className="pixel-button" type="submit">
            Transfer ownership
          </button>
        </form>
      </PixelPanel>
    </div>
  );
}
