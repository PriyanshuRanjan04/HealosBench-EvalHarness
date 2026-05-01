import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    // LLM provider selection — defaults to anthropic for full assignment compliance
    LLM_PROVIDER: z.enum(["anthropic", "groq"]).default("anthropic"),
    // Anthropic — required when LLM_PROVIDER=anthropic
    ANTHROPIC_API_KEY: z.string().optional(),
    // Groq — required when LLM_PROVIDER=groq
    GROQ_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
