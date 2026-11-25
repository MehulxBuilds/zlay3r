import Docker from "dockerode";
import { randomUUID } from "node:crypto";
import type { ExecuteResult } from "@repo/shared";
import { server_env as env } from "@repo/env";
import { PassThrough } from "node:stream";

export class DockerSandboxProvider {
  private docker: Docker;

  constructor(socketPath = env.DOCKER_SOCKET) {
    this.docker = new Docker({ socketPath });
  }

  async create(input: { memoryMb: number; cpu: number; name: string }) {
    const container = await this.docker.createContainer({
      Image: "node:22-bookworm-slim",
      Cmd: ["sh", "-lc", "mkdir -p /workspace && tail -f /dev/null"],
      WorkingDir: "/workspace",
      name: `agent-sandbox-${input.name}-${randomUUID().slice(0, 8)}`,
      Tty: false,
      OpenStdin: false,
      HostConfig: {
        Memory: input.memoryMb * 1024 * 1024,
        NanoCpus: Math.floor(input.cpu * 1e9),
        PidsLimit: 128,
        NetworkMode: "none",
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        Tmpfs: {
          "/tmp": "rw,noexec,nosuid,size=128m",
          "/workspace": "rw,nosuid,size=256m",
        },
      },
    });
    await container.start();
    return { resourceId: container.id };
  }

  async execute(
    resourceId: string,
    command: string,
    timeoutMs = 30_000,
  ): Promise<ExecuteResult> {
    const container = this.docker.getContainer(resourceId);
    const started = Date.now();
    const exec = await container.exec({
      Cmd: ["sh", "-lc", command],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: "/workspace",
    });
    const stream = await exec.start({ hijack: true, stdin: false });

    return await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(async () => {
        timedOut = true;
        try {
          stream.destroy();
        } catch {}
        resolve({
          exitCode: null,
          stdout,
          stderr: stderr + "\nExecution timed out",
          durationMs: Date.now() - started,
          timedOut: true,
        });
      }, timeoutMs);

      const out = new PassThrough();
      const err = new PassThrough();
      out.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      err.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      this.docker.modem.demuxStream(stream, out, err);

      stream.on("end", async () => {
        if (timedOut) return;
        clearTimeout(timer);
        try {
          const inspection = await exec.inspect();
          resolve({
            exitCode: inspection.ExitCode ?? null,
            stdout,
            stderr,
            durationMs: Date.now() - started,
            timedOut: false,
          });
        } catch (error) {
          reject(error);
        }
      });
      stream.on("error", (error: Error) => {
        clearTimeout(timer);
        if (!timedOut) reject(error);
      });
    });
  }

  async destroy(resourceId: string) {
    const container = this.docker.getContainer(resourceId);
    try {
      await container.stop({ t: 5 });
    } catch {}
    await container.remove({ force: true });
  }
}
