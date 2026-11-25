import { server_env as env } from "@repo/env";
import {
  AgentRuntime as CoreRuntime,
  type ModelGateway,
  type ToolRegistry,
} from "./core";
import { ModelRouter, OpenAIProvider } from "./providers";
export * from "./core";
export * from "./providers";
export * from "./mcp";
export * from "./tools";

// Host convenience defaults stay outside the portable, credential-free runtime.
export class AgentRuntime extends CoreRuntime {
  constructor(
    sandbox: ConstructorParameters<typeof CoreRuntime>[0],
    router?: ModelGateway,
    registry?: ToolRegistry,
  ) {
    super(
      sandbox,
      router ??
        new ModelRouter(async (name) => {
          if (name !== "openai" || !env.MODEL_API_KEY)
            throw new Error("PROVIDER_NOT_CONFIGURED");
          return {
            provider: new OpenAIProvider(env.MODEL_API_KEY, env.MODEL_BASE_URL),
            model: env.MODEL_NAME,
          };
        }),
      registry,
    );
  }
}
