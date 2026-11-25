import https from "node:https";
import { lookup } from "node:dns";
import { randomUUID } from "node:crypto";
import ipaddr from "ipaddr.js";
import type { ToolRegistry } from "./index";

type Rpc = {
  jsonrpc: "2.0";
  id?: string;
  method: string;
  params?: Record<string, unknown>;
};
type RpcResult = {
  id?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};
export type McpTransport = ((
  message: Rpc,
  signal?: AbortSignal,
) => Promise<RpcResult>) & { close?(): Promise<void> };
export function httpMcpTransport(
  endpoint: string,
  approvedHosts: string[],
  authorization?: string,
): McpTransport {
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !approvedHosts.includes(url.hostname)
  )
    throw new Error("MCP_HOST_NOT_ALLOWED");
  let sessionId: string | undefined;
  const transport: McpTransport = async (message, signal) =>
    new Promise((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: message.method === "$close" ? "DELETE" : "POST",
          family: 4,
          signal,
          timeout: 30000,
          headers: {
            ...(authorization ? { authorization } : {}),
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-03-26",
            ...(sessionId ? { "mcp-session-id": sessionId } : {}),
          },
          lookup(hostname, _options, callback) {
            lookup(hostname, { family: 4 }, (error, address, family) => {
              if (
                error ||
                !ipaddr.isValid(address) ||
                ipaddr.parse(address).range() !== "unicast"
              )
                callback(new Error("MCP_PRIVATE_DESTINATION_BLOCKED"), "", 4);
              else callback(null, address, family);
            });
          },
        },
        (response) => {
          response.setEncoding("utf8");
          const received = response.headers["mcp-session-id"];
          if (typeof received === "string") sessionId = received;
          if (
            response.statusCode === 202 ||
            response.statusCode === 204 ||
            (message.method === "$close" && response.statusCode === 200)
          ) {
            response.resume();
            resolve({});
            return;
          }
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error("MCP_HTTP_FAILED"));
            return;
          }
          let body = "";
          response.on("data", (chunk: Buffer) => {
            body += chunk.toString();
            if (body.length > 2 * 1048576)
              response.destroy(new Error("MCP_RESPONSE_LIMIT"));
            if (
              String(response.headers["content-type"]).includes(
                "text/event-stream",
              )
            ) {
              while (body.includes("\n\n") || body.includes("\r\n\r\n")) {
                const boundary =
                  body.indexOf("\n\n") >= 0
                    ? body.indexOf("\n\n")
                    : body.indexOf("\r\n\r\n");
                const block = body.slice(0, boundary);
                body = body.slice(boundary + (body[boundary] === "\r" ? 4 : 2));
                const data = block
                  .split(/\r?\n/)
                  .filter((line) => line.startsWith("data:"))
                  .map((line) => line.slice(5))
                  .join("\n");
                if (data) {
                  try {
                    const result = JSON.parse(data) as RpcResult;
                    if (result.id === message.id) {
                      resolve(result);
                      response.destroy();
                      return;
                    }
                  } catch {
                    reject(new Error("INVALID_MCP_RESPONSE"));
                    response.destroy();
                    return;
                  }
                }
              }
            }
          });
          response.on("error", reject);
          response.on("end", () => {
            try {
              if (
                String(response.headers["content-type"]).includes(
                  "text/event-stream",
                )
              ) {
                const messages = body
                  .split(/\r?\n/)
                  .filter((line) => line.startsWith("data:"))
                  .map((line) => JSON.parse(line.slice(5)) as RpcResult);
                const result = messages.find(
                  (value) => value.id === message.id,
                );
                if (!result) throw new Error("MCP_RESPONSE_MISSING");
                resolve(result);
              } else resolve(JSON.parse(body));
            } catch {
              reject(new Error("INVALID_MCP_RESPONSE"));
            }
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("MCP_TIMEOUT")));
      request.on("error", reject);
      request.end(
        message.method === "$close" ? undefined : JSON.stringify(message),
      );
    });
  transport.close = async () => {
    if (sessionId)
      await transport(
        { jsonrpc: "2.0", method: "$close" },
        AbortSignal.timeout(10000),
      );
    sessionId = undefined;
  };
  return transport;
}
export class McpClient {
  private initialized = false;
  constructor(
    private readonly transport: McpTransport,
    private readonly redactions: string[] = [],
  ) {}
  async close() {
    await this.transport.close?.();
    this.initialized = false;
  }
  private async request(
    method: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ) {
    const id = randomUUID(),
      response = await this.transport(
        { jsonrpc: "2.0", id, method, params },
        signal,
      );
    if (response.id !== id || response.error || !response.result)
      throw new Error("MCP_REQUEST_FAILED");
    const redact = (value: unknown): unknown => {
      if (typeof value === "string")
        return this.redactions.reduce(
          (text, secret) =>
            secret ? text.replaceAll(secret, "[REDACTED]") : text,
          value,
        );
      if (Array.isArray(value)) return value.map(redact);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, redact(item)]),
        );
      return value;
    };
    return redact(response.result) as Record<string, unknown>;
  }
  async initialize(signal?: AbortSignal) {
    if (this.initialized) return;
    await this.request(
      "initialize",
      {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "zlayer", version: "1.0.0" },
      },
      signal,
    );
    await this.transport(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      signal,
    );
    this.initialized = true;
  }
  async list(signal?: AbortSignal) {
    await this.initialize(signal);
    const result = await this.request("tools/list", {}, signal);
    if (!Array.isArray(result.tools) || result.tools.length > 100)
      throw new Error("MCP_TOOL_LIMIT");
    return result.tools as {
      name: string;
      description?: string;
      inputSchema: Record<string, unknown>;
    }[];
  }
  async call(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    await this.initialize(signal);
    return this.request("tools/call", { name, arguments: args }, signal);
  }
  async register(registry: ToolRegistry, prefix: string, signal?: AbortSignal) {
    for (const tool of await this.list(signal))
      registry.register({
        name: `mcp_${prefix}_${tool.name}`
          .replace(/[^a-zA-Z0-9_-]/g, "_")
          .slice(0, 64),
        description: tool.description ?? tool.name,
        inputSchema: tool.inputSchema,
        version: "1",
        permission: "mcp.execute",
        risk: "execute",
        timeoutMs: 30000,
        validate: (input) => input as Record<string, unknown>,
        execute: (input, context) =>
          this.call(tool.name, input, context.signal),
      });
  }
}
