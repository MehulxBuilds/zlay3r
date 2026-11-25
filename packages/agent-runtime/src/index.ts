import type { ExecuteResult } from "@repo/shared";
import { server_env as env } from "@repo/env";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

interface ModelResponse {
  content: string | null;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

export class AgentRuntime {
  constructor(
    private readonly sandbox: {
      execute: (
        id: string,
        command: string,
        timeout?: number,
      ) => Promise<ExecuteResult>;
    },
  ) {}

  private async model(messages: ChatMessage[]): Promise<ModelResponse> {
    const baseUrl = env.MODEL_BASE_URL;
    const apiKey = env.MODEL_API_KEY;
    const model = env.MODEL_NAME;
    if (!apiKey) throw new Error("MODEL_API_KEY is not configured");
    const response = await fetch(
      `${baseUrl || "https://api.openai.com/v1"}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: [
            {
              type: "function",
              function: {
                name: "execute_command",
                description:
                  "Execute a shell command in the assigned sandbox workspace",
                parameters: {
                  type: "object",
                  properties: { command: { type: "string" } },
                  required: ["command"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: "auto",
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        `Model request failed: ${response.status} ${await response.text()}`,
      );
    const data = (await response.json()) as any;
    const choice = data.choices?.[0]?.message;
    return {
      content: choice?.content ?? null,
      toolCalls: (choice?.tool_calls ?? []).map((call: any) => ({
        id: call.id,
        name: call.function.name,
        arguments: JSON.parse(call.function.arguments || "{}"),
      })),
    };
  }

  async run(input: {
    sandboxId: string;
    task: string;
    maxIterations?: number;
  }) {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are a coding agent. Use execute_command to inspect and modify the assigned sandbox. Work in /workspace. Do not claim an operation succeeded unless the tool result confirms it.",
      },
      { role: "user", content: input.task },
    ];
    let toolCallsExecuted = 0;
    const maxIterations = Math.min(input.maxIterations ?? 8, 12);

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const response = await this.model(messages);
      if (!response.toolCalls?.length) {
        return {
          status: "COMPLETED" as const,
          finalAnswer: response.content ?? "Task completed.",
          iterations: iteration,
          toolCallsExecuted,
        };
      }

      messages.push({
        role: "assistant",
        content:
          response.content ??
          `Requested ${response.toolCalls.length} tool call(s).`,
      });

      for (const call of response.toolCalls) {
        if (call.name !== "execute_command") {
          messages.push({
            role: "tool",
            content: `Unsupported tool: ${call.name}`,
          });
          continue;
        }
        const command = call.arguments.command;
        if (typeof command !== "string" || command.length > 4000) {
          messages.push({ role: "tool", content: "Invalid command argument." });
          continue;
        }
        const result = await this.sandbox.execute(
          input.sandboxId,
          command,
          30_000,
        );
        toolCallsExecuted++;
        messages.push({
          role: "tool",
          content: JSON.stringify({
            exitCode: result.exitCode,
            stdout: result.stdout.slice(0, 12000),
            stderr: result.stderr.slice(0, 6000),
            timedOut: result.timedOut,
          }),
        });
      }
    }

    return {
      status: "COMPLETED" as const,
      finalAnswer: "Stopped after reaching the maximum iteration limit.",
      iterations: maxIterations,
      toolCallsExecuted,
    };
  }
}
