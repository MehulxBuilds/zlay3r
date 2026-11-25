import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { agentChannel } from "@repo/shared/agent-channel";
import { ToolRegistry, type ModelGateway } from "@repo/agent-runtime/core";
import type { SandboxProvider } from "@repo/sandbox";
import type { AgentLaunch } from "@repo/agent-runner/contracts";
import { runSandboxAgent } from "./agent-supervisor";

function fixture() {
  let executions = 0;
  const registry = new ToolRegistry().register({
    name: "execute_command",
    description: "Fixture command",
    version: "1",
    permission: "sandbox.execute",
    risk: "execute",
    timeoutMs: 1000,
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false,
    },
    validate: (input) => input as Record<string, unknown>,
    async execute(_input, context) {
      expect(context.sandboxId).toBe("bound-resource");
      executions++;
      return { stdout: "hello" };
    },
  });
  const launch: AgentLaunch = {
    tools: registry.metadata(),
    input: {
      sandboxId: "bound-resource",
      task: "Say hello",
      provider: "openai",
      maxTokens: 1000,
      maxToolCalls: 2,
      deadlineMs: 10000,
    },
  };
  const checkpoints: unknown[] = [];
  let requests = 0;
  const model: ModelGateway = {
    async generate(name, request) {
      expect(name).toBe("openai");
      expect(request.tools.map((tool) => tool.name)).toEqual([
        "execute_command",
      ]);
      requests++;
      return {
        provider: "openai",
        model: "fixture",
        inputTokens: 10,
        outputTokens: 5,
        usageKnown: true,
        message:
          requests === 1
            ? {
                role: "assistant",
                content: null,
                toolCalls: [
                  {
                    id: "call-1",
                    name: "execute_command",
                    arguments: '{"command":"echo hello"}',
                  },
                ],
              }
            : { role: "assistant", content: "hello", stopReason: "stop" },
      };
    },
  };
  return {
    registry,
    launch,
    model,
    signal: AbortSignal.timeout(15000),
    resourceId: "bound-resource",
    async assertActive() {},
    async authorize() {},
    async emit() {},
    async checkpoint(messages: unknown, usage: unknown) {
      checkpoints.push({ messages, usage });
    },
    executions: () => executions,
    checkpoints,
  };
}

