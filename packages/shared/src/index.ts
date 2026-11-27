export type SandboxStatus =
  | "CREATING"
  | "RUNNING"
  | "STOPPED"
  | "DESTROYED"
  | "FAILED"
  | "PAUSED";
export type RunStatus =
  | "QUEUED"
  | "RUNNING"
  | "AWAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED"
  | "LIMIT_REACHED";

export interface SandboxDto {
  type: "KATA" | "FIRECRACKER";
  id: string;
  name: string;
  status: SandboxStatus;
  memoryMb: number;
  cpu: number;
  createdAt: string;
}

export interface ExecuteResult {
  outputLimited?: boolean;
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
  kind?: "agent" | "shell";
  executionId?: string;
  trace?: Record<string, string>;
}

export interface RunDto {
  id: string;
  organizationId: string;
  sandboxId: string;
  task: string;
  status: RunStatus;
  provider: string;
  model: string | null;
  sessionId: string | null;
  result: { finalAnswer?: string } | null;
  error: string | null;
  createdAt: string;
  events?: RunEvent[];
}
export interface RunEvent {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  payload: unknown;
  createdAt: string;
}
export interface OrganizationDto {
  id: string;
  name: string;
  role: string;
}
export interface SessionDto {
  id: string;
  title: string;
  createdAt: string;
  messages?: { id: string; role: string; content: unknown }[];
  runs?: RunDto[];
}
export interface ArtifactDto {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  status: string;
  createdAt: string;
}
export interface ExecutionDto {
  id: string;
  sandboxId: string;
  command: string;
  status: string;
  result: ExecuteResult | null;
  createdAt: string;
}
export interface BrowserDto {
  id: string;
  sandboxId: string;
  status: string;
  createdAt: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
