import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  unlink,
  realpath,
  stat,
  rm,
} from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

async function publicAddress(host) {
  const addresses = await lookup(host, { family: 4, all: true });
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) =>
        !ipaddr.isValid(address) || ipaddr.parse(address).range() !== "unicast",
    )
  )
    throw new Error("PRIVATE_DESTINATION_BLOCKED");
  return addresses[0].address;
}

process.stdin.setEncoding("utf8");
const input =
  process.argv[2] === "--stdin"
    ? await new Promise((resolve, reject) => {
        let data = "";
        const receive = (chunk) => {
          data += chunk;
          if (data.length > 16 * 1048576) {
            process.stdin.pause();
            reject(new Error("REQUEST_TOO_LARGE"));
          }
          if (data.includes("\n")) {
            process.stdin.removeListener("data", receive);
            // Each helper handles one request. Close Docker's attached input so
            // it cannot keep the process alive after the response is written.
            process.stdin.destroy();
            try {
              resolve(JSON.parse(data.slice(0, data.indexOf("\n"))));
            } catch (error) {
              reject(error);
            }
          }
        };
        process.stdin.on("data", receive);
        process.stdin.once("error", reject);
      })
    : JSON.parse(Buffer.from(process.argv[2], "base64url").toString());
const root = "/workspace";
const control = "/tmp/.zlayer";
await mkdir(control, { recursive: true, mode: 0o700 });
if (input.op === "proxy") {
  const allowed = new Set(input.hosts.map((host) => host.toLowerCase()));
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url);
      if (
        url.protocol !== "http:" ||
        (url.port && url.port !== "80") ||
        !allowed.has(url.hostname.toLowerCase())
      )
        throw new Error("HOST_BLOCKED");
      const address = await publicAddress(url.hostname);
      const headers = { ...request.headers, host: url.hostname };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = http.request(
        {
          host: address,
          port: 80,
          path: url.pathname + url.search,
          method: request.method,
          headers,
          timeout: 30000,
        },
        (incoming) => {
          response.writeHead(incoming.statusCode ?? 502, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        response.writeHead(502);
        response.end();
      });
      request.pipe(upstream);
    } catch {
      response.writeHead(403);
      response.end("Destination blocked");
    }
  });
  server.on("connect", async (request, socket, head) => {
    try {
      const url = new URL(`https://${request.url}`);
      if (
        (url.port && url.port !== "443") ||
        !allowed.has(url.hostname.toLowerCase())
      )
        throw new Error("HOST_BLOCKED");
      const address = await publicAddress(url.hostname);
      const upstream = net.connect(443, address, () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.setTimeout(60000, () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());
    } catch {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }
  });
  server.listen(8080, "0.0.0.0");
  await new Promise(() => {});
}
const serviceSocket = `${control}/service.sock`;
async function serviceRequest(body) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: serviceSocket,
        path: "/",
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
          if (data.length > 20 * 1048576)
            response.destroy(new Error("RESPONSE_LIMIT"));
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            const value = JSON.parse(data);
            if (value.error) reject(new Error(value.error));
            else resolve(value.result);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.setTimeout(35000, () =>
      request.destroy(new Error("SERVICE_TIMEOUT")),
    );
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}
if (input.op === "service") {
  const { chromium } = await import("playwright");
  const sessions = new Map();
  const mcpProcesses = new Map();
  let browser;
  const server = http.createServer(async (request, response) => {
    request.setEncoding("utf8");
    let data = "";
    for await (const chunk of request) {
      data += chunk;
      if (data.length > 12 * 1048576) {
        response.writeHead(413);
        response.end();
        return;
      }
    }
    try {
      const action = JSON.parse(data);
      let result;
      if (action.op === "ping") result = { ready: true };
      else if (action.op === "browser.create") {
        if (sessions.has(action.id))
          await sessions.get(action.id).context.close();
        if (sessions.size >= 10 && !sessions.has(action.id))
          throw new Error("BROWSER_SESSION_LIMIT");
        browser ??= await chromium.launch({
          headless: true,
          chromiumSandbox: false,
          proxy: action.proxy
            ? { server: action.proxy, bypass: "<-loopback>" }
            : undefined,
        });
        const context = await browser.newContext({
          acceptDownloads: true,
          storageState: action.state,
          serviceWorkers: "block",
        });
        const hosts = new Set(
          (action.hosts ?? []).map((host) => host.toLowerCase()),
        );
        await context.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (
            ["http:", "https:"].includes(url.protocol) &&
            !hosts.has(url.hostname.toLowerCase())
          )
            return route.abort("blockedbyclient");
          if (
            net.isIP(url.hostname.replace(/^\[|\]$/g, "")) &&
            ipaddr.parse(url.hostname.replace(/^\[|\]$/g, "")).range() !==
              "unicast"
          )
            return route.abort("blockedbyclient");
          return route.continue();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(30000);
        sessions.set(action.id, { context, page });
        result = { id: action.id };
      } else if (action.op.startsWith("browser.")) {
        const session = sessions.get(action.id);
        if (!session) throw new Error("BROWSER_SESSION_LOST");
        const { page, context } = session;
        if (action.op === "browser.navigate") {
          const url = new URL(action.url);
          if (!["http:", "https:"].includes(url.protocol))
            throw new Error("INVALID_URL");
          await page.goto(url.href);
        } else if (action.op === "browser.click")
          await page.locator(action.selector).click();
        else if (action.op === "browser.type")
          await page.locator(action.selector).fill(action.text);
        else if (action.op === "browser.scroll")
          await page.mouse.wheel(
            0,
            Math.max(-10000, Math.min(10000, action.y)),
          );
        else if (action.op === "browser.screenshot")
          result = {
            data: (await page.screenshot({ fullPage: false })).toString(
              "base64",
            ),
          };
        else if (action.op === "browser.download") {
          const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.locator(action.selector).click(),
          ]);
          const location = await download.path();
          const info = await stat(location);
          if (info.size > 8 * 1048576) {
            await download.delete();
            throw new Error("DOWNLOAD_TOO_LARGE");
          }
          result = {
            filename: download.suggestedFilename(),
            data: (await readFile(location)).toString("base64"),
          };
          await download.delete();
        } else if (action.op === "browser.state")
          result = { state: await context.storageState() };
        else if (action.op === "browser.close") {
          await context.close();
          sessions.delete(action.id);
          result = { closed: true };
        } else if (action.op !== "browser.inspect")
          throw new Error("UNKNOWN_BROWSER_ACTION");
        result ??= {
          url: page.url(),
          title: await page.title(),
          text: (await page.locator("body").innerText()).slice(0, 32000),
        };
      } else if (action.op === "mcp") {
        let session = mcpProcesses.get(action.id);
        if (!session && action.close) {
          response.end(JSON.stringify({ result: { closed: true } }));
          return;
        }
        if (!session) {
          const transport = new StdioClientTransport({
            command: action.command,
            args: action.args ?? [],
            cwd: root,
            env: {
              PATH: "/usr/local/bin:/usr/bin:/bin",
              HOME: root,
              ...action.env,
            },
            stderr: "ignore",
          });
          session = { transport, pending: new Map() };
          mcpProcesses.set(action.id, session);
          const fail = () => {
            for (const pending of session.pending.values())
              pending.reject(new Error("MCP_DISCONNECTED"));
            session.pending.clear();
            mcpProcesses.delete(action.id);
          };
          transport.onmessage = (message) => {
            if (JSON.stringify(message).length > 1048576) {
              fail();
              void transport.close().catch(() => {});
              return;
            }
            if ("id" in message) {
              const pending = session.pending.get(message.id);
              session.pending.delete(message.id);
              pending?.resolve(message);
            }
          };
          transport.onclose = fail;
          transport.onerror = () => {
            fail();
            void transport.close().catch(() => {});
          };
          try {
            await transport.start();
          } catch (error) {
            fail();
            throw error;
          }
        }
        if (action.close) {
          await session.transport.close();
          mcpProcesses.delete(action.id);
          result = { closed: true };
        } else if (action.message.id === undefined) {
          await session.transport.send(action.message);
          result = {};
        } else {
          if (session.pending.size >= 128) throw new Error("MCP_REQUEST_LIMIT");
          result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              session.pending.delete(action.message.id);
              reject(new Error("MCP_TIMEOUT"));
            }, 30000);
            session.pending.set(action.message.id, {
              resolve(value) {
                clearTimeout(timer);
                resolve(value);
              },
              reject(error) {
                clearTimeout(timer);
                reject(error);
              },
            });
            void session.transport.send(action.message).catch((error) => {
              session.pending.delete(action.message.id);
              clearTimeout(timer);
              reject(error);
            });
          });
        }
      } else throw new Error("UNKNOWN_SERVICE_ACTION");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ result }));
    } catch (error) {
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await unlink(serviceSocket).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  server.listen(serviceSocket);
  await new Promise(() => {});
}
function identifier(value) {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error("INVALID_EXECUTION_ID");
  return value;
}
async function safePath(value = ".", create = false) {
  if (typeof value !== "string" || value.includes("\0"))
    throw new Error("INVALID_PATH");
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}/`))
    throw new Error("PATH_OUTSIDE_WORKSPACE");
  let actual;
  try {
    actual = await realpath(resolved);
  } catch (error) {
    if (!create || error.code !== "ENOENT") throw error;
    actual = path.join(
      await realpath(path.dirname(resolved)),
      path.basename(resolved),
    );
  }
  if (actual !== root && !actual.startsWith(`${root}/`))
    throw new Error("PATH_OUTSIDE_WORKSPACE");
  return actual;
}
function terminate(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
async function main() {
  if (input.op === "service.request") {
    try {
      await serviceRequest({ op: "ping" });
    } catch {
      const lock = `${control}/service-start.lock`;
      let ownsLock = false;
      try {
        try {
          await mkdir(lock);
          ownsLock = true;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (Date.now() - (await stat(lock)).mtimeMs > 10000) {
            await rm(lock, { recursive: true, force: true });
            await mkdir(lock);
            ownsLock = true;
          }
        }
        if (ownsLock) {
          try {
            await serviceRequest({ op: "ping" });
          } catch {
            const child = spawn(
              "node",
              [
                "/opt/zlayer/helper.mjs",
                Buffer.from(JSON.stringify({ op: "service" })).toString(
                  "base64url",
                ),
              ],
              { detached: true, stdio: "ignore" },
            );
            child.unref();
          }
        }
        for (let retry = 0; retry < 50; retry++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          try {
            await serviceRequest({ op: "ping" });
            break;
          } catch (error) {
            if (retry === 49) throw error;
          }
        }
      } finally {
        if (ownsLock) await rm(lock, { recursive: true, force: true });
      }
    }

    return serviceRequest(input.action);
  }
  if (input.op === "cancel") {
    terminate(
      Number(await readFile(`${control}/${identifier(input.id)}`, "utf8")),
    );
    return { cancelled: true };
  }
  if (input.op === "execute") {
    const id = identifier(input.id),
      started = Date.now();
    const child = spawn("sh", ["-lc", input.command], {
      cwd: await safePath(input.cwd),
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: "/workspace",
        HTTP_PROXY: process.env.HTTP_PROXY,
        HTTPS_PROXY: process.env.HTTPS_PROXY,
        ...input.env,
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0),
      stderr = Buffer.alloc(0),
      bytes = 0;
    let timedOut = false,
      outputLimited = false;
    const limit = Math.min(input.maxOutputBytes ?? 1048576, 4194304);
    const capture = (target) => (chunk) => {
      const available = Math.max(0, limit - bytes);
      bytes += chunk.length;
      if (target === "stdout")
        stdout = Buffer.concat([stdout, chunk.subarray(0, available)]);
      else stderr = Buffer.concat([stderr, chunk.subarray(0, available)]);
      if (bytes > limit) {
        outputLimited = true;
        terminate(child.pid);
      }
    };
    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));
    const completion = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });
    if (!child.pid) return await completion;
    await writeFile(`${control}/${id}`, String(child.pid), { mode: 0o600 });
    const timer = setTimeout(
      () => {
        timedOut = true;
        terminate(child.pid);
      },
      Math.min(input.timeoutMs ?? 30000, 300000),
    );
    const stop = () => terminate(child.pid);
    process.once("SIGTERM", stop);
    try {
      const exitCode = await completion;
      return {
        exitCode,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        timedOut,
        outputLimited,
        durationMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
      process.removeListener("SIGTERM", stop);
      terminate(child.pid);
      await unlink(`${control}/${id}`).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["/opt/zlayer/filesystem.py"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 12 * 1048576) child.kill("SIGKILL");
    });
    child.once("error", reject);
    child.once("close", () => {
      try {
        const result = JSON.parse(output);
        if (result.error) reject(new Error(result.error));
        else resolve(result.result);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.on("error", reject);
    child.stdin.end(JSON.stringify(input));
  });
}
try {
  process.stdout.write(JSON.stringify({ result: await main() }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
