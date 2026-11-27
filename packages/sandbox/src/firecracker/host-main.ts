import { assertTrustedPath } from "./host-files";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import { chown, chmod, lstat, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { server_env as env } from "@repo/env";
import { SandboxError } from "../contracts";
import { FirecrackerHostManager } from "./host-manager";
import {
  createVmSchema,
  guestRequestSchema,
  lifecycleSchema,
  vmIdSchema,
} from "./validation";

const manager = new FirecrackerHostManager(env);
let ready = false;
let closing = false;

async function readBody(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536)
      throw new SandboxError(
        "REQUEST_TOO_LARGE",
        "Host request exceeds its limit.",
        413,
      );
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function respond(reply: ServerResponse, code: number, value: unknown) {
  reply.writeHead(code, { "content-type": "application/json" });
  reply.end(JSON.stringify(value));
}
function failure(error: unknown) {
  if (error instanceof SandboxError)
    return {
      status: error.statusCode,
      code: error.code,
      message: error.message,
    };
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return {
      status: 400,
      code: "INVALID_HOST_REQUEST",
      message: "Invalid Firecracker host request.",
    };
  console.error(
    "Firecracker operation failed:",
    error instanceof Error ? error.message : "unknown",
  );
  return {
    status: 503,
    code: "FIRECRACKER_OPERATION_FAILED",
    message: "Firecracker operation failed. Check the host service journal.",
  };
}

async function handleRequest(request: IncomingMessage, reply: ServerResponse) {
  try {
    if (!ready || closing)
      throw new SandboxError(
        "FIRECRACKER_HOST_NOT_READY",
        "Firecracker host service is starting or stopping.",
      );
    const url = request.url ?? "";
    if (request.method === "GET" && url === "/health")
      return respond(reply, 200, { ready });
    if (request.method === "POST" && url === "/vms")
      return respond(
        reply,
        201,
        await manager.create(createVmSchema.parse(await readBody(request))),
      );
    if (request.method === "POST" && url === "/reconcile") {
      const { ids } = z
        .strictObject({ ids: z.array(vmIdSchema).max(100000) })
        .parse(await readBody(request));
      await manager.reconcile(ids);
      return respond(reply, 200, {});
    }
    const match = /^\/vms\/([^/]+)(?:\/(stats|lifecycle))?$/.exec(url);
    if (!match) return respond(reply, 404, { code: "NOT_FOUND" });
    const id = vmIdSchema.parse(match[1]);
    if (request.method === "GET" && !match[2])
      return respond(reply, 200, await manager.inspect(id));
    if (request.method === "GET" && match[2] === "stats")
      return respond(reply, 200, await manager.stats(id));
    if (request.method === "POST" && match[2] === "lifecycle") {
      const { action, force } = z
        .strictObject({
          action: lifecycleSchema,
          force: z.boolean().default(false),
        })
        .refine((input) => !input.force || input.action === "stop")
        .parse(await readBody(request));
      await manager.exclusive(id, () => manager.lifecycle(id, action, force));
      return respond(reply, 200, {});
    }
    if (request.method === "DELETE" && !match[2]) {
      await manager.exclusive(id, () => manager.destroy(id));
      return respond(reply, 200, {});
    }
    respond(reply, 405, { code: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    const result = failure(error);
    respond(reply, result.status, result);
  }
}
const pending = new Set<Promise<void>>();
const server = http.createServer((request, reply) => {
  const operation = handleRequest(request, reply);
  pending.add(operation);
  void operation.finally(() => pending.delete(operation));
});
server.requestTimeout = 90000;
server.headersTimeout = 10000;
server.maxConnections = 256;
server.on("upgrade", async (request, socket, head) => {
  socket.on("error", () => {});
  try {
    if (
      !ready ||
      closing ||
      head.length ||
      request.method !== "POST" ||
      request.headers.upgrade !== "zlayer-guest"
    )
      throw new Error("INVALID_GUEST_UPGRADE");
    const match = /^\/vms\/([^/]+)\/stream\/(runner|helper|filesystem)$/.exec(
      request.url ?? "",
    );
    if (!match) throw new Error("INVALID_GUEST_UPGRADE");
    const id = vmIdSchema.parse(match[1]);
    const { kind } = guestRequestSchema.parse({ kind: match[2] });
    const guest = await manager.open(id, kind);
    if (socket.destroyed || closing) {
      guest.destroy();
      return;
    }
    // Preserve the response half until the guest has reaped its process.
    socket.allowHalfOpen = true;
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: zlayer-guest\r\n\r\n",
    );
    socket.once("close", () => guest.destroy());
    guest.once("error", () => socket.destroy());
    guest.once("close", () => socket.end());
    socket.pipe(guest).pipe(socket);
  } catch (error) {
    const result = failure(error);
    socket.end(
      `HTTP/1.1 ${result.status} Error\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  }
});

const parent = path.dirname(env.FIRECRACKER_SOCKET);
await mkdir(parent, { recursive: true, mode: 0o750 });
await assertTrustedPath(parent);
const info = await lstat(parent);
if (!info.isDirectory() || info.uid !== 0 || info.mode & 0o022)
  throw new Error(
    "Firecracker socket directory must be root-owned and not group/world writable.",
  );
await chown(parent, 0, env.FIRECRACKER_SOCKET_GID);
await chmod(parent, 0o750);
try {
  const existing = await lstat(env.FIRECRACKER_SOCKET);
  if (!existing.isSocket())
    throw new Error("Refusing to replace a non-socket host path.");
  const active = await new Promise<boolean>((resolve) => {
    const socket = net.createConnection(env.FIRECRACKER_SOCKET);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
  if (active) throw new Error("Firecracker host service is already running.");
  await unlink(env.FIRECRACKER_SOCKET);
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
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(env.FIRECRACKER_SOCKET, resolve);
});
await chown(env.FIRECRACKER_SOCKET, 0, env.FIRECRACKER_SOCKET_GID);
await chmod(env.FIRECRACKER_SOCKET, 0o660);
await manager.initialize();
ready = true;
console.log("Firecracker host service ready.");
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  let exitCode = 0;
  try {
    await Promise.allSettled([...pending]);
    await manager.shutdown();
  } catch (error) {
    exitCode = 1;
    console.error(
      "Firecracker shutdown failed:",
      error instanceof Error ? error.message : "unknown",
    );
  } finally {
    await unlink(env.FIRECRACKER_SOCKET).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
    process.exit(exitCode);
  }
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
