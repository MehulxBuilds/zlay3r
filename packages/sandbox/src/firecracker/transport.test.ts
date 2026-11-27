import { expect, test } from "bun:test";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { connectGuest } from "./guest";
import { createVmSchema, parseVmResourceId } from "./validation";

test("host validation rejects fractional CPUs, excessive memory, and invalid hostnames", () => {
  const input = { name: "test", memoryMb: 512, cpu: 1 };
  for (const change of [
    { cpu: 0.5 },
    { memoryMb: 128 },
    { approvedHosts: ["https://example.com"] },
    { approvedHosts: ["*.example.com"] },
  ]) {
    expect(createVmSchema.safeParse({ ...input, ...change }).success).toBe(
      false,
    );
  }
  expect(() => parseVmResourceId("firecracker:../../outside")).toThrow();
});

test.skipIf(process.platform === "win32")(
  "vsock adapter consumes both handshakes and preserves protocol bytes",
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "zlayer-vsock-"));
    const socketPath = path.join(directory, "vsock.sock");
    const server = net.createServer((socket) => {
      let stage = 0;
      socket.on("data", (chunk) => {
        if (stage++ === 0) {
          expect(String(chunk)).toBe("CONNECT 52\n");
          socket.write("OK 1234\n");
        } else {
          expect(JSON.parse(String(chunk))).toEqual({ kind: "runner" });
          socket.write('OK\n{"kind":"ready"}\n');
        }
      });
    });
    try {
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      const connection = await connectGuest(socketPath, "runner");
      const message = await new Promise<string>((resolve) => {
        connection.once("data", (chunk) => resolve(String(chunk)));
        connection.resume();
      });
      expect(message).toBe('{"kind":"ready"}\n');
      connection.destroy();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true });
    }
  },
);
