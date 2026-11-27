import assert from "node:assert/strict";
import { FirecrackerSandboxProvider } from "@repo/sandbox";

const provider = new FirecrackerSandboxProvider();
const { resourceId } = await provider.create({
  name: "lifecycle-smoke",
  memoryMb: 1024,
  cpu: 1,
  approvedHosts: ["example.com", "localhost"],
});
try {
  const stats = (await provider.stats(resourceId)) as {
    memory: { usage: number };
    pids: { current: number };
  };
  assert.ok(stats.memory.usage > 0);
  assert.ok(stats.pids.current > 0);
  await provider.file(resourceId, {
    op: "write",
    path: "persist.txt",
    data: Buffer.from("survives-reboot").toString("base64"),
  });
  await provider.lifecycle(resourceId, "pause");
  assert.equal(
    ((await provider.inspect(resourceId)) as { paused: boolean }).paused,
    true,
  );
  await provider.lifecycle(resourceId, "resume");
  await provider.lifecycle(resourceId, "stop");
  assert.equal(
    ((await provider.inspect(resourceId)) as { running: boolean }).running,
    false,
  );
  await provider.lifecycle(resourceId, "start");
  const outputLimited = await provider.execute(resourceId, "yes", {
    maxOutputBytes: 1024,
    timeoutMs: 5000,
  });
  assert.equal(outputLimited.outputLimited, true);
  assert.equal(
    ((await provider.inspect(resourceId)) as { running: boolean }).running,
    false,
  );
  await provider.lifecycle(resourceId, "start");
  const read = await provider.file<{ data: string }>(resourceId, {
    op: "read",
    path: "persist.txt",
  });
  assert.equal(Buffer.from(read.data, "base64").toString(), "survives-reboot");
  await provider.lifecycle(resourceId, "restart");
  const request = (url: string) =>
    provider.execute(
      resourceId,
      `node -e 'const h=require("http");const r=h.get({host:"127.0.0.1",port:8080,path:${JSON.stringify(url)}},s=>{console.log(s.statusCode);s.resume()});r.on("error",()=>process.exit(1));'`,
    );
  assert.equal((await request("http://example.org/")).stdout.trim(), "403");
  assert.equal((await request("http://localhost/")).stdout.trim(), "403");
  const allowed = await request("http://example.com/");
  assert.match(allowed.stdout.trim(), /^[23]\d\d$/);
  const interfaces = await provider.execute(resourceId, "ls /sys/class/net");
  assert.equal(interfaces.stdout.trim(), "lo");
  const timedOut = await provider.execute(resourceId, "sleep 30", {
    timeoutMs: 100,
  });
  assert.equal(timedOut.timedOut, true);
  assert.equal(
    ((await provider.inspect(resourceId)) as { running: boolean }).running,
    false,
  );
  console.log(
    JSON.stringify({
      lifecycle: "passed",
      networking: "passed",
      timeoutIsolation: "passed",
      outputLimitIsolation: "passed",
    }),
  );
} finally {
  await provider.destroy(resourceId);
}
