import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "password",
      "token",
      "apiKey",
      "authorization",
      "headers.authorization",
      "secret",
      "ciphertext"
    ],
    censor: "[REDACTED]"
  },
  base: { service: "agent-platform" },
  timestamp: pino.stdTimeFunctions.isoTime
});
