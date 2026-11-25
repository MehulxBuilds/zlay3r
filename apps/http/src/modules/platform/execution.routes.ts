import type { FastifyInstance } from "fastify";
import type { SandboxProvider } from "@repo/sandbox";
import { registerSandboxLifecycleRoutes } from "../sandboxes/sandbox.lifecycle.routes";
import { registerFilesystemRoutes } from "../filesystem/filesystem.routes";
import { registerExecutionsRoutes } from "../executions/executions.routes";
import { registerRunExecutionRoutes } from "../runs/run.execution.routes";
export async function registerExecutionRoutes(
  app: FastifyInstance,
  provider: SandboxProvider,
) {
  await registerSandboxLifecycleRoutes(app, provider);
  await registerFilesystemRoutes(app, provider);
  await registerExecutionsRoutes(app, provider);
  await registerRunExecutionRoutes(app, provider);
}
