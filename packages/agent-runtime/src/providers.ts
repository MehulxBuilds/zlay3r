import { setTimeout as delay } from "node:timers/promises";
import { span } from "@repo/observability";

export type ProviderName = "anthropic" | "openai" | "deepseek" | "openrouter";
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ModelMessage {
  stopReason?: "stop" | "tools" | "limit" | "continue";
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  native?: unknown;
  reasoning?: string;
}
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  signal?: AbortSignal;
  onText?: (text: string) => Promise<void>;
}
export interface ModelResult {
  message: ModelMessage;
  inputTokens: number;
  outputTokens: number;
  usageKnown: boolean;
  provider: ProviderName;
  model: string;
}
export interface ModelProvider {
  readonly name: ProviderName;
  readonly capabilities: {
    streaming: boolean;
    tools: boolean;
    cancellation: boolean;
  };
  generate(request: ModelRequest): Promise<ModelResult>;
}
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(`PROVIDER_${provider.toUpperCase()}_${status}`);
  }
}
type Json = Record<string, any>;
function tokens(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 1000000000
  )
    throw new Error("INVALID_PROVIDER_USAGE");
  return value;
}
async function* events(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<Json> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    received = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      received += value?.byteLength ?? 0;
      if (received > 16 * 1048576) throw new Error("MODEL_STREAM_LIMIT");
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      if (buffer.length > 8 * 1048576) throw new Error("MODEL_STREAM_LIMIT");
      while (buffer.includes("\n\n")) {
        const end = buffer.indexOf("\n\n");
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") yield JSON.parse(data);
      }
      if (done) break;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

class CompatibleProvider implements ModelProvider {
  readonly capabilities = { streaming: true, tools: true, cancellation: true };
  constructor(
    readonly name: ProviderName,
    private key: string,
    private endpoint: string,
    private routing?: Record<string, unknown>,
  ) {}
  async generate(request: ModelRequest): Promise<ModelResult> {
    const response = await fetch(
      `${this.endpoint.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        signal: request.signal,
        headers: {
          authorization: `Bearer ${this.key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          stream_options: { include_usage: true },
          ...(this.name === "openai"
            ? { max_completion_tokens: request.maxTokens }
            : { max_tokens: request.maxTokens }),
          ...(this.name === "openrouter" && this.routing
            ? { provider: this.routing }
            : {}),
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
            ...(message.reasoning && this.name === "deepseek"
              ? { reasoning_content: message.reasoning }
              : {}),
            ...(message.toolCalls?.length
              ? {
                  tool_calls: message.toolCalls.map((call) => ({
                    id: call.id,
                    type: "function",
                    function: { name: call.name, arguments: call.arguments },
                  })),
                }
              : {}),
          })),
          ...(request.tools.length
            ? {
                tools: request.tools.map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  },
                })),
              }
            : {}),
        }),
      },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new ProviderError(
        this.name,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }
    let content = "",
      reasoning = "",
      inputTokens = 0,
      outputTokens = 0,
      usageKnown = false;
    let finishReason = "";
    const calls = new Map<number, ToolCall>();
    for await (const chunk of events(response.body, request.signal)) {
      if (chunk.error)
        throw new ProviderError(
          this.name,
          Number(chunk.error.code) || 502,
          false,
        );
      if (chunk.usage) {
        inputTokens = tokens(chunk.usage.prompt_tokens);
        outputTokens = tokens(chunk.usage.completion_tokens);
        usageKnown = true;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (chunk.choices?.[0]?.finish_reason)
        finishReason = chunk.choices[0].finish_reason;
      if (delta?.content) {
        content += delta.content;
        await request.onText?.(delta.content);
      }
      if (delta?.reasoning_content) reasoning += delta.reasoning_content;
      for (const part of delta?.tool_calls ?? []) {
        const current = calls.get(part.index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        current.id += part.id ?? "";
        current.name += part.function?.name ?? "";
        current.arguments += part.function?.arguments ?? "";
        calls.set(part.index, current);
      }
      if (
        content.length +
          reasoning.length +
          [...calls.values()].reduce(
            (sum, call) => sum + call.arguments.length,
            0,
          ) >
        4 * 1048576
      )
        throw new Error("MODEL_OUTPUT_LIMIT");
    }
    if (!["stop", "tool_calls", "length"].includes(finishReason))
      throw new ProviderError(this.name, 502, false);
    return {
      message: {
        stopReason:
          finishReason === "length"
            ? "limit"
            : finishReason === "tool_calls"
              ? "tools"
              : "stop",
        role: "assistant",
        content: content || null,
        reasoning,
        toolCalls: [...calls.values()],
      },
      inputTokens,
      outputTokens,
      usageKnown,
      provider: this.name,
      model: request.model,
    };
  }
}
export class OpenAIProvider extends CompatibleProvider {
  constructor(key: string, endpoint = "https://api.openai.com/v1") {
    super("openai", key, endpoint);
  }
}
export class DeepSeekProvider extends CompatibleProvider {
  constructor(key: string) {
    super("deepseek", key, "https://api.deepseek.com");
  }
}
export class OpenRouterProvider extends CompatibleProvider {
  constructor(key: string, routing?: Record<string, unknown>) {
    super(
      "openrouter",
      key,
      "https://openrouter.ai/api/v1",
      routing ?? { allow_fallbacks: false },
    );
  }
}
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic" as const;
  readonly capabilities = { streaming: true, tools: true, cancellation: true };
  constructor(private key: string) {}
  async generate(request: ModelRequest): Promise<ModelResult> {
    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "tool" ? "user" : message.role,
        content:
          message.role === "tool"
            ? [
                {
                  type: "tool_result",
                  tool_use_id: message.toolCallId,
                  content: message.content ?? "",
                },
              ]
            : (message.native ??
              (message.role === "assistant" && message.toolCalls?.length
                ? [
                    ...(message.content
                      ? [{ type: "text", text: message.content }]
                      : []),
                    ...message.toolCalls.map((call) => ({
                      type: "tool_use",
                      id: call.id,
                      name: call.name,
                      input: JSON.parse(call.arguments),
                    })),
                  ]
                : (message.content ?? ""))),
      }));
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: request.signal,
      headers: {
        "x-api-key": this.key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        stream: true,
        system: request.messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n"),
        messages,
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
      }),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new ProviderError(
        this.name,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }
    const blocks: Json[] = [],
      argumentsByIndex = new Map<number, string>();
    let inputTokens = 0,
      outputTokens = 0,
      usageKnown = false;
    let finished = false,
      finishReason = "";
    for await (const chunk of events(response.body, request.signal)) {
      if (chunk.type === "error")
        throw new ProviderError(this.name, 502, false);
      if (chunk.type === "message_start") {
        inputTokens =
          tokens(chunk.message.usage.input_tokens) +
          tokens(chunk.message.usage.cache_creation_input_tokens ?? 0) +
          tokens(chunk.message.usage.cache_read_input_tokens ?? 0);
        usageKnown = true;
      }
      if (chunk.type === "message_delta") {
        outputTokens = tokens(chunk.usage?.output_tokens ?? outputTokens);
        finishReason = chunk.delta?.stop_reason ?? finishReason;
      }
      if (chunk.type === "message_stop") finished = true;
      if (chunk.type === "content_block_start")
        blocks[chunk.index] = chunk.content_block;
      if (chunk.type === "content_block_delta") {
        const block = blocks[chunk.index];
        if (!block) continue;
        if (chunk.delta.type === "text_delta") {
          block.text = (block.text ?? "") + chunk.delta.text;
          await request.onText?.(chunk.delta.text);
        }
        if (chunk.delta.type === "input_json_delta")
          argumentsByIndex.set(
            chunk.index,
            (argumentsByIndex.get(chunk.index) ?? "") +
              chunk.delta.partial_json,
          );
        if (chunk.delta.type === "thinking_delta")
          block.thinking = (block.thinking ?? "") + chunk.delta.thinking;
        if (chunk.delta.type === "signature_delta")
          block.signature = (block.signature ?? "") + chunk.delta.signature;
      }
    }
    if (!finished || !finishReason)
      throw new ProviderError(this.name, 502, false);
    for (const [index, value] of argumentsByIndex) {
      try {
        blocks[index]!.input = JSON.parse(value);
      } catch (error) {
        if (finishReason !== "max_tokens") throw error;
      }
    }
    return {
      message: {
        stopReason:
          finishReason === "max_tokens"
            ? "limit"
            : finishReason === "tool_use"
              ? "tools"
              : finishReason === "pause_turn"
                ? "continue"
                : "stop",
        role: "assistant",
        content: blocks
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join(""),
        native: blocks,
        toolCalls: blocks
          .filter((block) => block.type === "tool_use")
          .map((block) => ({
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          })),
      },
      inputTokens,
      outputTokens,
      usageKnown,
      provider: this.name,
      model: request.model,
    };
  }
}

