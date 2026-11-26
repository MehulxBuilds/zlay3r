import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DockerSandboxProvider } from "@repo/sandbox";

if (process.platform !== "linux") {
  throw new Error(
    "Run this launcher with bun run dev:backend:wsl from Windows.",
  );
}

// Validate the root .env and native Docker connection before starting services.
await new DockerSandboxProvider().preflight();
const cwd = fileURLToPath(new URL("../../../", import.meta.url));
const children = ["apps/http/src/index.ts", "apps/worker/src/index.ts"].map(
  (entry) =>
    spawn(process.execPath, ["--import", "tsx", "--watch", entry], {
      cwd,
      stdio: "inherit",
      detached: true,
    }),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
console.log(
  "Starting API and worker in Ubuntu using the root .env. Ctrl+C stops both.",
);
await Promise.all(
  children.map(
    (child) =>
      new Promise<void>((resolve) => {
        child.once("error", (error) => {
          console.error(error.message);
          process.exitCode = 1;
          stop();
          resolve();
        });
        child.once("exit", (code, signal) => {
          if (!stopping) {
            process.exitCode = code || (signal ? 1 : 0);
            stop();
          }
          resolve();
        });
      }),
  ),
);
