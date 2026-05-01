/**
 * runner.service.ts
 *
 * Orchestrates end-to-end eval runs with:
 *   - Concurrency control  : per-model semaphore (see getRateLimitProfile)
 *                            llama-3.1-8b-instant → 5 concurrent, 1s delay
 *                            llama-3.3-70b        → 3 concurrent, 3s delay
 *                            Anthropic/other      → 3 concurrent, 2s delay
 *   - Rate-limit handling  : exponential backoff on 429 errors
 *                            starting at 2 s, doubling up to 32 s, max 5 retries
 *   - Resumability         : resumeRun() finds un-completed cases in the DB
 *                            and continues from where the run was interrupted
 *   - Idempotency          : before running a case, check case_results for
 *                            (run_id, transcript_id); skip if schema_valid=true
 *                            and force=false
 *
 * Cost model (claude-haiku-4-5 at time of writing):
 *   Input             $0.80  / 1 M tokens
 *   Output            $4.00  / 1 M tokens
 *   Cache read        $0.08  / 1 M tokens
 *   Cache write       $1.00  / 1 M tokens
 *
 * These constants are exported so callers can override them for other models.
 */

import path from "path";
import { fileURLToPath } from "url";

import { db, runs, caseResults } from "@test-evals/db";
import { eq, and } from "drizzle-orm";
import {
  ZeroShotStrategy,
  FewShotStrategy,
  ChainOfThoughtStrategy,
  extract,
  hashPrompt,
  type IPromptStrategy,
} from "@test-evals/llm";
import type {
  ExtractionSchema,
  PromptStrategy,
  CaseResult,
} from "@test-evals/shared";

import { evaluateCase } from "./evaluate.service.js";

// ============================================================
// §1  Path resolution
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve a path relative to the monorepo root (4 levels up from
 * apps/server/src/services/).
 */
function repoRoot(...segments: string[]): string {
  return path.resolve(__dirname, "../../../../", ...segments);
}

// ============================================================
// §2  Cost constants
// ============================================================

export const COST_PER_M = {
  input: 0.8,
  output: 4.0,
  cacheRead: 0.08,
  cacheWrite: 1.0,
} as const;

function computeCostUsd(
  tokensInput: number,
  tokensOutput: number,
  tokensCacheRead: number,
  tokensCacheWrite: number,
): number {
  return (
    (tokensInput * COST_PER_M.input +
      tokensOutput * COST_PER_M.output +
      tokensCacheRead * COST_PER_M.cacheRead +
      tokensCacheWrite * COST_PER_M.cacheWrite) /
    1_000_000
  );
}

// ============================================================
// §3  Semaphore — limits concurrent LLM calls
// ============================================================

class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];

  constructor(max: number) {
    this.count = max;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.count++;
    const next = this.queue.shift();
    if (next) {
      this.count--;
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// ── Per-model rate-limit profiles ───────────────────────────────────────────
//
// llama-3.1-8b-instant   : 100k TPM  → concurrency=5, delay=1s
// llama-3.3-70b-versatile:   6k TPM  → concurrency=3, delay=3s
// everything else (Anthropic, etc.)  → concurrency=3, delay=2s

interface RateLimitProfile {
  maxConcurrent: number;
  caseDelayMs: number;
}

function getRateLimitProfile(model: string): RateLimitProfile {
  if (model.includes("llama-3.1-8b")) {
    return { maxConcurrent: 5, caseDelayMs: 1_000 };
  }
  if (model.includes("llama-3.3-70b")) {
    return { maxConcurrent: 3, caseDelayMs: 3_000 };
  }
  // Anthropic / other
  return { maxConcurrent: 3, caseDelayMs: 2_000 };
}

// ============================================================
// §4  Exponential backoff for Anthropic 429 errors
// ============================================================

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 32_000;
const BACKOFF_MAX_RETRIES = 5;

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    // Anthropic SDK surfaces 429 as an APIError with status 429
    const msg = err.message.toLowerCase();
    return (
      msg.includes("429") ||
      msg.includes("rate limit") ||
      msg.includes("too many requests")
    );
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async function with exponential backoff retries on 429 errors.
 * Other errors are re-thrown immediately.
 */
async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let delayMs = BACKOFF_BASE_MS;

  for (let attempt = 0; attempt <= BACKOFF_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < BACKOFF_MAX_RETRIES && isRateLimitError(err)) {
        console.warn(
          `[runner] 429 rate limit — backing off ${delayMs}ms (attempt ${attempt + 1}/${BACKOFF_MAX_RETRIES})`,
        );
        await sleep(delayMs);
        delayMs = Math.min(delayMs * 2, BACKOFF_MAX_MS);
      } else {
        throw err;
      }
    }
  }

  // TypeScript needs this but it's unreachable
  throw new Error("Backoff exhausted without success or throw");
}