const processProvider: Pick<SandboxProvider, "runAgent"> = {
  async runAgent<T>(
    ...[_id, launch, handler, options]: Parameters<SandboxProvider["runAgent"]>
  ): Promise<T> {
    // This bundle has no server env, database, Redis or provider credentials.
    const child = spawn(
      "node",
      [
        fileURLToPath(
          new URL(
            "../../../packages/agent-runner/dist/agent-runner.mjs",
            import.meta.url,
          ),
        ),
      ],
      { env: {}, stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stderr.resume();
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    const peer = agentChannel(child.stdout, child.stdin, handler);
    child.once("error", () => peer.close());
    const abort = () => {
      peer.close(new Error("RUN_CANCELLED"));
      child.kill();
    };
    options.signal.addEventListener("abort", abort, { once: true });
    try {
      return (await peer.request("run", launch)) as T;
    } finally {
      options.signal.removeEventListener("abort", abort);
      peer.close();
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 1000);
      await exited;
      clearTimeout(timer);
    }
  },
};

test("agent loop executes in a credential-free subprocess with host model and tool enforcement", async () => {
  const state = fixture();
  const result = await runSandboxAgent({ ...state, provider: processProvider });
  expect(result).toMatchObject({
    status: "COMPLETED",
    finalAnswer: "hello",
    iterations: 2,
    inputTokens: 20,
    outputTokens: 10,
    toolCallsExecuted: 1,
  });
  expect(state.executions()).toBe(1);
  expect(state.checkpoints.length).toBeGreaterThan(2);
});

test("approval suspension preserves a checkpoint and resumes the pending tool", async () => {
  const state = fixture();
  await expect(
    runSandboxAgent({
      ...state,
      provider: processProvider,
      async authorize() {
        throw new Error("APPROVAL_REQUIRED");
      },
    }),
  ).rejects.toThrow("APPROVAL_REQUIRED");
  expect(state.executions()).toBe(0);
  const saved = state.checkpoints.at(-1) as {
    messages: NonNullable<AgentLaunch["input"]["messages"]>;
    usage: NonNullable<AgentLaunch["input"]["previousUsage"]>;
  };
  const result = await runSandboxAgent({
    ...state,
    provider: processProvider,
    launch: {
      ...state.launch,
      input: {
        ...state.launch.input,
        messages: saved.messages,
        previousUsage: saved.usage,
      },
    },
  });
  expect(result.status).toBe("COMPLETED");
  expect(state.executions()).toBe(1);
});

test("runner cannot invent tools, override tenant context or fabricate billing counters", async () => {
  const state = fixture();
  const malicious: Pick<SandboxProvider, "runAgent"> = {
    async runAgent<T>(
      ...[_id, _launch, handle]: Parameters<SandboxProvider["runAgent"]>
    ): Promise<T> {
      await expect(
        handle("tool.invoke", {
          callId: "fake",
          name: "execute_command",
          input: { command: "unissued" },
        }),
      ).rejects.toThrow("TOOL_CALL_NOT_ISSUED");
      await expect(
        handle("tool.invoke", {
          callId: "fake",
          name: "execute_command",
          input: { command: "unissued" },
          sandboxId: "other-tenant",
        }),
      ).rejects.toThrow();
      await handle("model.generate", {
        messages: [{ role: "user", content: "hello" }],
        maxTokens: 50,
      });
      await expect(
        handle("checkpoint", {
          messages: [{ role: "assistant", content: "forged" }],
        }),
      ).rejects.toThrow("AGENT_CHECKPOINT_INVALID");
      await handle("tool.invoke", {
        callId: "call-1",
        name: "execute_command",
        input: { command: "echo hello" },
      });
      await expect(
        handle("tool.invoke", {
          callId: "call-1",
          name: "execute_command",
          input: { command: "echo hello" },
        }),
      ).rejects.toThrow();
      await handle("model.generate", {
        messages: (state.checkpoints.at(-1) as { messages: unknown }).messages,
        maxTokens: 50,
      });
      return {
        status: "COMPLETED",
        finalAnswer: "hello",
        iterations: 0,
        inputTokens: 999,
        outputTokens: 999,
        toolCallsExecuted: 999,
      } as T;
    },
  };
  const result = await runSandboxAgent({ ...state, provider: malicious });
  expect(result.inputTokens).toBe(20);
  expect(result.toolCallsExecuted).toBe(1);
});

test("lost leases block model and tool access", async () => {
  const state = fixture();
  await expect(
    runSandboxAgent({
      ...state,
      provider: processProvider,
      async assertActive() {
        throw new Error("LEASE_LOST");
      },
    }),
  ).rejects.toThrow("LEASE_LOST");
  expect(state.executions()).toBe(0);
});

test("host enforces model and tool budgets even when the runner ignores them", async () => {
  const state = fixture();
  const malicious: Pick<SandboxProvider, "runAgent"> = {
    async runAgent<T>(
      ...[_id, _launch, handle]: Parameters<SandboxProvider["runAgent"]>
    ): Promise<T> {
      await handle("model.generate", {
        messages: [{ role: "user", content: "hello" }],
        maxTokens: 50,
      });
      await expect(
        handle("tool.invoke", {
          callId: "call-1",
          name: "execute_command",
          input: { command: "echo hello" },
        }),
      ).rejects.toThrow("EXECUTION_BUDGET_REACHED");
      await expect(
        handle("model.generate", {
          messages: (state.checkpoints.at(-1) as { messages: unknown })
            .messages,
          maxTokens: 50,
        }),
      ).rejects.toThrow("EXECUTION_BUDGET_REACHED");
      return {
        status: "LIMIT_REACHED",
        finalAnswer: "Execution budget reached",
        iterations: 0,
        inputTokens: 0,
        outputTokens: 0,
        toolCallsExecuted: 0,
      } as T;
    },
  };
  const result = await runSandboxAgent({
    ...state,
    provider: malicious,
    launch: {
      ...state.launch,
      input: { ...state.launch.input, maxToolCalls: 0, maxIterations: 1 },
    },
  });
  expect(result.iterations).toBe(1);
  expect(state.executions()).toBe(0);
});

test("cancellation closes the runner channel and terminates its process", async () => {
  const state = fixture();
  const controller = new AbortController();
  const pending = runSandboxAgent({
    ...state,
    provider: processProvider,
    signal: controller.signal,
    model: {
      async generate() {
        controller.abort(new Error("RUN_CANCELLED"));
        throw new Error("RUN_CANCELLED");
      },
    },
  });
  await expect(pending).rejects.toThrow("RUN_CANCELLED");
  expect(state.executions()).toBe(0);
});
