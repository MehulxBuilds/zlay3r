import { z } from "zod";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Resolve from this module, so every workspace loads the same server config.
const environment = process.env.NODE_ENV ?? "development";
if (environment !== "production") {
  config({
    path: fileURLToPath(
      new URL(`../../../env/.env.${environment}.local`, import.meta.url),
    ),
    quiet: true,
  });
  config({
    path: fileURLToPath(
      new URL(`../../../env/.env.${environment}`, import.meta.url),
    ),
    quiet: true,
  });
}

export const ServerEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  MCP_API_BASE: z.url().default("http://localhost:3001"),
  MCP_API_KEY: z.string().default(""),
  HOST: z.string().default("0.0.0.0"),
  WEB_URL: z.url().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  SANDBOX_IMAGE: z.string().default("zlayer-sandbox:local"),
  INSTANCE_ID: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,40}$/)
    .default("local"),
  SANDBOX_SECCOMP: z.string().default(""),
  ENCRYPTION_KEY: z.string().default(""),
  R2_ACCOUNT_ID: z.string().default(""),
  R2_BUCKET: z.string().default(""),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(3),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.union([z.literal(""), z.url()]).default(""),
  MODEL_BASE_URL: z.url().default("https://api.openai.com/v1"),
  MODEL_API_KEY: z.string().default(""),
  MODEL_NAME: z.string().default("gpt-4o-mini"),
  DOCKER_SOCKET: z
    .string()
    .default("/var/run/docker.sock")
    .transform((value) => {
      if (process.platform === "win32" && value === "/var/run/docker.sock") {
        return "//./pipe/docker_engine";
      }
      return value.replace(/^npipe:\/+/, "//");
    }),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export const server_env = ServerEnvSchema.parse(process.env);
