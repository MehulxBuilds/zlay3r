import type { ExecuteResult } from "@repo/shared";
import type { AgentRequestHandler } from "@repo/shared/agent-channel";

export type SandboxType = "KATA" | "FIRECRACKER";

export class SandboxError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 503,
  ) {
    super(message);
  }
}

export interface ExecutionOptions {
  id?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}
export interface SandboxProvider {
  runAgent<T>(
    id: string,
    launch: unknown,
    handler: AgentRequestHandler,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<T>;
  create(input: {
    name: string;
    memoryMb: number;
    cpu: number;
    approvedHosts?: string[];
    type?: SandboxType;
  }): Promise<{ resourceId: string }>;
  execute(
    id: string,
    command: string,
    options?: number | ExecutionOptions,
  ): Promise<ExecuteResult>;
  destroy(id: string): Promise<void>;
  lifecycle(
    id: string,
    action: "start" | "stop" | "pause" | "resume" | "restart",
  ): Promise<void>;
  inspect(id: string): Promise<unknown>;
  stats(id: string): Promise<unknown>;
  file<T>(id: string, operation: Record<string, unknown>): Promise<T>;
  cancel(id: string, executionId: string): Promise<void>;
  service<T>(id: string, action: Record<string, unknown>): Promise<T>;
}
