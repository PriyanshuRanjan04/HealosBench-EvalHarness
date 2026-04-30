import { env } from "@test-evals/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema/index.js";

export function createDb() {
  return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();

// Re-export tables so consumers don't need to know internal paths
export * from "./schema/index.js";

// Convenience: inferred row types
export type { InferSelectModel, InferInsertModel } from "drizzle-orm";

