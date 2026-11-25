import https from "node:https";
import { lookup } from "node:dns";
import { Readable } from "node:stream";
import ipaddr from "ipaddr.js";
import {
  Client,
  StreamableHTTPClientTransport,
  type Transport,
  type JSONRPCMessage,
} from "@modelcontextprotocol/client";

export type McpTransport = ((
  message: JSONRPCMessage,
  signal?: AbortSignal,
) => Promise<unknown>) & { close?(): Promise<void> };

// Sandbox bridge only. Initialization, IDs and cancellation belong to the SDK.
function sandboxTransport(bridge: McpTransport): Transport {
  let closed = false;
  const transport: Transport = {
    async start() {},
    async send(message) {
      if (closed) throw new Error("MCP_DISCONNECTED");
      void bridge(message)
        .then((response) => {
          if (
            !closed &&
            response &&
            typeof response === "object" &&
            "jsonrpc" in response
          )
            transport.onmessage?.(response as JSONRPCMessage);
        })
        .catch((error: unknown) => {
          transport.onerror?.(
            error instanceof Error ? error : new Error("MCP_TRANSPORT_FAILED"),
          );
          void transport.close().catch(() => {});
        });
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await bridge.close?.();
      } finally {
        transport.onclose?.();
      }
    },
  };
  return transport;
}

export function httpMcpTransport(
  endpoint: string,
  approvedHosts: string[],
  authorization?: string,
): Transport {
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !approvedHosts.includes(url.hostname)
  )
    throw new Error("MCP_HOST_NOT_ALLOWED");
  return new StreamableHTTPClientTransport(url, {
    redirectPolicy: "same-origin",
    requestInit: { headers: authorization ? { authorization } : {} },
    // Preserve DNS pinning/SSRF controls; SDK handles HTTP protocol framing.
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (request.url !== url.href) throw new Error("MCP_HOST_NOT_ALLOWED");
      const body = request.body
        ? Buffer.from(await request.arrayBuffer())
        : undefined;
      return new Promise<Response>((resolve, reject) => {
        const outgoing = https.request(
          url,
          {
            method: request.method,
            headers: Object.fromEntries(request.headers),
            signal: request.signal,
            timeout: 30000,
            family: 4,
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
          (incoming) => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(incoming.headers))
              if (value !== undefined)
                headers.set(
                  key,
                  Array.isArray(value) ? value.join(", ") : value,
                );
            const status = incoming.statusCode ?? 502;
            if (status >= 300 && status < 400) {
              incoming.resume();
              reject(new Error("MCP_REDIRECT_BLOCKED"));
              return;
            }
            const noBody = [204, 205, 304].includes(status);
            let bytes = 0;
            const stream = Readable.toWeb(
              incoming,
            ) as unknown as ReadableStream<Uint8Array>;
            const bounded = stream.pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                  bytes += chunk.byteLength;
                  if (bytes > 2 * 1048576)
                    throw new Error("MCP_RESPONSE_LIMIT");
                  controller.enqueue(chunk);
                },
              }),
            );
            if (noBody) incoming.resume();
            resolve(new Response(noBody ? null : bounded, { status, headers }));
          },
        );
        outgoing.on("timeout", () =>
          outgoing.destroy(new Error("MCP_TIMEOUT")),
        );
        outgoing.on("error", reject);
        outgoing.end(body);
      });
    },
  });
}

export class McpConnection {
  private readonly client = new Client({ name: "zlayer", version: "1.0.0" });
  private readonly transport: Transport;
  private connecting?: Promise<void>;
  constructor(
    transport: Transport | McpTransport,
    private readonly redactions: string[] = [],
  ) {
    this.transport =
      typeof transport === "function" ? sandboxTransport(transport) : transport;
  }
  async initialize(signal?: AbortSignal) {
    signal?.throwIfAborted();
    this.connecting ??= this.client.connect(this.transport, {
      signal,
      timeout: 30000,
    });
    await this.connecting;
  }
  async close() {
    try {
      if (
        this.transport instanceof StreamableHTTPClientTransport &&
        this.transport.sessionId
      )
        await this.transport.terminateSession();
    } finally {
      await this.client.close();
    }
  }
  private redact<T>(value: T): T {
    const visit = (item: unknown): unknown => {
      if (typeof item === "string")
        return this.redactions.reduce(
          (text, secret) =>
            secret ? text.replaceAll(secret, "[REDACTED]") : text,
          item,
        );
      if (Array.isArray(item)) return item.map(visit);
      if (item && typeof item === "object")
        return Object.fromEntries(
          Object.entries(item).map(([key, entry]) => [key, visit(entry)]),
        );
      return item;
    };
    if (JSON.stringify(value).length > 2 * 1048576)
      throw new Error("MCP_RESPONSE_LIMIT");
    return visit(value) as T;
  }
  async list(signal?: AbortSignal) {
    await this.initialize(signal);
    const result = await this.client.listTools({}, { signal, timeout: 30000 });
    if (result.tools.length > 100) throw new Error("MCP_TOOL_LIMIT");
    return this.redact(result.tools);
  }
  async call(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    await this.initialize(signal);
    return this.redact(
      await this.client.callTool(
        { name, arguments: args },
        { signal, timeout: 30000 },
      ),
    );
  }
}