export class ModelRouter {
  constructor(
    private readonly resolve: (name: ProviderName) => Promise<{
      provider: ModelProvider;
      model: string;
      aliases?: Record<string, string>;
    }>,
    private readonly fallbacks: ProviderName[] = [],
  ) {}
  async generate(
    name: ProviderName,
    request: Omit<ModelRequest, "model"> & { model?: string },
  ): Promise<ModelResult> {
    let lastError: unknown;
    for (const candidate of [
      name,
      ...this.fallbacks.filter((value) => value !== name),
    ]) {
      const resolved = await this.resolve(candidate);
      for (let attempt = 0; attempt < 3; attempt++) {
        let emitted = false;
        try {
          return await span(
            "model.request",
            {
              "model.provider": candidate,
              "model.name": request.model ?? resolved.model,
            },
            () =>
              resolved.provider.generate({
                ...request,
                model:
                  candidate === name && request.model
                    ? (resolved.aliases?.[request.model] ?? request.model)
                    : resolved.model,
                signal: AbortSignal.any([
                  ...(request.signal ? [request.signal] : []),
                  AbortSignal.timeout(60000),
                ]),
                onText: async (text) => {
                  emitted = true;
                  await request.onText?.(text);
                },
              }),
          );
        } catch (error) {
          request.signal?.throwIfAborted();
          const transient =
            error instanceof TypeError ||
            (error instanceof DOMException && error.name === "TimeoutError");
          const normalized = transient
            ? new ProviderError(candidate, 503, true)
            : error;
          lastError = normalized;
          if (
            emitted ||
            !(normalized instanceof ProviderError) ||
            !normalized.retryable
          )
            throw normalized;
          if (attempt < 2)
            await delay(500 * 2 ** attempt, undefined, {
              signal: request.signal,
            });
        }
      }
    }
    throw lastError ?? new Error("PROVIDER_NOT_CONFIGURED");
  }
}
