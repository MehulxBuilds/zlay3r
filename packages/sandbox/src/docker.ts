import { helperError } from "./helper-errors";
import Docker from "dockerode";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { server_env as env } from "@repo/env";
import type { ExecuteResult } from "@repo/shared";
import { span } from "@repo/observability/trace";
import {
  agentChannel,
  AgentRemoteError,
  type AgentRequestHandler,
} from "@repo/shared/agent-channel";

import {
  SandboxError,
  type SandboxProvider,
  type ExecutionOptions,
} from "./contracts";

export class DockerSandboxProvider implements SandboxProvider {
  private readonly docker: Docker;
  private readonly agents = new Set<string>();
  constructor(socketPath = env.DOCKER_SOCKET) {
    this.docker = new Docker({ socketPath });
  }
  async runAgent<T>(
    id: string,
    launch: unknown,
    handler: AgentRequestHandler,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<T> {
    options.signal.throwIfAborted();
    if (this.agents.has(id)) throw new Error("SANDBOX_AGENT_BUSY");
    this.agents.add(id);
    const signal = AbortSignal.any([
      options.signal,
      AbortSignal.timeout(options.timeoutMs),
    ]);
    const container = this.docker.getContainer(id);
    let stream: import("node:stream").Duplex | undefined;
    let channel: ReturnType<typeof agentChannel> | undefined;
    let stop: Promise<unknown> | undefined;
    let runnerStarted = false;
    let inspectRunner: (() => Promise<{ Running: boolean }>) | undefined;
    const abort = () => {
      channel?.close(new Error("AGENT_INTERRUPTED"));
      if (!runnerStarted) return;
      // Stop the whole isolation boundary, including detached descendants.
      stop ??= container.stop({ t: 0 }).catch(() => {
        throw new Error("AGENT_TERMINATION_FAILED");
      });
      void stop.catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const info = await container.inspect();
      if (info.HostConfig.Runtime !== env.SANDBOX_RUNTIME) {
        throw new SandboxError(
          "SANDBOX_RUNTIME_MISMATCH",
          "This sandbox uses a different runtime. Create a new sandbox with the configured SANDBOX_RUNTIME.",
        );
      }
      const image = await this.docker.getImage(info.Image).inspect();
      if (image.Config?.Labels?.["zlayer.agent-runner"] !== "1")
        throw new Error("SANDBOX_RUNNER_IMAGE_REQUIRED");
      const exec = await container.exec({
        Cmd: ["node", "/opt/zlayer/agent-runner.mjs"],
        WorkingDir: "/workspace",
        User: "1000:1000",
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
      });
      inspectRunner = () => exec.inspect();
      signal.throwIfAborted();
      runnerStarted = true;
      stream = (await exec.start({
        hijack: true,
        stdin: true,
      })) as unknown as import("node:stream").Duplex;
      const output = new PassThrough(),
        errors = new PassThrough();
      // Stderr is drained, never mixed into the private protocol or logged.
      errors.resume();
      this.docker.modem.demuxStream(stream, output, errors);
      channel = agentChannel(output, stream, handler);
      stream.once("error", () =>
        channel?.close(new Error("AGENT_TRANSPORT_FAILED")),
      );
      stream.once("end", () => channel?.close());
      stream.once("close", () => channel?.close());
      signal.throwIfAborted();
      const result = await channel.request("run", launch);
      signal.throwIfAborted();
      return result as T;
    } catch (error) {
      // A broken channel may leave an agent executing; terminate it before retry.
      if (
        !(error instanceof AgentRemoteError) ||
        ["RUN_CANCELLED", "LEASE_LOST", "LEASE_UNAVAILABLE"].includes(
          error.message,
        )
      )
        abort();
      if (stop) await stop;
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      channel?.close();
      stream?.end();
      try {
        if (runnerStarted && inspectRunner && !stop) {
          let running = true;
          for (let attempt = 0; attempt < 20; attempt++) {
            running = (await inspectRunner()).Running;
            if (!running) break;
            await delay(50);
          }
          if (running) {
            abort();
            if (stop) await stop;
          }
        }
      } finally {
        stream?.destroy();
        this.agents.delete(id);
      }
    }
  }
  async preflight() {
    let version: { Version: string };
    try {
      version = await this.docker.version();
    } catch {
      throw new SandboxError(
        "DOCKER_UNAVAILABLE",
        "Cannot connect to Docker. Start Docker Desktop and check DOCKER_SOCKET in the server environment.",
      );
    }
    const major = Number.parseInt(version.Version, 10);
    if (!Number.isInteger(major) || major < 28) {
      throw new SandboxError(
        "DOCKER_VERSION_UNSUPPORTED",
        "Sandbox isolation requires Docker Engine 28 or newer.",
      );
    }
    const info = await this.docker.info();
    if (info.OSType !== "linux") {
      throw new SandboxError(
        "SANDBOX_LINUX_REQUIRED",
        "Sandbox isolation requires a Linux Docker Engine.",
      );
    }
    if (!Object.hasOwn(info.Runtimes ?? {}, env.SANDBOX_RUNTIME)) {
      throw new SandboxError(
        "SANDBOX_RUNTIME_UNAVAILABLE",
        `Docker has no registered ${env.SANDBOX_RUNTIME} runtime. Install and register Kata on the Docker host. See docs/kata-runtime.md. No fallback runtime will be used.`,
      );
    }
    try {
      await this.docker.getImage(env.SANDBOX_IMAGE).inspect();
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        error.statusCode === 404
      ) {
        throw new SandboxError(
          "SANDBOX_IMAGE_NOT_FOUND",
          "Build the sandbox image with bun run sandbox:build before creating a sandbox. See ENVIRONMENT.md.",
        );
      }
      throw new SandboxError(
        "DOCKER_UNAVAILABLE",
        "Docker could not inspect the configured sandbox image. Check Docker Desktop and its image access permissions.",
      );
    }
  }
  async create(input: {
    memoryMb: number;
    cpu: number;
    name: string;
    approvedHosts?: string[];
  }) {
    await this.preflight();
    const networkName = `zlayer-net-${randomUUID()}`;
    const network = await this.docker.createNetwork({
      Name: networkName,
      Internal: true,
      EnableIPv6: false,
      Options: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" },
      Labels: { "zlayer.managed": "true", "zlayer.instance": env.INSTANCE_ID },
    });
    let proxyId: string | undefined;
    if (input.approvedHosts?.length) {
      try {
        const proxy = await this.docker.createContainer({
          Image: env.SANDBOX_IMAGE,
          User: "1000:1000",
          Entrypoint: ["node", "/opt/zlayer/helper.mjs"],
          Cmd: [
            Buffer.from(
              JSON.stringify({ op: "proxy", hosts: input.approvedHosts }),
            ).toString("base64url"),
          ],
          Labels: {
            "zlayer.managed": "true",
            "zlayer.instance": env.INSTANCE_ID,
            "zlayer.role": "proxy",
            "zlayer.sandbox": input.name,
          },
          HostConfig: {
            NetworkMode: "bridge",
            ReadonlyRootfs: true,
            CapDrop: ["ALL"],
            SecurityOpt: ["no-new-privileges:true"],
            Memory: 128 * 1048576,
            PidsLimit: 32,
            Tmpfs: { "/tmp": "rw,nosuid,nodev,size=16m,mode=1777" },
          },
        });
        proxyId = proxy.id;
        await network.connect({
          Container: proxy.id,
          EndpointConfig: { Aliases: ["egress"] },
        });
        await proxy.start();
      } catch (error) {
        if (proxyId)
          await this.docker.getContainer(proxyId).remove({ force: true });
        await network.remove();
        throw error;
      }
    }
    let container: Docker.Container;
    try {
      container = await this.docker.createContainer({
        Image: env.SANDBOX_IMAGE,
        User: "1000:1000",
        WorkingDir: "/workspace",
        name: `zlayer-${input.name}-${randomUUID().slice(0, 8)}`,
        Labels: {
          "zlayer.managed": "true",
          "zlayer.instance": env.INSTANCE_ID,
          "zlayer.role": "sandbox",
          "zlayer.sandbox": input.name,
          "zlayer.network": networkName,
          "zlayer.proxy": proxyId ?? "",
          "zlayer.hosts": JSON.stringify(input.approvedHosts ?? []),
        },
        Env: proxyId
          ? [
              "HTTP_PROXY=http://egress:8080",
              "HTTPS_PROXY=http://egress:8080",
              "http_proxy=http://egress:8080",
              "https_proxy=http://egress:8080",
            ]
          : [],
        HostConfig: {
          Runtime: env.SANDBOX_RUNTIME,
          Memory: input.memoryMb * 1048576,
          NanoCpus: Math.floor(input.cpu * 1e9),
          PidsLimit: 128,
          NetworkMode: proxyId ? networkName : "none",
          Dns: ["127.0.0.1"],
          ReadonlyRootfs: true,
          CapDrop: ["ALL"],
          SecurityOpt: [
            "no-new-privileges:true",
            ...(env.SANDBOX_SECCOMP ? [`seccomp=${env.SANDBOX_SECCOMP}`] : []),
          ],
          Tmpfs: {
            "/tmp": "rw,nosuid,nodev,size=128m,mode=1777",
            "/workspace":
              "rw,nosuid,nodev,size=256m,uid=1000,gid=1000,mode=0700",
          },
          ShmSize: 128 * 1048576,
        },
      });
    } catch (error) {
      if (proxyId)
        await this.docker.getContainer(proxyId).remove({ force: true });
      await network.remove();
      throw error;
    }
    try {
      await container.start();
      return { resourceId: container.id };
    } catch (error) {
      await container.remove({ force: true });
      if (proxyId)
        await this.docker.getContainer(proxyId).remove({ force: true });
      await network.remove();
      throw error;
    }
  }
  private async invoke<T>(
    resourceId: string,
    input: Record<string, unknown>,
    user = "1000:1000",
    command = ["node", "/opt/zlayer/helper.mjs", "--stdin"],
  ): Promise<T> {
    return span(
      `sandbox.${String(input.op)}`,
      { "sandbox.resource": resourceId },
      () => this.invokeRaw<T>(resourceId, input, user, command),
    );
  }
  private async invokeRaw<T>(
    resourceId: string,
    input: Record<string, unknown>,
    user: string,
    command: string[],
  ): Promise<T> {
    const exec = await this.docker.getContainer(resourceId).exec({
      Cmd: command,
      User: user,
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
    });
    const stream = await exec.start({ hijack: true, stdin: true });
    stream.write(`${JSON.stringify(input)}\n`);
    return new Promise((resolve, reject) => {
      const out = new PassThrough(),
        err = new PassThrough();
      const chunks: Buffer[] = [];
      let size = 0;
      out.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 24 * 1048576) {
          stream.destroy();
          reject(new Error("HELPER_OUTPUT_LIMIT"));
        } else chunks.push(chunk);
      });
      err.resume();
      this.docker.modem.demuxStream(stream, out, err);
      stream.once("error", reject);
      stream.once("close", () => reject(new Error("SANDBOX_TRANSPORT_CLOSED")));
      stream.once("end", () => {
        try {
          const response = JSON.parse(Buffer.concat(chunks).toString()) as {
            result: T;
            error?: string;
          };
          if (response.error) {
            reject(helperError(response.error));
          } else resolve(response.result);
        } catch {
          reject(new Error("SANDBOX_HELPER_UNAVAILABLE"));
        }
      });
    });
  }
  async execute(
    resourceId: string,
    command: string,
    options: number | ExecutionOptions = {},
  ): Promise<ExecuteResult> {
    const opts = typeof options === "number" ? { timeoutMs: options } : options;
    opts.signal?.throwIfAborted();
    const id = opts.id ?? randomUUID();
    let cancelFailure: Error | undefined;
    const cancel = () => {
      void this.docker
        .getContainer(resourceId)
        .stop({ t: 0 })
        .catch(() => {
          cancelFailure = new Error("CANCELLATION_FAILED");
        });
    };
    const watchdog = setTimeout(
      cancel,
      Math.min(opts.timeoutMs ?? 30000, 300000) + 2000,
    );
    opts.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await this.invoke<ExecuteResult>(resourceId, {
        ...opts,
        signal: undefined,
        id,
        op: "execute",
        command,
      });
      if (cancelFailure) throw cancelFailure;
      if (result.timedOut || result.outputLimited)
        await this.docker.getContainer(resourceId).stop({ t: 0 });
      opts.signal?.throwIfAborted();
      return result;
    } finally {
      clearTimeout(watchdog);
      opts.signal?.removeEventListener("abort", cancel);
    }
  }
  async cancel(id: string, executionId: string) {
    await this.invoke(id, { op: "cancel", id: executionId });
  }
  file<T>(id: string, operation: Record<string, unknown>) {
    return this.invoke<T>(id, operation, "1000:1000", [
      "python3",
      "/opt/zlayer/filesystem.py",
    ]);
  }
  async service<T>(id: string, action: Record<string, unknown>) {
    if (action.op === "browser.create") {
      const info = await this.docker.getContainer(id).inspect();
      action = {
        ...action,
        hosts: JSON.parse(info.Config.Labels?.["zlayer.hosts"] ?? "[]"),
        proxy: info.Config.Labels?.["zlayer.proxy"]
          ? "http://egress:8080"
          : undefined,
      };
    }
    return this.invoke<T>(id, { op: "service.request", action });
  }
  async lifecycle(
    id: string,
    action: "start" | "stop" | "pause" | "resume" | "restart",
  ) {
    const container = this.docker.getContainer(id);
    if (action === "resume") await container.unpause();
    if (action === "pause") await container.pause();
    if (action === "start") await container.start();
    if (action === "stop") {
      const state = await container.inspect();
      if (state.State.Paused) await container.unpause();
      if (state.State.Running) await container.stop({ t: 5 });
    }
    if (action === "restart") await container.restart({ t: 5 });
  }
  async inspect(id: string) {
    const info = await this.docker.getContainer(id).inspect();
    return {
      running: info.State.Running,
      paused: info.State.Paused,
      exitCode: info.State.ExitCode,
      startedAt: info.State.StartedAt,
    };
  }
  async stats(id: string) {
    const info = await this.docker.getContainer(id).stats({ stream: false });
    return {
      memory: info.memory_stats,
      cpu: info.cpu_stats,
      pids: info.pids_stats,
    };
  }
  async destroy(id: string) {
    try {
      const info = await this.docker.getContainer(id).inspect();
      await this.docker.getContainer(id).remove({ force: true, v: true });
      const proxy = info.Config.Labels?.["zlayer.proxy"],
        network = info.Config.Labels?.["zlayer.network"];
      if (proxy)
        await this.docker.getContainer(proxy).remove({ force: true, v: true });
      if (network) await this.docker.getNetwork(network).remove();
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          error.statusCode === 404
        )
      )
        throw error;
    }
  }
  async reconcileResources(knownIds: string[]) {
    const filters = JSON.stringify({
      label: ["zlayer.managed=true", `zlayer.instance=${env.INSTANCE_ID}`],
    });
    const containers = await this.docker.listContainers({ all: true, filters });
    const known = new Set(knownIds),
      cutoff = Date.now() / 1000 - 120;
    const mains = containers.filter(
      (entry) => entry.Labels["zlayer.role"] === "sandbox",
    );
    for (const entry of mains)
      if (!known.has(entry.Id) && entry.Created < cutoff)
        await this.destroy(entry.Id);
    const activeSandboxIds = new Set(
      mains
        .filter((entry) => known.has(entry.Id) || entry.Created >= cutoff)
        .map((entry) => entry.Labels["zlayer.sandbox"]),
    );
    for (const entry of containers)
      if (
        entry.Labels["zlayer.role"] === "proxy" &&
        !activeSandboxIds.has(entry.Labels["zlayer.sandbox"]) &&
        entry.Created < cutoff
      )
        await this.docker
          .getContainer(entry.Id)
          .remove({ force: true })
          .catch((error: unknown) => {
            if (
              !error ||
              typeof error !== "object" ||
              !("statusCode" in error) ||
              error.statusCode !== 404
            )
              throw error;
          });
    for (const network of await this.docker.listNetworks({ filters })) {
      const info = await this.docker.getNetwork(network.Id).inspect();
      if (
        !Object.keys(info.Containers ?? {}).length &&
        Date.parse(String(info.Created)) < Date.now() - 120000
      )
        await this.docker.getNetwork(network.Id).remove();
    }
  }
}
