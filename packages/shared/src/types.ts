// ---------------------------------------------------------------------------
// ExtractionSchema — mirrors data/schema.json
// ---------------------------------------------------------------------------

export interface ExtractionSchema {
  chief_complaint: string;
  vitals: {
    bp: string | null;
    hr: number | null;
    temp_f: number | null;
    spo2: number | null;
  };
  medications: Array<{
    name: string;
    dose: string;
    frequency: string;
    route: string;
  }>;
  diagnoses: Array<{
    description: string;
    icd10?: string;
  }>;
  plan: string[];
  follow_up: {
    interval_days: number | null;
    reason: string | null;
  };
}

// ---------------------------------------------------------------------------
// Prompt strategy union
// ---------------------------------------------------------------------------

export type PromptStrategy = "zero_shot" | "few_shot" | "cot";

// ---------------------------------------------------------------------------
// Run lifecycle status
// ---------------------------------------------------------------------------

export type RunStatus = "pending" | "running" | "completed" | "failed" | "partial";

// ---------------------------------------------------------------------------
// Per-field scoring — all values are 0-1
// ---------------------------------------------------------------------------

export interface FieldScores {
  /** Fuzzy string similarity 0-1 */
  chief_complaint: number;
  /** Averaged across bp / hr / temp_f / spo2 0-1 */
  vitals: number;
  /** Precision / recall / F1 over list of medications */
  medications: { precision: number; recall: number; f1: number };
  /** Precision / recall / F1 over list of diagnoses */
  diagnoses: { precision: number; recall: number; f1: number };
  /** Precision / recall / F1 over plan items */
  plan: { precision: number; recall: number; f1: number };
  /** Exact or partial match of follow_up object 0-1 */
  follow_up: number;
  /** Mean of all F1 scores (chief_complaint, vitals, meds, diag, plan, follow_up) */
  overall: number;
}

// ---------------------------------------------------------------------------
// Hallucination flag — one per detected fabricated value
// ---------------------------------------------------------------------------

export interface HallucinationFlag {
  field: string;
  value: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Per-case result record
// ---------------------------------------------------------------------------

export interface CaseResult {
  transcriptId: string;
  strategy: PromptStrategy;
  /** null when schema validation fails or LLM returns unparseable output */
  prediction: ExtractionSchema | null;
  scores: FieldScores;
  /** Number of retry attempts made (1 = first try succeeded) */
  attempts: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  costUsd: number;
  hallucinations: HallucinationFlag[];
  schemaValid: boolean;
  wallTimeMs: number;
}

// ---------------------------------------------------------------------------
// Run-level summary — stored in DB, returned by list endpoint
// ---------------------------------------------------------------------------

export interface RunSummary {
  id: string;
  strategy: PromptStrategy;
  model: string;
  /** SHA-256 of the rendered prompt template */
  promptHash: string;
  status: RunStatus;
  totalCases: number;
  completedCases: number;
  aggregateF1: number;
  totalCostUsd: number;
  totalTokens: number;
  /** tokensCacheRead / (tokensInput + tokensCacheRead) */
  cacheHitRate: number;
  wallTimeMs: number;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Run detail — extends summary with full per-case results
// ---------------------------------------------------------------------------

export interface RunDetail extends RunSummary {
  cases: CaseResult[];
}
