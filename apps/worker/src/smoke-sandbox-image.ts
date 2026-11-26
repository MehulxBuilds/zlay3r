import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { DockerSandboxProvider } from "@repo/sandbox";

// Explicit opt-in integration test. Only this temporary sandbox is modified.
const provider = new DockerSandboxProvider();
const { resourceId } = await provider.create({
  name: `image-smoke-${randomUUID().slice(0, 8)}`,
  memoryMb: 1024,
  cpu: 1,
});
const timings: Record<string, number> = {};
async function timed<T>(name: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    timings[name] = Math.round(performance.now() - start);
  }
}
try {
  const listing = await timed("listMs", () =>
    provider.file<{ entries: unknown[] }>(resourceId, {
      op: "list",
      path: ".",
    }),
  );
  assert.deepEqual(listing.entries, []);
  await provider.file(resourceId, {
    op: "write",
    path: "hello.txt",
    data: Buffer.from("hello").toString("base64"),
  });
  const read = await provider.file<{ data: string }>(resourceId, {
    op: "read",
    path: "hello.txt",
  });
  assert.equal(Buffer.from(read.data, "base64").toString(), "hello");
  await assert.rejects(
    provider.file(resourceId, { op: "read", path: "../etc/passwd" }),
    /Choose a path inside/,
  );
  const shell = await timed("shellMs", () =>
    provider.execute(resourceId, "printf shell-ok", { timeoutMs: 10000 }),
  );
  assert.equal(shell.stdout, "shell-ok");

  // A small fixture peer verifies the official SDK's lazy stdio transport.
  const peer = [
    "const readline = require('node:readline');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    "  const msg = JSON.parse(line);",
    "  if (msg.id !== undefined) console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } }));",
    "});",
  ].join("\n");
  const mcp = await timed("mcpMs", () =>
    provider.service<{ result: { tools: unknown[] } }>(resourceId, {
      op: "mcp",
      id: "fixture",
      command: "node",
      args: ["-e", peer],
      message: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    }),
  );
  assert.deepEqual(mcp.result.tools, []);
  await provider.service(resourceId, { op: "mcp", id: "fixture", close: true });

  await timed("browserMs", () =>
    provider.service(resourceId, { op: "browser.create", id: "blank" }),
  );
  const page = await provider.service<{ url: string }>(resourceId, {
    op: "browser.inspect",
    id: "blank",
  });
  assert.equal(page.url, "about:blank");
  await provider.service(resourceId, { op: "browser.close", id: "blank" });
  console.log(
    "Image smoke passed: native file protocol, path restrictions, shell, MCP stdio and Chromium.",
    JSON.stringify(timings),
  );
} finally {
  await provider.destroy(resourceId);
}
