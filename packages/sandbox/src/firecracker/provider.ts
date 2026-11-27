import { helperError } from "../helper-errors";
import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { server_env as env } from "@repo/env";
import type { ExecuteResult } from "@repo/shared";
import {
  agentChannel,
  AgentRemoteError,
  type AgentRequestHandler,
} from "@repo/shared/agent-channel";
import {
  SandboxError,
  type ExecutionOptions,
  type SandboxProvider,
} from "../contracts";
import { createVmSchema, parseVmResourceId, vmResourceId } from "./validation";
import { managerRequest, managerStream } from "./transport";

export class FirecrackerSandboxProvider implements SandboxProvider {
  constructor(private readonly socketPath = env.FIRECRACKER_SOCKET) {}

  async create(input: Parameters<SandboxProvider["create"]>[0]) {
    const { type: _type, ...options } = input;
    const created = await managerRequest<{ id: string }>(
      this.socketPath,
      "POST",
      "/vms",
      createVmSchema.parse(options),
    );
    return { resourceId: vmResourceId(created.id) };
  }

  async runAgent<T>(
    resourceId: string,
    launch: unknown,
    handler: AgentRequestHandler,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<T> {
    const id = parseVmResourceId(resourceId);
    const signal = AbortSignal.any([
      options.signal,
      AbortSignal.timeout(options.timeoutMs),
    ]);
    signal.throwIfAborted();
    let stream: Socket;
    try {
      stream = await managerStream(this.socketPath, id, "runner", signal);
    } catch (error) {
      if (signal.aborted) {
        await this.terminate(resourceId);
        throw signal.reason;
      }
      throw error;
    }
    const channel = agentChannel(stream, stream, handler);
    let stopped: Promise<unknown> | undefined;
    const stop = () => {
      channel.close(new Error("AGENT_INTERRUPTED"));
      stopped ??= this.terminate(resourceId);
      void stopped.catch(() => {});
    };
    signal.addEventListener("abort", stop, { once: true });
    stream.once("error", () =>
      channel.close(new Error("AGENT_TRANSPORT_FAILED")),
    );
    stream.once("close", () => channel.close());
    try {
      signal.throwIfAborted();
      const result = await channel.request("run", launch);
      signal.throwIfAborted();
      return result as T;
    } catch (error) {
      if (
        !(error instanceof AgentRemoteError) ||
        ["RUN_CANCELLED", "LEASE_LOST", "LEASE_UNAVAILABLE"].includes(
          error.message,
        )
      )
        stop();
      if (stopped) await stopped;
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally {
      signal.removeEventListener("abort", stop);
      channel.close();
      // Half-close input and wait for the supervisor to reap the runner before
      // another run can acquire this VM. A lost cleanup acknowledgement stops it.
      if (!stream.destroyed) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const closed = new Promise<boolean>((resolve) => {
          stream.once("close", () => resolve(true));
          timer = setTimeout(() => resolve(false), 2000);
        });
        stream.end();
        try {
          if (!(await closed)) {
            stop();
            await stopped;
          }
        } finally {
          clearTimeout(timer);
          stream.destroy();
        }
      }
    }
  }

  private async invoke<T>(
    resourceId: string,
    kind: "helper" | "filesystem",
    input: Record<string, unknown>,
    timeoutMs = 30000,
    signal?: AbortSignal,
  ): Promise<T> {
    const stream = await managerStream(
      this.socketPath,
      parseVmResourceId(resourceId),
      kind,
      signal,
    );
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(
        () => stream.destroy(new Error("SANDBOX_HELPER_TIMEOUT")),
        timeoutMs,
      );
      const abort = () => stream.destroy(new Error("SANDBOX_INTERRUPTED"));
      signal?.addEventListener("abort", abort, { once: true });
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 24 * 1048576)
          stream.destroy(new Error("HELPER_OUTPUT_LIMIT"));
        else chunks.push(chunk);
      });
      stream.once("error", reject);
      stream.once("close", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          if (result.error) reject(helperError(String(result.error)));
          else resolve(result.result as T);
        } catch {
          reject(new Error("SANDBOX_HELPER_UNAVAILABLE"));
        }
      });
      stream.write(`${JSON.stringify(input)}\n`);
      if (signal?.aborted) abort();
    });
  }

  async execute(
    id: string,
    command: string,
    options: number | ExecutionOptions = {},
  ): Promise<ExecuteResult> {
    const opts = typeof options === "number" ? { timeoutMs: options } : options;
    opts.signal?.throwIfAborted();
    let terminated: Promise<unknown> | undefined;
    const stop = () => {
      terminated ??= this.terminate(id);
      void terminated.catch(() => {});
    };
    const timeoutMs = Math.min(opts.timeoutMs ?? 30000, 300000);
    const watchdog = setTimeout(stop, timeoutMs + 2000);
    opts.signal?.addEventListener("abort", stop, { once: true });
    try {
      const result = await this.invoke<ExecuteResult>(
        id,
        "helper",
        {
          ...opts,
          signal: undefined,
          id: opts.id ?? randomUUID(),
          op: "execute",
          command,
        },
        timeoutMs + 5000,
        opts.signal,
      );
      if (result.timedOut || result.outputLimited) stop();
      if (terminated) await terminated;
      opts.signal?.throwIfAborted();
      return result;
    } catch (error) {
      stop();
      if (terminated) await terminated;
      throw error;
    } finally {
      clearTimeout(watchdog);
      opts.signal?.removeEventListener("abort", stop);
    }
  }
  file<T>(id: string, operation: Record<string, unknown>) {
    return this.invoke<T>(id, "filesystem", operation);
  }
  async service<T>(id: string, action: Record<string, unknown>) {
    if (action.op === "browser.create") {
      const state = await managerRequest<{ approvedHosts: string[] }>(
        this.socketPath,
        "GET",
        `/vms/${parseVmResourceId(id)}`,
      );
      action = {
        ...action,
        hosts: state.approvedHosts,
        proxy: state.approvedHosts.length ? "http://127.0.0.1:8080" : undefined,
      };
    }
    return this.invoke<T>(id, "helper", { op: "service.request", action });
  }
  cancel(id: string, executionId: string) {
    return this.invoke<void>(id, "helper", { op: "cancel", id: executionId });
  }
  private terminate(id: string) {
    return managerRequest<void>(
      this.socketPath,
      "POST",
      `/vms/${parseVmResourceId(id)}/lifecycle`,
      { action: "stop", force: true },
    );
  }
  lifecycle(id: string, action: Parameters<SandboxProvider["lifecycle"]>[1]) {
    return managerRequest<void>(
      this.socketPath,
      "POST",
      `/vms/${parseVmResourceId(id)}/lifecycle`,
      { action },
    );
  }
  inspect(id: string) {
    return managerRequest(
      this.socketPath,
      "GET",
      `/vms/${parseVmResourceId(id)}`,
    );
  }
  stats(id: string) {
    return managerRequest(
      this.socketPath,
      "GET",
      `/vms/${parseVmResourceId(id)}/stats`,
    );
  }
  destroy(id: string) {
    return managerRequest<void>(
      this.socketPath,
      "DELETE",
      `/vms/${parseVmResourceId(id)}`,
    );
  }
  async reconcileResources(ids: string[]) {
    // Optional provider: a missing manager must not disrupt Kata maintenance.
    try {
      await managerRequest(this.socketPath, "POST", "/reconcile", {
        ids: ids.map(parseVmResourceId),
      });
    } catch (error) {
      if (
        !(
          error instanceof SandboxError &&
          error.code === "FIRECRACKER_HOST_UNAVAILABLE" &&
          ids.length === 0
        )
      )
        throw error;
    }
  }
}
