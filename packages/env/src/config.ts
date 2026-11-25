import { z } from "zod";
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

export const ServerEnvSchema = z.object({
    DATABASE_URL: z.string().url(),
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
    JWT_SECRET: z.string(),
    PORT: z.string(),
    NODE_ENV: z.string().optional().default("development"),
    APP_URL: z.string().url(),
    WEB_URL: z.string().url(),
    SERVER_URL: z.string().url(),
    REDIS_HOST: z.string(),
    REDIS_PORT: z.string(),
    REDIS_USERNAME: z.string().optional(),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_TLS: z.string().optional().transform((val) => val?.toLowerCase() === "true"),
    GEMINI_API_KEY: z.string(),
    OPENROUTER_API_KEY: z.string(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export const server_env = ServerEnvSchema.parse(process.env);
