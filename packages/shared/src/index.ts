export type SandboxStatus = "CREATING" | "RUNNING" | "STOPPED" | "DESTROYED" | "FAILED";
export type RunStatus = "QUEUED" | "RUNNING" | "AWAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED";

export interface SandboxDto {
  id: string;
  name: string;
  status: SandboxStatus;
  memoryMb: number;
  cpu: number;
  createdAt: string;
}

export interface ExecuteResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface RunJob {
  runId: string;
  organizationId: string;
  sandboxId: string;
  task: string;
}
