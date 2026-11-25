import pino from "pino";
import { trace } from "@opentelemetry/api";
export * from "./telemetry";
import { server_env as env } from "@repo/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  mixin() {
    const current = trace.getActiveSpan()?.spanContext();
    return current ? { traceId: current.traceId, spanId: current.spanId } : {};
  },
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
