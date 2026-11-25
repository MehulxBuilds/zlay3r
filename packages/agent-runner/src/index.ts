import { agentChannel } from "@repo/shared/agent-channel";
import {
  AgentRuntime,
  ToolRegistry,
  type ModelGateway,
} from "@repo/agent-runtime/core";
import type { ModelResult } from "@repo/agent-runtime";
import { launchSchema } from "./contracts";

const controller = new AbortController();
let started = false;
const channel = agentChannel(
  process.stdin,
  process.stdout,
  async (method, params) => {
    if (method !== "run" || started)
      throw new Error("AGENT_REQUEST_NOT_ALLOWED");
    started = true;
    const launch = launchSchema.parse(params);
    const registry = new ToolRegistry();
    for (const tool of launch.tools)
      registry.register({
        ...tool,
        validate: (input) => input as Record<string, unknown>,
        execute: (input, context) =>
          channel.request("tool.invoke", {
            name: tool.name,
            input,
            callId: context.toolCallId,
          }),
      });
    const gateway: ModelGateway = {
      async generate(_name, request) {
        request.signal?.throwIfAborted();
        return (await channel.request("model.generate", {
          messages: request.messages,
          maxTokens: request.maxTokens,
        })) as ModelResult;
      },
    };
    const runtime = new AgentRuntime(
      {
        async execute() {
          throw new Error("BROKER_REQUIRED");
        },
      },
      gateway,
      registry,
    );
    return runtime.run({
      ...launch.input,
      signal: controller.signal,
      // Authorization and authoritative events are emitted by the host broker.
      authorize: async () => {},
      checkpoint: (messages) =>
        channel.request("checkpoint", { messages }).then(() => {}),
    });
  },
);
void channel.closed.then(() =>
  controller.abort(new Error("AGENT_CHANNEL_CLOSED")),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    controller.abort(new Error("RUN_CANCELLED"));
    channel.close();
  });
await channel.closed;
