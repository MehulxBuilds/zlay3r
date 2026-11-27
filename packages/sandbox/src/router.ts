import type { AgentRequestHandler } from "@repo/shared/agent-channel";
import { DockerSandboxProvider } from "./docker";
import { FirecrackerSandboxProvider } from "./firecracker/provider";
import { SandboxError, type SandboxProvider } from "./contracts";
import { parseVmResourceId } from "./firecracker/validation";

type ManagedProvider = SandboxProvider & {
  reconcileResources(ids: string[]): Promise<void>;
};

/** Resource identifiers retain their provider across processes and restarts. */
export class SandboxRouter implements SandboxProvider {
  constructor(
    private readonly kata: ManagedProvider,
    private readonly firecracker: ManagedProvider,
  ) {}

  private resource(id: string) {
    if (id.startsWith("firecracker:")) {
      parseVmResourceId(id);
      return this.firecracker;
    }
    if (/^[a-f0-9]{64}$/.test(id)) return this.kata;
    throw new SandboxError(
      "INVALID_SANDBOX_RESOURCE",
      "Invalid sandbox resource identifier.",
      400,
    );
  }

  create(input: Parameters<SandboxProvider["create"]>[0]) {
    const { type = "KATA", ...options } = input;
    if (type === "KATA") return this.kata.create(options);
    if (type === "FIRECRACKER") return this.firecracker.create(options);
    throw new SandboxError(
      "INVALID_SANDBOX_TYPE",
      "Select KATA or FIRECRACKER.",
      400,
    );
  }
  runAgent<T>(
    id: string,
    launch: unknown,
    handler: AgentRequestHandler,
    options: { signal: AbortSignal; timeoutMs: number },
  ) {
    return this.resource(id).runAgent<T>(id, launch, handler, options);
  }
  execute(...args: Parameters<SandboxProvider["execute"]>) {
    return this.resource(args[0]).execute(...args);
  }
  file<T>(id: string, operation: Record<string, unknown>) {
    return this.resource(id).file<T>(id, operation);
  }
  service<T>(id: string, action: Record<string, unknown>) {
    return this.resource(id).service<T>(id, action);
  }
  cancel(...args: Parameters<SandboxProvider["cancel"]>) {
    return this.resource(args[0]).cancel(...args);
  }
  lifecycle(...args: Parameters<SandboxProvider["lifecycle"]>) {
    return this.resource(args[0]).lifecycle(...args);
  }
  inspect(id: string) {
    return this.resource(id).inspect(id);
  }
  stats(id: string) {
    return this.resource(id).stats(id);
  }
  destroy(id: string) {
    return this.resource(id).destroy(id);
  }
  async reconcileResources(ids: string[]) {
    const results = await Promise.allSettled([
      this.kata.reconcileResources(
        ids.filter((id) => !id.startsWith("firecracker:")),
      ),
      this.firecracker.reconcileResources(
        ids.filter((id) => id.startsWith("firecracker:")),
      ),
    ]);
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
  }
}

export function createSandboxProvider() {
  return new SandboxRouter(
    new DockerSandboxProvider(),
    new FirecrackerSandboxProvider(),
  );
}
