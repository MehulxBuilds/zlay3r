import type { SandboxProvider } from "@repo/sandbox";
import { isDeepStrictEqual } from "node:util";
import type {
  ModelGateway,
  Tool,
  ToolRegistry,
} from "@repo/agent-runtime/core";
import {
  checkpointSchema,
  launchSchema,
  modelCallSchema,
  resultSchema,
  toolCallSchema,
  type AgentLaunch,
} from "@repo/agent-runner/contracts";

export async function runSandboxAgent(options: {
  provider: Pick<SandboxProvider, "runAgent">;
  resourceId: string;
  launch: AgentLaunch;
  registry: ToolRegistry;
  model: ModelGateway;
  signal: AbortSignal;
  assertActive(): Promise<void>;
  authorize(tool: Tool, input: Record<string, unknown>): Promise<void>;
  emit(type: string, payload: unknown): Promise<void>;
  checkpoint(
    messages: AgentLaunch["input"]["messages"],
    usage: NonNullable<AgentLaunch["input"]["previousUsage"]>,
  ): Promise<void>;
}) {
  const launch = launchSchema.parse(options.launch);
  const lifecycle = new AbortController();
  const signal = AbortSignal.any([
    lifecycle.signal,
    options.signal,
    AbortSignal.timeout(launch.input.deadlineMs),
  ]);
  const usage = {
    iterations: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCallsExecuted: 0,
    ...launch.input.previousUsage,
  };
  const seen = new Set<string>();
  let lastMessages = launch.input.messages;
  let finalAnswer =
    lastMessages?.at(-1)?.role === "assistant" &&
    !lastMessages.at(-1)?.toolCalls?.length &&
    !["limit", "continue"].includes(lastMessages.at(-1)?.stopReason ?? "")
      ? (lastMessages.at(-1)?.content ?? "")
      : undefined;
  const permittedCalls = new Map<string, { name: string; arguments: string }>();
  const assistant = [...(lastMessages ?? [])]
    .reverse()
    .find((entry) => entry.role === "assistant");
  for (const call of assistant?.toolCalls ?? [])
    if (
      !lastMessages?.some(
        (entry) => entry.role === "tool" && entry.toolCallId === call.id,
      )
    )
      permittedCalls.set(call.id, call);
  let busy = false;
  const same = (left: unknown, right: unknown) =>
    isDeepStrictEqual(
      JSON.parse(JSON.stringify(left)),
      JSON.parse(JSON.stringify(right)),
    );
  const toolOutcome = async (callId: string, value: unknown) => {
    lastMessages = [
      ...(lastMessages ?? []),
      {
        role: "tool",
        toolCallId: callId,
        content: JSON.stringify(value ?? null).slice(0, 32000),
      },
    ];
    await options.checkpoint(lastMessages, { ...usage });
  };
  // Runner counters, tool definitions, provider selection and identity are never
  // authoritative. They cannot broaden this run's host-owned capabilities.
  try {
    const result = await options.provider.runAgent<unknown>(
      options.resourceId,
      launch,
      async (method, params) => {
        if (busy) throw new Error("AGENT_REQUEST_CONCURRENT");
        busy = true;
        try {
          signal.throwIfAborted();
          await options.assertActive();
          if (method === "model.generate") {
            const input = modelCallSchema.parse(params);
            if (lastMessages && !same(input.messages, lastMessages))
              throw new Error("AGENT_HISTORY_INVALID");
            const remaining =
              launch.input.maxTokens - usage.inputTokens - usage.outputTokens;
            if (
              usage.iterations >= (launch.input.maxIterations ?? 8) ||
              remaining <= 0
            )
              throw new Error("EXECUTION_BUDGET_REACHED");
            usage.iterations++;
            await options.emit("model.requested", {
              iteration: usage.iterations,
              provider: launch.input.provider,
            });
            const response = await options.model.generate(
              launch.input.provider,
              {
                model: launch.input.model,
                messages: input.messages,
                tools: options.registry.list(),
                maxTokens: Math.min(input.maxTokens, remaining),
                signal,
                onText: (text) => options.emit("model.delta", { text }),
              },
            );
            usage.inputTokens += response.inputTokens;
            usage.outputTokens += response.outputTokens;
            permittedCalls.clear();
            for (const call of response.message.toolCalls ?? [])
              permittedCalls.set(call.id, call);
            finalAnswer =
              !response.message.toolCalls?.length &&
              !["limit", "continue"].includes(response.message.stopReason ?? "")
                ? (response.message.content ?? "")
                : undefined;
            lastMessages = [...input.messages, response.message];
            await options.emit("model.response", {
              provider: response.provider,
              model: response.model,
              inputTokens: response.inputTokens,
              outputTokens: response.outputTokens,
              usageKnown: response.usageKnown,
            });
            await options.checkpoint(lastMessages, { ...usage });
            return response;
          }
          if (method === "tool.invoke") {
            const input = toolCallSchema.parse(params);
            const declared = permittedCalls.get(input.callId);
            if (
              !declared ||
              declared.name !== input.name ||
              !isDeepStrictEqual(JSON.parse(declared.arguments), input.input)
            )
              throw new Error("TOOL_CALL_NOT_ISSUED");
            if (seen.has(input.callId)) throw new Error("DUPLICATE_TOOL_CALL");
            if (
              usage.toolCallsExecuted >= launch.input.maxToolCalls ||
              usage.inputTokens + usage.outputTokens >= launch.input.maxTokens
            )
              throw new Error("EXECUTION_BUDGET_REACHED");
            seen.add(input.callId);
            permittedCalls.delete(input.callId);
            usage.toolCallsExecuted++;
            await options.checkpoint(lastMessages, { ...usage });
            await options.emit("tool.requested", {
              id: input.callId,
              name: input.name,
              input: JSON.stringify(input.input),
            });
            try {
              const value = await options.registry.invoke(
                input.name,
                input.input,
                {
                  sandboxId: options.resourceId,
                  signal,
                  toolCallId: input.callId,
                },
                async (tool, args) => {
                  await options.authorize(tool, args);
                  await options.emit("tool.started", {
                    id: input.callId,
                    name: input.name,
                  });
                },
              );
              await options.emit("tool.completed", {
                id: input.callId,
                name: input.name,
                result: value,
              });
              await toolOutcome(input.callId, value);
              return value;
            } catch (error) {
              if (
                error instanceof Error &&
                error.message === "APPROVAL_REQUIRED"
              )
                throw error;
              await options.emit("tool.failed", {
                id: input.callId,
                name: input.name,
                error: {
                  error: error instanceof Error ? error.message : "TOOL_FAILED",
                },
              });
              const reason =
                error instanceof Error &&
                /^[A-Z0-9_]{1,100}$/.test(error.message)
                  ? error.message
                  : "AGENT_REQUEST_FAILED";
              await toolOutcome(input.callId, { error: reason });
              throw error;
            }
          }
          if (method === "checkpoint") {
            const input = checkpointSchema.parse(params);
            const known = lastMessages ?? [];
            if (!same(input.messages.slice(0, known.length), known))
              throw new Error("AGENT_CHECKPOINT_INVALID");
            // The runner may reject malformed model calls locally. It can only
            // append bounded failure receipts for calls the host actually issued.
            for (const entry of input.messages.slice(known.length)) {
              const declared = entry.toolCallId
                ? permittedCalls.get(entry.toolCallId)
                : undefined;
              const failure: unknown = JSON.parse(entry.content ?? "null");
              if (
                entry.role !== "tool" ||
                !declared ||
                !failure ||
                typeof failure !== "object" ||
                Object.keys(failure).length !== 1 ||
                !("error" in failure) ||
                typeof failure.error !== "string" ||
                !/^[A-Z0-9_]{1,100}$/.test(failure.error)
              )
                throw new Error("AGENT_CHECKPOINT_INVALID");
              if (usage.toolCallsExecuted >= launch.input.maxToolCalls)
                throw new Error("EXECUTION_BUDGET_REACHED");
              usage.toolCallsExecuted++;
              permittedCalls.delete(entry.toolCallId!);
              await options.emit("tool.failed", {
                id: entry.toolCallId,
                name: declared.name,
                error: failure,
              });
            }
            lastMessages = input.messages;
            await options.checkpoint(input.messages, { ...usage });
            return { saved: true };
          }
          throw new Error("AGENT_REQUEST_NOT_ALLOWED");
        } finally {
          busy = false;
        }
      },
      { signal, timeoutMs: launch.input.deadlineMs },
    );
    signal.throwIfAborted();
    await options.assertActive();
    const parsed = resultSchema.parse(result);
    if (parsed.status === "COMPLETED" && parsed.finalAnswer !== finalAnswer)
      throw new Error("AGENT_RESULT_NOT_VERIFIED");
    return { ...parsed, ...usage };
  } finally {
    lifecycle.abort(new Error("AGENT_STOPPED"));
  }
}
