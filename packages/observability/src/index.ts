import pino from "pino";
import { server_env as env } from "@repo/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "password",
      "token",
      "apiKey",
      "authorization",
      "headers.authorization",
      "secret",
      "ciphertext",
    ],
    censor: "[REDACTED]",
  },
  base: { service: "agent-platform" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
