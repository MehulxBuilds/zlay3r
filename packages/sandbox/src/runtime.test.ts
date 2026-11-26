import { expect, test } from "bun:test";
import { server_env as env } from "@repo/env";
import { DockerSandboxProvider } from "./index";
import { Duplex } from "node:stream";

function fixture(runtimes: Record<string, unknown>, os = "linux") {
  const provider = new DockerSandboxProvider();
  let inspectedImage = false;
  let createdNetwork = false;
  let runtime: string | undefined;
  Object.defineProperty(provider, "docker", {
    value: {
      version: async () => ({ Version: "28.0.0" }),
      info: async () => ({ OSType: os, Runtimes: runtimes }),
      getImage: () => ({
        inspect: async () => {
          inspectedImage = true;
        },
      }),
      createNetwork: async () => {
        createdNetwork = true;
        return {};
      },
      createContainer: async (options: { HostConfig: { Runtime: string } }) => {
        runtime = options.HostConfig.Runtime;
        return { id: "sandbox", start: async () => {} };
      },
    },
  });
  return {
    provider,
    state: () => ({ inspectedImage, createdNetwork, runtime }),
  };
}

test("missing runtime fails before allocating sandbox resources", async () => {
  const { provider, state } = fixture({});
  await expect(
    provider.create({ name: "test", memoryMb: 512, cpu: 1 }),
  ).rejects.toMatchObject({ code: "SANDBOX_RUNTIME_UNAVAILABLE" });
  expect(state().createdNetwork).toBe(false);
  expect(state().inspectedImage).toBe(false);
});

test("non-Linux daemon is rejected", async () => {
  const { provider } = fixture({ [env.SANDBOX_RUNTIME]: {} }, "windows");
  await expect(provider.preflight()).rejects.toMatchObject({
    code: "SANDBOX_LINUX_REQUIRED",
  });
});

test("sandbox creation explicitly selects the configured runtime", async () => {
  const { provider, state } = fixture({ [env.SANDBOX_RUNTIME]: {} });
  await expect(
    provider.create({ name: "test", memoryMb: 512, cpu: 1 }),
  ).resolves.toEqual({ resourceId: "sandbox" });
  expect(state().runtime).toBe(env.SANDBOX_RUNTIME);
});

test("existing sandboxes cannot run agents under a different runtime", async () => {
  const provider = new DockerSandboxProvider();
  Object.defineProperty(provider, "docker", {
    value: {
      getContainer: () => ({
        inspect: async () => ({ HostConfig: { Runtime: "different-runtime" } }),
      }),
    },
  });
  await expect(
    provider.runAgent("old", {}, async () => null, {
      signal: new AbortController().signal,
      timeoutMs: 1000,
    }),
  ).rejects.toMatchObject({ code: "SANDBOX_RUNTIME_MISMATCH" });
});

test("file listing bypasses Node and completes without closing request stdin", async () => {
  const provider = new DockerSandboxProvider();
  let command: string[] = [];
  let request = "";
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      request += String(chunk);
      callback();
      queueMicrotask(() => {
        stream.push(JSON.stringify({ result: { entries: [] } }));
        stream.push(null);
      });
    },
  });
  Object.defineProperty(provider, "docker", {
    value: {
      getContainer: () => ({
        exec: async (options: { Cmd: string[]; User: string }) => {
          command = options.Cmd;
          expect(options.User).toBe("1000:1000");
          return { start: async () => stream };
        },
      }),
      modem: {
        demuxStream: (input: Duplex, output: NodeJS.WritableStream) =>
          input.pipe(output),
      },
    },
  });
  await expect(
    provider.file("test", { op: "list", path: "." }),
  ).resolves.toEqual({ entries: [] });
  expect(command).toEqual(["python3", "/opt/zlayer/filesystem.py"]);
  expect(JSON.parse(request)).toEqual({ op: "list", path: "." });
});