// ============================================================
// §5  Strategy factory
// ============================================================

function makeStrategy(strategy: PromptStrategy): IPromptStrategy {
  switch (strategy) {
    case "zero_shot":
      return new ZeroShotStrategy();
    case "few_shot":
      return new FewShotStrategy();
    case "cot":
      return new ChainOfThoughtStrategy();
  }
}

// ============================================================
// §6  Dataset loading
// ============================================================

export interface DatasetEntry {
  id: string;
  transcript: string;
  gold: ExtractionSchema;
}

/**
 * Load all matched transcript+gold pairs from data/transcripts/ and data/gold/.
 * Files are matched by filename stem (e.g. "case_001").
 * If `filter` is provided, only entries with those ids are returned.
 */
export function loadDataset(filter?: string[]): DatasetEntry[] {
  const transcriptDir = repoRoot("data", "transcripts");
  const goldDir = repoRoot("data", "gold");

  // We read synchronously during dataset load — this runs once at run-start,
  // not on each request, so blocking is acceptable.
  const { readdirSync, readFileSync } = require("fs") as typeof import("fs");

  const txtFiles = readdirSync(transcriptDir).filter((f: string) =>
    f.endsWith(".txt"),
  );

  const entries: DatasetEntry[] = [];

  for (const txtFile of txtFiles) {
    const stem = path.basename(txtFile, ".txt");
    const goldFile = stem + ".json";
    const goldPath = path.join(goldDir, goldFile);

    // Skip if no matching gold file
    try {
      readFileSync(goldPath); // just test existence
    } catch {
      console.warn(`[runner] No gold file for ${stem} — skipping`);
      continue;
    }

    if (filter && !filter.includes(stem)) continue;

    const transcript = readFileSync(path.join(transcriptDir, txtFile), "utf8");
    const gold = JSON.parse(readFileSync(goldPath, "utf8")) as ExtractionSchema;

    entries.push({ id: stem, transcript, gold });
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

// ============================================================
// §7  Per-case runner (extract → evaluate → persist)
// ============================================================

interface RunCaseOptions {
  runId: string;
  entry: DatasetEntry;
  strategy: IPromptStrategy;
  model: string;
  force: boolean;
}

/**
 * Run a single case end-to-end. Handles idempotency check, extraction,
 * evaluation, and DB persistence. Returns the CaseResult.
 */
async function runCase(opts: RunCaseOptions): Promise<CaseResult> {
  const { runId, entry, strategy, model, force } = opts;

  // --- Idempotency check ---
  if (!force) {
    const existing = await db
      .select()
      .from(caseResults)
      .where(
        and(
          eq(caseResults.runId, runId),
          eq(caseResults.transcriptId, entry.id),
        ),
      )
      .limit(1);

    const cached = existing[0];
    if (cached?.schemaValid) {
      // Return the cached result without calling the LLM
      return {
        transcriptId: entry.id,
        strategy: strategy.name,
        prediction: (cached.prediction as ExtractionSchema | null) ?? null,
        scores: cached.scores as CaseResult["scores"],
        attempts: cached.attempts ?? 1,
        tokensInput: cached.tokensInput ?? 0,
        tokensOutput: cached.tokensOutput ?? 0,
        tokensCacheRead: cached.tokensCacheRead ?? 0,
        tokensCacheWrite: cached.tokensCacheWrite ?? 0,
        costUsd: cached.costUsd ?? 0,
        hallucinations: (cached.hallucinations as CaseResult["hallucinations"]) ?? [],
        schemaValid: cached.schemaValid ?? false,
        wallTimeMs: cached.wallTimeMs ?? 0,
      };
    }
  }

  // --- Extract ---
  const startMs = Date.now();

  const extractResult = await withBackoff(() =>
    extract(entry.transcript, strategy, model),
  );

  const wallTimeMs = Date.now() - startMs;

  const { inputTokens: tokensInput, outputTokens: tokensOutput, cacheReadTokens: tokensCacheRead, cacheWriteTokens: tokensCacheWrite } =
    extractResult.usage;

  const costUsd = computeCostUsd(
    tokensInput,
    tokensOutput,
    tokensCacheRead,
    tokensCacheWrite,
  );

  const schemaValid = extractResult.prediction !== null;

  // --- Evaluate ---
  const { scores, hallucinations } = evaluateCase(
    extractResult.prediction,
    entry.gold,
    entry.transcript,
  );

  // --- Persist ---
  await db
    .insert(caseResults)
    .values({
      runId,
      transcriptId: entry.id,
      strategy: strategy.name,
      prediction: extractResult.prediction as Record<string, unknown> | null,
      scores: scores as unknown as Record<string, unknown>,
      attempts: extractResult.attempts,
      tokensInput,
      tokensOutput,
      tokensCacheRead,
      tokensCacheWrite,
      costUsd,
      hallucinations: hallucinations as unknown as Record<string, unknown>[],
      schemaValid,
      wallTimeMs,
      llmTrace: extractResult.trace as unknown as Record<string, unknown>[],
    })
    .onConflictDoUpdate({
      target: [caseResults.runId, caseResults.transcriptId],
      set: {
        prediction: extractResult.prediction as Record<string, unknown> | null,
        scores: scores as unknown as Record<string, unknown>,
        attempts: extractResult.attempts,
        tokensInput,
        tokensOutput,
        tokensCacheRead,
        tokensCacheWrite,
        costUsd,
        hallucinations: hallucinations as unknown as Record<string, unknown>[],
        schemaValid,
        wallTimeMs,
        llmTrace: extractResult.trace as unknown as Record<string, unknown>[],
      },
    });

  return {
    transcriptId: entry.id,
    strategy: strategy.name,
    prediction: extractResult.prediction,
    scores,
    attempts: extractResult.attempts,
    tokensInput,
    tokensOutput,
    tokensCacheRead,
    tokensCacheWrite,
    costUsd,
    hallucinations,
    schemaValid,
    wallTimeMs,
  };
}

// ============================================================
// §8  Aggregate stats updater
// ============================================================

/**
 * Recompute and persist run-level aggregate stats from all completed cases.
 * Called after every case completion so the run row stays current.
 */
async function updateRunAggregates(runId: string, startWallMs: number): Promise<void> {
  const cases = await db
    .select()
    .from(caseResults)
    .where(eq(caseResults.runId, runId));

  if (cases.length === 0) return;

  const completedCases = cases.length;
  let totalCostUsd = 0;
  let totalTokens = 0;
  let totalCacheRead = 0;
  let sumF1 = 0;

  for (const c of cases) {
    totalCostUsd += c.costUsd ?? 0;
    totalTokens += (c.tokensInput ?? 0) + (c.tokensOutput ?? 0);
    totalCacheRead += c.tokensCacheRead ?? 0;
    const scores = c.scores as { overall?: number } | null;
    sumF1 += scores?.overall ?? 0;
  }

  const aggregateF1 = sumF1 / completedCases;
  const totalTokensWithCache = totalTokens + totalCacheRead;
  const cacheHitRate =
    totalTokensWithCache > 0 ? totalCacheRead / totalTokensWithCache : 0;
  const wallTimeMs = Date.now() - startWallMs;

  await db
    .update(runs)
    .set({
      completedCases,
      aggregateF1,
      totalCostUsd,
      totalTokens,
      cacheHitRate,
      wallTimeMs,
    })
    .where(eq(runs.id, runId));
}

// ============================================================
// §9  startRun — main entry point
// ============================================================

export interface StartRunOptions {
  strategy: PromptStrategy;
  model: string;
  datasetFilter?: string[];
  force?: boolean;
  onProgress?: (
    caseResult: CaseResult,
    completed: number,
    total: number,
  ) => void;
}

/**
 * Create a new run record, process all dataset cases with concurrency control,
 * and return the run ID.
 */
export async function startRun(options: StartRunOptions): Promise<string> {
  const {
    strategy: strategyName,
    model,
    datasetFilter,
    force = false,
    onProgress,
  } = options;

  const strategy = makeStrategy(strategyName);
  const promptHash = hashPrompt(strategy);
  const dataset = loadDataset(datasetFilter);

  if (dataset.length === 0) {
    throw new Error(
      datasetFilter
        ? `No matching cases found for filter: ${datasetFilter.join(", ")}`
        : "Dataset is empty — check data/transcripts/ and data/gold/",
    );
  }

  // --- Create run row ---
  const [run] = await db
    .insert(runs)
    .values({
      strategy: strategyName,
      model,
      promptHash,
      status: "running",
      totalCases: dataset.length,
      completedCases: 0,
    })
    .returning({ id: runs.id });

  if (!run) throw new Error("Failed to create run record");
  const runId = run.id;
  const startWallMs = Date.now();

  console.log(
    `[runner] startRun id=${runId} strategy=${strategyName} model=${model} cases=${dataset.length}`,
  );

  // --- Process with semaphore ---
  const { maxConcurrent, caseDelayMs } = getRateLimitProfile(model);
  const sem = new Semaphore(maxConcurrent);
  let completed = 0;

  console.log(
    `[runner] rate-limit profile: maxConcurrent=${maxConcurrent} caseDelayMs=${caseDelayMs}`,
  );

  try {
    await Promise.all(
      dataset.map((entry) =>
        sem.run(async () => {
          const result = await runCase({ runId, entry, strategy, model, force });
          completed++;

          await updateRunAggregates(runId, startWallMs);
          onProgress?.(result, completed, dataset.length);

          console.log(
            `[runner] ${completed}/${dataset.length} ${entry.id} ` +
              `f1=${result.scores.overall.toFixed(3)} ` +
              `cost=$${result.costUsd.toFixed(5)}`,
          );

          // Polite inter-case delay to stay within TPM limits
          if (completed < dataset.length) await sleep(caseDelayMs);
        }),
      ),
    );

    // --- Mark completed ---
    await db
      .update(runs)
      .set({ status: "completed", wallTimeMs: Date.now() - startWallMs })
      .where(eq(runs.id, runId));

    console.log(`[runner] Run ${runId} COMPLETED`);
  } catch (err) {
    // Mark as partial/failed
    await db
      .update(runs)
      .set({ status: completed > 0 ? "partial" : "failed" })
      .where(eq(runs.id, runId));

    throw err;
  }

  return runId;
}

// ============================================================
// §10  resumeRun — continue an interrupted run
// ============================================================

export interface ResumeRunOptions {
  onProgress?: (
    caseResult: CaseResult,
    completed: number,
    total: number,
  ) => void;
}

/**
 * Resume an existing run by finding transcript IDs that have not yet been
 * stored in case_results and running only those.
 */
export async function resumeRun(
  runId: string,
  options: ResumeRunOptions = {},
): Promise<void> {
  const { onProgress } = options;

  // --- Load run metadata ---
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error(`Run ${runId} not found`);

  if (run.status === "completed") {
    console.log(`[runner] Run ${runId} is already completed — nothing to do`);
    return;
  }

  const strategy = makeStrategy(run.strategy as PromptStrategy);
  const model = run.model;

  // --- Find already-completed transcript IDs ---
  const done = await db
    .select({ transcriptId: caseResults.transcriptId })
    .from(caseResults)
    .where(
      and(eq(caseResults.runId, runId), eq(caseResults.schemaValid, true)),
    );

  const doneIds = new Set(done.map((r) => r.transcriptId));

  // Load full dataset and filter to remaining cases
  const remaining = loadDataset().filter((e) => !doneIds.has(e.id));

  if (remaining.length === 0) {
    console.log(`[runner] Resume ${runId}: all cases already complete`);
    await db
      .update(runs)
      .set({ status: "completed" })
      .where(eq(runs.id, runId));
    return;
  }

  console.log(
    `[runner] resumeRun id=${runId} remaining=${remaining.length} / total=${run.totalCases}`,
  );

  // Mark as running again
  await db
    .update(runs)
    .set({ status: "running" })
    .where(eq(runs.id, runId));

  const startWallMs = Date.now();
  const { maxConcurrent, caseDelayMs } = getRateLimitProfile(model);
  const sem = new Semaphore(maxConcurrent);
  const totalForProgress = run.totalCases ?? remaining.length;
  let completed = doneIds.size;

  try {
    await Promise.all(
      remaining.map((entry) =>
        sem.run(async () => {
          const result = await runCase({
            runId,
            entry,
            strategy,
            model,
            force: false,
          });
          completed++;

          await updateRunAggregates(runId, startWallMs);
          onProgress?.(result, completed, totalForProgress);

          console.log(
            `[runner] resume ${completed}/${totalForProgress} ${entry.id} ` +
              `f1=${result.scores.overall.toFixed(3)}`,
          );

          if (completed < totalForProgress) await sleep(caseDelayMs);
        }),
      ),
    );

    await db
      .update(runs)
      .set({ status: "completed", wallTimeMs: Date.now() - startWallMs })
      .where(eq(runs.id, runId));

    console.log(`[runner] Run ${runId} RESUMED and COMPLETED`);
  } catch (err) {
    await db
      .update(runs)
      .set({ status: "partial" })
      .where(eq(runs.id, runId));
    throw err;
  }
}

// ============================================================
// §11  launchRun — fire-and-forget variant for HTTP routes
// ============================================================

export interface LaunchRunOptions {
  strategy: PromptStrategy;
  model: string;
  datasetFilter?: string[];
  force?: boolean;
  onProgress?: (caseResult: CaseResult, completed: number, total: number) => void;
}

/**
 * Inserts the run row, returns the runId immediately, then continues
 * executing all cases in the background (non-blocking).
 * Use from HTTP routes so the 202 response is sent without waiting.
 */
export async function launchRun(
  options: LaunchRunOptions,
): Promise<{ runId: string; bgPromise: Promise<void> }> {
  const {
    strategy: strategyName,
    model,
    datasetFilter,
    force = false,
    onProgress,
  } = options;

  const strategy = makeStrategy(strategyName);
  const promptHash = hashPrompt(strategy);
  const dataset = loadDataset(datasetFilter);

  if (dataset.length === 0) {
    throw new Error(
      datasetFilter
        ? `No matching cases found for filter: ${datasetFilter.join(", ")}`
        : "Dataset is empty — check data/transcripts/ and data/gold/",
    );
  }

  const [run] = await db
    .insert(runs)
    .values({
      strategy: strategyName,
      model,
      promptHash,
      status: "running",
      totalCases: dataset.length,
      completedCases: 0,
    })
    .returning({ id: runs.id });

  if (!run) throw new Error("Failed to create run record");
  const runId = run.id;
  const startWallMs = Date.now();

  console.log(
    `[runner] launchRun id=${runId} strategy=${strategyName} model=${model} cases=${dataset.length}`,
  );

  const { maxConcurrent, caseDelayMs } = getRateLimitProfile(model);
  const sem = new Semaphore(maxConcurrent);
  let completed = 0;

  const bgPromise = (async () => {
    try {
      await Promise.all(
        dataset.map((entry) =>
          sem.run(async () => {
            const result = await runCase({ runId, entry, strategy, model, force });
            completed++;
            await updateRunAggregates(runId, startWallMs);
            onProgress?.(result, completed, dataset.length);
            console.log(
              `[runner] ${completed}/${dataset.length} ${entry.id} ` +
                `f1=${result.scores.overall.toFixed(3)} cost=$${result.costUsd.toFixed(5)}`,
            );
            if (completed < dataset.length) await sleep(caseDelayMs);
          }),
        ),
      );
      await db
        .update(runs)
        .set({ status: "completed", wallTimeMs: Date.now() - startWallMs })
        .where(eq(runs.id, runId));
      console.log(`[runner] Run ${runId} COMPLETED`);
    } catch (err) {
      console.error(`[runner] Run ${runId} FAILED:`, err);
      await db
        .update(runs)
        .set({ status: completed > 0 ? "partial" : "failed" })
        .where(eq(runs.id, runId));
    }
  })();

  return { runId, bgPromise };
}
