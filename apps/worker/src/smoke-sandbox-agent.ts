import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { server_env as env } from "@repo/env";
import { DockerSandboxProvider } from "@repo/sandbox";
import { ToolRegistry, type ModelGateway } from "@repo/agent-runtime/core";
import { runSandboxAgent } from "./agent-supervisor";
import type { AgentLaunch } from "@repo/agent-runner/contracts";

// Explicit opt-in Docker check. No DB, queues, provider API or user resources.
env.SANDBOX_IMAGE = "zlayer-sandbox:agent-runner";
const provider = new DockerSandboxProvider();
const { resourceId } = await provider.create({
  name: `agent-smoke-${randomUUID().slice(0, 8)}`,
  memoryMb: 512,
  cpu: 1,
});
try {
  const registry = new ToolRegistry().register({
    name: "execute_command",
    description: "Smoke command",
    version: "1",
    permission: "sandbox.execute",
    risk: "execute",
    timeoutMs: 5000,
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false,
    },
    validate: (input) => input as Record<string, unknown>,
    execute: (input, context) =>
      provider.execute(context.sandboxId, input.command as string, {
        signal: context.signal,
        timeoutMs: 3000,
      }),
  });
  const command = `id -u; python3 -c "import os; print(any(b'/opt/zlayer/agent-runner.mjs' in open('/proc/'+p+'/cmdline','rb').read().split(bytes([0])) for p in os.listdir('/proc') if p.isdigit()))"; printf sandbox-agent-ok > /workspace/agent-smoke.txt; cat /workspace/agent-smoke.txt`;
  let requests = 0;
  const model: ModelGateway = {
    async generate(_name, request) {
      requests++;
      if (requests === 2) {
        const tool = JSON.parse(request.messages.at(-1)!.content!);
        assert.equal(tool.exitCode, 0);
        assert.equal(tool.stdout, "1000\nTrue\nsandbox-agent-ok");
      }
      return {
        provider: "openai",
        model: "mock",
        inputTokens: 1,
        outputTokens: 1,
        usageKnown: true,
        message:
          requests === 1
            ? {
                role: "assistant",
                content: null,
                toolCalls: [
                  {
                    id: "smoke-call",
                    name: "execute_command",
                    arguments: JSON.stringify({ command }),
                  },
                ],
              }
            : { role: "assistant", content: "verified", stopReason: "stop" },
      };
    },
  };
  const launch: AgentLaunch = {
    tools: registry.metadata(),
    input: {
      sandboxId: resourceId,
      task: "Verify the sandbox runner",
      provider: "openai",
      maxTokens: 100,
      maxToolCalls: 2,
      deadlineMs: 30000,
    },
  };
  const checkpoints: {
    messages: AgentLaunch["input"]["messages"];
    usage: NonNullable<AgentLaunch["input"]["previousUsage"]>;
  }[] = [];
  const options = {
    provider,
    resourceId,
    launch,
    registry,
    model,
    signal: AbortSignal.timeout(45000),
    async assertActive() {},
    async authorize() {},
    async emit() {},
    async checkpoint(
      messages: AgentLaunch["input"]["messages"],
      usage: NonNullable<AgentLaunch["input"]["previousUsage"]>,
    ) {
      checkpoints.push({ messages, usage });
    },
  };
  const result = await runSandboxAgent(options);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.finalAnswer, "verified");
  assert.equal(result.toolCallsExecuted, 1);
  assert.equal(
    ((await provider.inspect(resourceId)) as { running: boolean }).running,
    true,
  );
  const file = await provider.file<{ data: string }>(resourceId, {
    op: "read",
    path: "agent-smoke.txt",
  });
  assert.equal(Buffer.from(file.data, "base64").toString(), "sandbox-agent-ok");
  // A clean approval suspension must not stop the sandbox; resume uses its checkpoint.
  requests = 0;
  await assert.rejects(
    runSandboxAgent({
      ...options,
      async authorize() {
        throw new Error("APPROVAL_REQUIRED");
      },
    }),
    /APPROVAL_REQUIRED/,
  );
  assert.equal(
    ((await provider.inspect(resourceId)) as { running: boolean }).running,
    true,
  );
  const saved = checkpoints.at(-1)!;
  const resumed = await runSandboxAgent({
    ...options,
    launch: {
      ...launch,
      input: {
        ...launch.input,
        messages: saved.messages,
        previousUsage: saved.usage,
      },
    },
  });
  assert.equal(resumed.status, "COMPLETED");
  const cancellation = new AbortController();
  await assert.rejects(
    runSandboxAgent({
      ...options,
      signal: cancellation.signal,
      model: {
        async generate() {
          cancellation.abort(new Error("RUN_CANCELLED"));
          throw new Error("RUN_CANCELLED");
        },
      },
    }),
    /RUN_CANCELLED/,
  );
  assert.equal(
    ((await provider.inspect(resourceId)) as { running: boolean }).running,
    false,
  );
  console.log(
    "Docker agent smoke passed: non-root runner, network disabled, real shell/file operation, host model broker, approval/resume, and cleanup.",
  );
} finally {
  await provider.destroy(resourceId);
}
