/**
 * cli.ts — Command-line runner for HealosBench evaluations.
 *
 * Usage:
 *   bun run eval [--strategy zero_shot|few_shot|cot] [--model <model-id>]
 *
 * Examples:
 *   bun run eval
 *   bun run eval --strategy cot
 *   bun run eval --strategy few_shot --model claude-haiku-4-5-20251001
 */

// ─── Env bootstrap (must be FIRST — before any @test-evals/env import) ────────
// Primary:  bun --env-file=apps/server/.env sets vars before this file runs.
// Fallback: dotenv.config() catches any invocation path that skips --env-file.
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __envDir = fileURLToPath(new URL(".", import.meta.url));
config({ path: path.resolve(__envDir, "../../.env") }); // apps/server/.env

// ─── All other imports below (env is now populated) ──────────────────────────

import fs from "fs";

import type { CaseResult, PromptStrategy } from "@test-evals/shared";

import { startRun } from "./services/runner.service.js";

// ─── Path helpers ────────────────────────────────────────────────────────────

// __envDir already points to apps/server/src/ — reuse it as __dirname
const __dirname = __envDir;

/** Resolve path relative to the monorepo root (3 levels up from apps/server/src). */
function repoRoot(...segments: string[]): string {
  return path.resolve(__dirname, "../../../", ...segments);
}

// ─── Argument parsing ────────────────────────────────────────────────────────

const VALID_STRATEGIES: PromptStrategy[] = ["zero_shot", "few_shot", "cot"];
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

function parseArgs(): { strategy: PromptStrategy; model: string; filter?: string[] } {
  const args = process.argv.slice(2);
  let strategy: PromptStrategy = "zero_shot";
  let model = DEFAULT_MODEL;
  let filter: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--strategy" && args[i + 1]) {
      const val = args[i + 1] as PromptStrategy;
      if (!VALID_STRATEGIES.includes(val)) {
        console.error(
          `[cli] Invalid --strategy "${val}". Must be one of: ${VALID_STRATEGIES.join(", ")}`,
        );
        process.exit(1);
      }
      strategy = val;
      i++;
    } else if (args[i] === "--model" && args[i + 1]) {
      model = args[i + 1]!;
      i++;
    } else if (args[i] === "--filter" && args[i + 1]) {
      filter = args[i + 1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    }
  }

  return { strategy, model, filter };
}

// ─── Progress tracking ───────────────────────────────────────────────────────

const completedResults: CaseResult[] = [];

function onProgress(
  caseResult: CaseResult,
  completed: number,
  total: number,
): void {
  completedResults.push(caseResult);
  const score = caseResult.scores.overall.toFixed(3);
  const cost = caseResult.costUsd.toFixed(5);
  process.stdout.write(
    `[${String(completed).padStart(2)}/${total}] ${caseResult.transcriptId} ✓  overall=${score}  cost=$${cost}\n`,
  );
}

// ─── Summary table ───────────────────────────────────────────────────────────

function printSummary(
  runId: string,
  strategy: PromptStrategy,
  model: string,
  durationMs: number,
): void {
  if (completedResults.length === 0) return;

  const n = completedResults.length;
  const totalCost = completedResults.reduce((s, r) => s + r.costUsd, 0);
  const avgOverall = completedResults.reduce((s, r) => s + r.scores.overall, 0) / n;

  // Per-field averages — collect all field keys from first result
  const fieldKeys = Object.keys(completedResults[0]!.scores).filter(
    (k) => k !== "overall",
  );

  const fieldAvgs: Record<string, number> = {};
  for (const key of fieldKeys) {
    const avg =
      completedResults.reduce((s, r) => {
        const v = (r.scores as unknown as Record<string, number>)[key] ?? 0;
        return s + v;
      }, 0) / n;
    fieldAvgs[key] = avg;
  }

  const hallucinationCount = completedResults.reduce(
    (s, r) => s + (r.hallucinations?.length ?? 0),
    0,
  );

  const schemaFailures = completedResults.filter((r) => !r.schemaValid).length;

  const totalTokens = completedResults.reduce(
    (s, r) => s + r.tokensInput + r.tokensOutput + r.tokensCacheRead + r.tokensCacheWrite,
    0,
  );

  const sep = "─".repeat(56);

  console.log(`\n${sep}`);
  console.log(`  HealosBench Run Summary`);
  console.log(sep);
  console.log(`  Run ID      : ${runId}`);
  console.log(`  Strategy    : ${strategy}`);
  console.log(`  Model       : ${model}`);
  console.log(`  Cases       : ${n}`);
  console.log(`  Duration    : ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Total cost  : $${totalCost.toFixed(4)}`);
  console.log(`  Total tokens: ${totalTokens.toLocaleString()}`);
  console.log(`  Schema fails: ${schemaFailures}`);
  console.log(`  Hallucination flags: ${hallucinationCount}`);
  console.log(sep);
  console.log(`  Field F1 scores (avg over ${n} cases):`);
  console.log(`    overall              : ${avgOverall.toFixed(4)}`);
  for (const [key, avg] of Object.entries(fieldAvgs)) {
    console.log(`    ${key.padEnd(20)} : ${avg.toFixed(4)}`);
  }
  console.log(sep);
}

// ─── Save results ─────────────────────────────────────────────────────────────

function saveResults(
  runId: string,
  strategy: PromptStrategy,
  model: string,
): void {
  const resultsDir = repoRoot("results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);

  const filename = `${strategy}_${timestamp}.json`;
  const filepath = path.join(resultsDir, filename);

  const payload = {
    runId,
    strategy,
    model,
    timestamp: new Date().toISOString(),
    cases: completedResults,
  };

  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n  Results saved → results/${filename}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { strategy, model, filter } = parseArgs();

  console.log(`\nHealosBench CLI`);
  console.log(`  strategy : ${strategy}`);
  console.log(`  model    : ${model}`);
  if (filter) {
    console.log(`  filter   : ${filter.join(", ")} (${filter.length} case${filter.length !== 1 ? "s" : ""})`);
  }
  console.log(`  starting run…\n`);

  const startMs = Date.now();

  let runId: string;
  try {
    runId = await startRun({
      strategy,
      model,
      datasetFilter: filter,
      onProgress,
    });
  } catch (err) {
    console.error("\n[cli] Run failed:", err);
    process.exit(1);
  }

  const durationMs = Date.now() - startMs;

  printSummary(runId, strategy, model, durationMs);
  saveResults(runId, strategy, model);
}

main();
