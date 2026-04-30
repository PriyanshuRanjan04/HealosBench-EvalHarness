import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategy: text("strategy").notNull(),
  model: text("model").notNull(),
  promptHash: text("prompt_hash").notNull(),
  status: text("status").notNull().default("pending"),
  totalCases: integer("total_cases").notNull(),
  completedCases: integer("completed_cases").notNull().default(0),
  aggregateF1: real("aggregate_f1"),
  totalCostUsd: real("total_cost_usd").default(0),
  totalTokens: integer("total_tokens").default(0),
  cacheHitRate: real("cache_hit_rate"),
  wallTimeMs: integer("wall_time_ms"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ---------------------------------------------------------------------------
// case_results
// ---------------------------------------------------------------------------

export const caseResults = pgTable(
  "case_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    transcriptId: text("transcript_id").notNull(),
    strategy: text("strategy").notNull(),
    /** Parsed ExtractionSchema JSON — null when LLM output is unparseable */
    prediction: jsonb("prediction"),
    /** FieldScores JSON object */
    scores: jsonb("scores"),
    attempts: integer("attempts").default(1),
    tokensInput: integer("tokens_input").default(0),
    tokensOutput: integer("tokens_output").default(0),
    tokensCacheRead: integer("tokens_cache_read").default(0),
    tokensCacheWrite: integer("tokens_cache_write").default(0),
    costUsd: real("cost_usd").default(0),
    /** Array of HallucinationFlag objects */
    hallucinations: jsonb("hallucinations").default([]),
    schemaValid: boolean("schema_valid").default(true),
    wallTimeMs: integer("wall_time_ms"),
    /** Array of { request, response } objects — one per attempt */
    llmTrace: jsonb("llm_trace").default([]),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    // Idempotency: a transcript can only appear once per run
    uniqueIndex("case_results_run_transcript_uidx").on(
      table.runId,
      table.transcriptId,
    ),
    // Fast lookup of all cases belonging to a run
    index("case_results_run_id_idx").on(table.runId),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const runsRelations = relations(runs, ({ many }) => ({
  cases: many(caseResults),
}));

export const caseResultsRelations = relations(caseResults, ({ one }) => ({
  run: one(runs, {
    fields: [caseResults.runId],
    references: [runs.id],
  }),
}));
