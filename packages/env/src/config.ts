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
  HOST: z.string().default("0.0.0.0"),
  WEB_URL: z.url().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  MODEL_BASE_URL: z.url().default("https://api.openai.com/v1"),
  MODEL_API_KEY: z.string().default(""),
  MODEL_NAME: z.string().default("gpt-4o-mini"),
  DOCKER_SOCKET: z.string().default("/var/run/docker.sock"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export const server_env = ServerEnvSchema.parse(process.env);
