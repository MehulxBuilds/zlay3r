import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";

export type AgentRequestHandler = (
  method: string,
  params: unknown,
) => Promise<unknown>;

export class AgentRemoteError extends Error {}

/** Private supervisor channel; never exposed as a network or public RPC API. */
export function agentChannel(
  input: Readable,
  output: Writable,
  handler: AgentRequestHandler,
) {
  const pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  const inbound = new Set<string>();
  const prefix = randomUUID();
  let sequence = 0,
    buffer = "",
    received = 0,
    sent = 0,
    active = 0,
    stopped = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const maxFrame = 8 * 1048576;
  const close = (error = new Error("AGENT_CHANNEL_CLOSED")) => {
    if (stopped) return;
    stopped = true;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    resolveClosed();
  };
  const write = (value: unknown) => {
    if (stopped) throw new Error("AGENT_CHANNEL_CLOSED");
    const frame = JSON.stringify(value) + "\n";
    const bytes = Buffer.byteLength(frame);
    sent += bytes;
    if (
      bytes > maxFrame ||
      sent > 256 * 1048576 ||
      output.writableLength > 16 * 1048576
    )
      throw new Error("AGENT_CHANNEL_LIMIT");
    output.write(frame);
  };
  const consume = (line: string) => {
    const message: unknown = JSON.parse(line);
    if (
      !message ||
      typeof message !== "object" ||
      !("kind" in message) ||
      !("id" in message) ||
      typeof message.id !== "string" ||
      message.id.length > 100
    )
      throw new Error("AGENT_CHANNEL_INVALID");
    if (message.kind === "response") {
      const entry = pending.get(message.id);
      if (!entry) throw new Error("AGENT_CHANNEL_INVALID");
      pending.delete(message.id);
      if ("error" in message)
        entry.reject(
          new AgentRemoteError(
            typeof message.error === "string" &&
              /^[A-Z0-9_]{1,100}$/.test(message.error)
              ? message.error
              : "AGENT_REQUEST_FAILED",
          ),
        );
      else entry.resolve("result" in message ? message.result : undefined);
      return;
    }
    if (
      message.kind !== "request" ||
      !("method" in message) ||
      typeof message.method !== "string" ||
      message.method.length > 50 ||
      !("params" in message) ||
      inbound.has(message.id) ||
      active >= 4 ||
      inbound.size >= 4096
    )
      throw new Error("AGENT_CHANNEL_INVALID");
    inbound.add(message.id);
    active++;
    void handler(message.method, message.params)
      .then(
        (result) => write({ kind: "response", id: message.id, result }),
        (error: unknown) =>
          write({
            kind: "response",
            id: message.id,
            error:
              error instanceof Error && /^[A-Z0-9_]{1,100}$/.test(error.message)
                ? error.message
                : "AGENT_REQUEST_FAILED",
          }),
      )
      .catch((error: unknown) =>
        close(error instanceof Error ? error : undefined),
      )
      .finally(() => {
        active--;
      });
  };
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    if (stopped) return;
    try {
      received += Buffer.byteLength(chunk);
      if (received > 256 * 1048576) throw new Error("AGENT_CHANNEL_LIMIT");
      buffer += chunk;
      let end = buffer.indexOf("\n");
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (Buffer.byteLength(line) > maxFrame)
          throw new Error("AGENT_CHANNEL_LIMIT");
        consume(line);
        end = buffer.indexOf("\n");
      }
      if (Buffer.byteLength(buffer) > maxFrame)
        throw new Error("AGENT_CHANNEL_LIMIT");
    } catch (error) {
      close(error instanceof Error ? error : undefined);
    }
  });
  input.once("end", () => close());
  input.once("close", () => close());
  input.once("error", (error) => close(error));
  output.once("error", (error) => close(error));
  return {
    closed,
    close,
    request(method: string, params: unknown): Promise<unknown> {
      return new Promise((resolve, reject) => {
        if (pending.size >= 4) return reject(new Error("AGENT_CHANNEL_LIMIT"));
        const id = `${prefix}:${++sequence}`;
        pending.set(id, { resolve, reject });
        try {
          write({ kind: "request", id, method, params });
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
  };
}
