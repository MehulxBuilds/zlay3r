import { assertTrustedPath } from "./host-files";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  access,
  open,
  type FileHandle,
  chown,
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import net, { type Server, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { ServerEnv } from "@repo/env";
import { SandboxError } from "../contracts";
import { managerRequest } from "./transport";
import { connectGuest } from "./guest";
import { createVmSchema, type CreateVm, vmIdSchema } from "./validation";

const command = promisify(execFile);
const recordSchema = z.object({
  id: vmIdSchema,
  input: createVmSchema,
  uid: z.number().int().min(10000),
  createdAt: z.number(),
  startedAt: z.string().nullable(),
});
type VmRecord = z.infer<typeof recordSchema>;
type Runtime = {
  proxy?: ChildProcess;
  egress?: Server;
  sockets: Set<Socket>;
  runner: boolean;
  directory: FileHandle;
  launcher?: ChildProcess;
  bootLog: string;
};
type HostConfig = Pick<
  ServerEnv,
  | "FIRECRACKER_BINARY"
  | "FIRECRACKER_JAILER"
  | "FIRECRACKER_KERNEL"
  | "FIRECRACKER_ROOTFS"
  | "FIRECRACKER_HELPER"
  | "FIRECRACKER_STATE_DIR"
  | "FIRECRACKER_UID_BASE"
  | "FIRECRACKER_MAX_VMS"
  | "INSTANCE_ID"
>;

export class FirecrackerHostManager {
  private readonly records = new Map<string, VmRecord>();
  private readonly runtime = new Map<string, Runtime>();
  private readonly busy = new Set<string>();
  private executable = "";
  private binary = "";
  readonly stateDir: string;
  constructor(private readonly config: HostConfig) {
    this.stateDir = path.resolve(
      config.FIRECRACKER_STATE_DIR,
      config.INSTANCE_ID,
    );
  }

  private directory(id: string) {
    return path.join(this.stateDir, "records", vmIdSchema.parse(id));
  }
  private jail(id: string) {
    return path.join(
      this.stateDir,
      "jails",
      this.executable,
      vmIdSchema.parse(id),
      "root",
    );
  }
  private cgroup(id: string) {
    return path.join(
      "/sys/fs/cgroup/zlayer-firecracker",
      this.config.INSTANCE_ID,
      vmIdSchema.parse(id),
    );
  }
  private record(id: string) {
    const record = this.records.get(vmIdSchema.parse(id));
    if (!record)
      throw new SandboxError(
        "FIRECRACKER_VM_NOT_FOUND",
        "Sandbox VM not found.",
        404,
      );
    return record;
  }
  private async save(record: VmRecord) {
    const file = path.join(this.directory(record.id), "record.json");
    await writeFile(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
  async exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (this.busy.has(id))
      throw new SandboxError(
        "FIRECRACKER_VM_BUSY",
        "A sandbox lifecycle operation is already running.",
        409,
      );
    this.busy.add(id);
    try {
      return await operation();
    } finally {
      this.busy.delete(id);
    }
  }

  async initialize() {
    if (process.platform !== "linux" || process.getuid?.() !== 0)
      throw new Error(
        "Firecracker host service requires Linux and root privileges.",
      );
    this.binary = await realpath(this.config.FIRECRACKER_BINARY);
    this.executable = path.basename(this.binary);
    for (const target of [
      this.binary,
      this.config.FIRECRACKER_JAILER,
      this.config.FIRECRACKER_KERNEL,
      this.config.FIRECRACKER_ROOTFS,
      this.config.FIRECRACKER_HELPER,
    ]) {
      await assertTrustedPath(target);
    }
    const users = (await readFile("/etc/passwd", "utf8")).split("\n");
    for (const line of users) {
      const uid = Number(line.split(":")[2]);
      if (
        uid >= this.config.FIRECRACKER_UID_BASE &&
        uid < this.config.FIRECRACKER_UID_BASE + this.config.FIRECRACKER_MAX_VMS
      )
        throw new Error(
          "Firecracker UID range overlaps an existing host user.",
        );
    }
    await access("/dev/kvm");
    await access("/sys/fs/cgroup/cgroup.controllers");
    await mkdir(path.join(this.stateDir, "records"), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(path.join(this.stateDir, "jails"), {
      recursive: true,
      mode: 0o700,
    });
    await assertTrustedPath(this.stateDir);
    const stateInfo = await stat(this.stateDir);
    if (stateInfo.uid !== 0 || stateInfo.mode & 0o077)
      throw new Error(
        "Firecracker state directory must be root-owned with mode 0700.",
      );
    for (const id of await readdir(path.join(this.stateDir, "records"))) {
      vmIdSchema.parse(id);
      const record = recordSchema.parse(
        JSON.parse(
          await readFile(path.join(this.directory(id), "record.json"), "utf8"),
        ),
      );
      if (record.id !== id) throw new Error("FIRECRACKER_RECORD_MISMATCH");
      this.records.set(id, record);
      // Recovery is fail-closed: terminate surviving VMs before accepting clients.
      await this.stop(id);
    }
  }

  async create(input: CreateVm) {
    input = createVmSchema.parse(input);
    if (this.records.size >= this.config.FIRECRACKER_MAX_VMS)
      throw new SandboxError(
        "FIRECRACKER_CAPACITY",
        "This host has reached its sandbox limit.",
        409,
      );
    const used = new Set([...this.records.values()].map((entry) => entry.uid));
    let uid = this.config.FIRECRACKER_UID_BASE;
    while (used.has(uid)) uid++;
    const record: VmRecord = {
      id: randomUUID(),
      uid,
      input,
      createdAt: Date.now(),
      startedAt: null,
    };
    this.records.set(record.id, record);
    try {
      await mkdir(this.directory(record.id), { mode: 0o700 });
      await this.save(record);
      await this.start(record.id);
      return { id: record.id };
    } catch (error) {
      await this.destroy(record.id);
      throw error;
    }
  }

  private socketPath(id: string, name: string) {
    const runtime = this.runtime.get(id);
    if (!runtime)
      throw new SandboxError("FIRECRACKER_HOST_UNAVAILABLE", "VM is stopped.");
    // Linux Unix sockets have a 108-byte pathname limit. A held directory FD
    // keeps socket paths short even with versioned binaries and long state paths.
    return `/proc/self/fd/${runtime.directory.fd}/${name}`;
  }

  private async api<T>(
    id: string,
    method: string,
    route: string,
    body?: unknown,
  ) {
    return managerRequest<T>(
      this.socketPath(id, "api.sock"),
      method,
      route,
      body,
      5000,
    );
  }

  private async start(id: string) {
    const record = this.record(id);
    if ((await this.inspect(id)).running)
      throw new SandboxError(
        "FIRECRACKER_ALREADY_RUNNING",
        "Sandbox is already running.",
        409,
      );
    await this.stop(id);
    const jail = this.jail(id);
    // Jailer creates device nodes and PID files with exclusive creation. Keep
    // immutable boot artifacts outside the jail and rebuild its scaffolding.
    await rm(path.dirname(jail), { recursive: true, force: true });
    await mkdir(jail, { recursive: true, mode: 0o700 });
    await chmod(jail, 0o700);
    // Rootfs and kernel are immutable shared inodes. Workspace is private per VM.
    for (const [source, name] of [
      [this.config.FIRECRACKER_KERNEL, "vmlinux"],
      [this.config.FIRECRACKER_ROOTFS, "rootfs.ext4"],
    ] as const) {
      const destination = path.join(this.directory(id), name);
      try {
        const existing = await lstat(destination);
        if (!existing.isFile() || existing.uid !== 0 || existing.mode & 0o022)
          throw new Error("INVALID_VM_BOOT_ARTIFACT");
        await link(destination, path.join(jail, name));
        continue;
      } catch (error) {
        if (
          !(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
      }
      await link(source, destination).catch(
        async (error: NodeJS.ErrnoException) => {
          if (error.code !== "EXDEV") throw error;
          await copyFile(source, destination);
        },
      );
      await link(destination, path.join(jail, name));
    }
    const scratch = path.join(this.directory(id), "workspace.ext4");
    try {
      await access(scratch);
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
      )
        throw error;
      await writeFile(scratch, "", { mode: 0o600, flag: "wx" });
      await truncate(scratch, 256 * 1048576);
      await command("mkfs.ext4", ["-q", "-F", "-m", "0", scratch], {
        timeout: 30000,
      });
      // Only this newly formatted, trusted filesystem is edited on the host.
      await command("debugfs", ["-w", "-R", "rmdir /lost+found", scratch], {
        timeout: 5000,
      });
    }
    await chown(scratch, record.uid, record.uid);
    await unlink(path.join(jail, "workspace.ext4")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
    await link(scratch, path.join(jail, "workspace.ext4"));
    for (const name of ["api.sock", "vsock.sock", "vsock.sock_1024"])
      await unlink(path.join(jail, name)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    this.runtime.set(id, {
      sockets: new Set(),
      runner: false,
      bootLog: "",
      directory: await open(jail, "r"),
    });
    const args = [
      "--id",
      id,
      "--exec-file",
      this.binary,
      "--uid",
      String(record.uid),
      "--gid",
      String(record.uid),
      "--chroot-base-dir",
      path.join(this.stateDir, "jails"),
      "--cgroup-version",
      "2",
      "--parent-cgroup",
      `zlayer-firecracker/${this.config.INSTANCE_ID}`,
      "--cgroup",
      `memory.max=${(record.input.memoryMb + 192) * 1048576}`,
      "--cgroup",
      `cpu.max=${record.input.cpu * 100000} 100000`,
      "--cgroup",
      "pids.max=256",
      "--cgroup",
      "memory.swap.max=0",
      "--cgroup",
      "memory.oom.group=1",
      "--resource-limit",
      "no-file=1024",
      "--new-pid-ns",
      "--",
      "--api-sock",
      "/api.sock",
    ];
    try {
      const runtime = this.runtime.get(id)!;
      const launcher = spawn(this.config.FIRECRACKER_JAILER, args, {
        env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin" },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      runtime.launcher = launcher;
      for (const output of [launcher.stdout, launcher.stderr])
        output?.on("data", (chunk) => {
          runtime.bootLog = (runtime.bootLog + String(chunk)).slice(-16384);
        });
      await new Promise<void>((resolve, reject) => {
        launcher.once("spawn", resolve);
        launcher.once("error", reject);
      });
      await this.waitFor(async () => {
        await this.api(id, "GET", "/");
      }, 10000);
      await this.api(id, "PUT", "/machine-config", {
        vcpu_count: record.input.cpu,
        mem_size_mib: record.input.memoryMb,
        smt: false,
      });
      await this.api(id, "PUT", "/boot-source", {
        kernel_image_path: "/vmlinux",
        boot_args:
          "console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda ro init=/sbin/zlayer-init",
      });
      await this.api(id, "PUT", "/drives/rootfs", {
        drive_id: "rootfs",
        path_on_host: "/rootfs.ext4",
        is_root_device: true,
        is_read_only: true,
      });
      await this.api(id, "PUT", "/drives/workspace", {
        drive_id: "workspace",
        path_on_host: "/workspace.ext4",
        is_root_device: false,
        is_read_only: false,
        cache_type: "Writeback",
        rate_limiter: {
          bandwidth: { size: 67108864, refill_time: 1000 },
          ops: { size: 4096, refill_time: 1000 },
        },
      });
      await this.api(id, "PUT", "/vsock", {
        guest_cid: 3,
        uds_path: "/vsock.sock",
      });
      if (record.input.approvedHosts.length) await this.startProxy(id);
      await this.api(id, "PUT", "/actions", { action_type: "InstanceStart" });
      await this.waitFor(async () => {
        const connection = await connectGuest(
          this.socketPath(id, "vsock.sock"),
          "ping",
        );
        connection.destroy();
      }, 30000);
      record.startedAt = new Date().toISOString();
      await this.save(record);
    } catch (error) {
      console.error(
        "Firecracker guest startup failed:",
        this.runtime.get(id)?.bootLog,
      );
      await this.stop(id);
      throw error;
    }
  }

  private async waitFor(operation: () => Promise<void>, timeoutMs: number) {
    const end = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < end) {
      try {
        await operation();
        return;
      } catch (error) {
        last = error;
        await delay(100);
      }
    }
    throw last ?? new Error("FIRECRACKER_BOOT_TIMEOUT");
  }

  private async startProxy(id: string) {
    const runtime = this.runtime.get(id)!;
    const record = this.record(id);
    const input = Buffer.from(
      JSON.stringify({
        op: "proxy",
        hosts: record.input.approvedHosts,
        bind: "127.0.0.1",
        port: 0,
        reportReady: true,
      }),
    ).toString("base64url");
    const proxy = spawn(
      process.execPath,
      [this.config.FIRECRACKER_HELPER, input],
      {
        uid: record.uid,
        gid: record.uid,
        env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    proxy.on("error", () => {});
    if (!proxy.pid) throw new Error("EGRESS_START_FAILED");
    runtime.proxy = proxy;
    // Charge host proxy CPU/memory to the same VM, and terminate both together.
    await writeFile(
      path.join(this.cgroup(id), "cgroup.procs"),
      String(proxy.pid),
    );
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        proxy.kill("SIGKILL");
        reject(new Error("EGRESS_START_TIMEOUT"));
      }, 5000);
      let data = "";
      proxy.stdout!.on("data", (chunk) => {
        data += String(chunk);
        if (data.length > 1024) {
          proxy.kill("SIGKILL");
          return;
        }
        if (!data.includes("\n")) return;
        try {
          const value = z
            .object({ port: z.number().int().min(1).max(65535) })
            .parse(JSON.parse(data));
          clearTimeout(timer);
          resolve(value.port);
        } catch {
          clearTimeout(timer);
          reject(new Error("EGRESS_START_FAILED"));
        }
      });
      proxy.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      proxy.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("EGRESS_EXITED"));
      });
    });
    const egress = net.createServer((socket) => {
      if (runtime.sockets.size >= 64) {
        socket.destroy();
        return;
      }
      const upstream = net.createConnection({ host: "127.0.0.1", port });
      runtime.sockets.add(socket);
      socket.setTimeout(60000, () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
      socket.once("close", () => {
        runtime.sockets.delete(socket);
        upstream.destroy();
      });
      socket.pipe(upstream).pipe(socket);
    });
    runtime.egress = egress;
    const socketPath = this.socketPath(id, "vsock.sock_1024");
    await new Promise<void>((resolve, reject) => {
      egress.once("error", reject);
      egress.listen(socketPath, resolve);
    });
    await chown(socketPath, record.uid, record.uid);
    await chmod(socketPath, 0o600);
  }

  async open(id: string, kind: string) {
    this.record(id);
    if (this.busy.has(id))
      throw new SandboxError(
        "FIRECRACKER_VM_BUSY",
        "Sandbox lifecycle operation in progress.",
        409,
      );
    const runtime = this.runtime.get(id);
    if (
      !runtime ||
      runtime.sockets.size >= 64 ||
      (kind === "runner" && runtime.runner)
    )
      throw new SandboxError(
        "FIRECRACKER_GUEST_BUSY",
        "Sandbox is stopped or busy.",
        409,
      );
    if (kind === "runner") runtime.runner = true;
    try {
      const socket = await connectGuest(
        this.socketPath(id, "vsock.sock"),
        kind,
      );
      runtime.sockets.add(socket);
      socket.once("close", () => {
        runtime.sockets.delete(socket);
        if (kind === "runner") runtime.runner = false;
      });
      return socket;
    } catch (error) {
      if (kind === "runner") runtime.runner = false;
      throw error;
    }
  }

  async inspect(id: string) {
    const record = this.record(id);
    let state = "Stopped";
    try {
      state = (await this.api<{ state: string }>(id, "GET", "/")).state;
    } catch (error) {
      if (
        !(
          error instanceof SandboxError &&
          error.code === "FIRECRACKER_HOST_UNAVAILABLE"
        )
      )
        throw error;
    }
    return {
      running: state === "Running" || state === "Paused",
      paused: state === "Paused",
      exitCode: state === "Stopped" ? 0 : null,
      startedAt: record.startedAt,
      approvedHosts: record.input.approvedHosts,
    };
  }
  async stats(id: string) {
    this.record(id);
    const group = this.cgroup(id);
    const value = async (name: string) =>
      readFile(path.join(group, name), "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "0";
          throw error;
        },
      );
    const [memory, pids, cpu] = await Promise.all([
      value("memory.current"),
      value("pids.current"),
      value("cpu.stat"),
    ]);
    return {
      memory: {
        usage: Number(memory),
        limit: (this.record(id).input.memoryMb + 192) * 1048576,
      },
      pids: { current: Number(pids) },
      cpu: { usage_usec: Number(/^usage_usec (\d+)$/m.exec(cpu)?.[1] ?? 0) },
      scope: "host-vmm-and-egress",
    };
  }
  async lifecycle(id: string, action: string, force = false) {
    this.record(id);
    if (action === "stop") return this.stop(id, !force);
    if (action === "start") return this.start(id);
    if (action === "restart") {
      await this.stop(id, true);
      return this.start(id);
    }
    await this.api(id, "PATCH", "/vm", {
      state: action === "pause" ? "Paused" : "Resumed",
    });
  }
  private async stop(id: string, flush = false) {
    this.record(id);
    let flushFailed = false;
    if (flush && this.runtime.has(id)) {
      try {
        const state = await this.inspect(id);
        if (state.paused)
          await this.api(id, "PATCH", "/vm", { state: "Resumed" });
        if (state.running) {
          const connection = await connectGuest(
            this.socketPath(id, "vsock.sock"),
            "sync",
          );
          connection.destroy();
        }
      } catch {
        flushFailed = true;
      }
    }
    const group = this.cgroup(id);
    await writeFile(path.join(group, "cgroup.kill"), "1").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
    // Wait before releasing disks or reusing the cgroup.
    await this.waitFor(async () => {
      const processes = await readFile(
        path.join(group, "cgroup.procs"),
        "utf8",
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      if (processes.trim()) throw new Error("FIRECRACKER_TERMINATION_PENDING");
    }, 5000);
    const runtime = this.runtime.get(id);
    if (runtime) {
      for (const socket of runtime.sockets) socket.destroy();
      if (runtime.egress)
        await new Promise<void>((resolve) =>
          runtime.egress!.close(() => resolve()),
        );
      runtime.launcher?.kill("SIGKILL");
      if (
        runtime.proxy &&
        runtime.proxy.exitCode === null &&
        runtime.proxy.signalCode === null
      ) {
        const proxy = runtime.proxy;
        await new Promise<void>((resolve) => {
          proxy.once("exit", () => resolve());
          proxy.kill("SIGKILL");
        });
      }
      await runtime.directory.close();
      this.runtime.delete(id);
    }
    await this.waitFor(async () => {
      await rmdir(group).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }, 5000);
    for (const name of ["api.sock", "vsock.sock", "vsock.sock_1024"])
      await unlink(path.join(this.jail(id), name)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    if (flushFailed)
      throw new SandboxError(
        "FIRECRACKER_FLUSH_FAILED",
        "VM stopped, but workspace flushing could not be confirmed.",
      );
  }
  async destroy(id: string) {
    if (!this.records.has(vmIdSchema.parse(id))) return;
    await this.stop(id);
    // UUID validation and fixed roots prevent deletion outside this manager's state.
    await rm(path.dirname(this.jail(id)), { recursive: true, force: true });
    await rm(this.directory(id), { recursive: true, force: true });
    this.records.delete(id);
  }
  async reconcile(ids: string[]) {
    const known = new Set(ids.map((id) => vmIdSchema.parse(id)));
    for (const record of this.records.values()) {
      if (
        !known.has(record.id) &&
        record.createdAt < Date.now() - 120000 &&
        !this.busy.has(record.id)
      )
        await this.exclusive(record.id, () => this.destroy(record.id));
    }
  }
  async shutdown() {
    const results = await Promise.allSettled(
      [...this.records.keys()].map((id) => this.stop(id, true)),
    );
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
  }
}
