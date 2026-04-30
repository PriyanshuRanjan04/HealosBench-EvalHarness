/**
 * runs.ts — Hono router for /api/v1/runs
 *
 * Route registration order is critical:
 *   GET /compare  MUST come before  GET /:id
 * because Hono matches in registration order and "compare" would otherwise
 * be captured as a run ID.
 *
 * SSE design:
 *   The background runner fires onProgress() callbacks as each case
 *   completes. We bridge those callbacks to SSE by registering a per-runId
 *   Set of listener functions in `progressListeners`. When the SSE connection
 *   is opened, a listener is added; when the connection closes, it's removed.
 *   This avoids any polling or additional in-process pub/sub library.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { db, runs, caseResults } from "@test-evals/db";
import { eq, desc } from "drizzle-orm";
import type { CaseResult, PromptStrategy, RunSummary } from "@test-evals/shared";

import {
  launchRun,
  resumeRun,
} from "../services/runner.service.js";

// ============================================================
// §1  Progress listener registry — bridges runner → SSE
// ============================================================

type ProgressListener = (
  caseResult: CaseResult,
  completed: number,
  total: number,
) => void;

/**
 * Map<runId, Set<listener>>
 * Populated when a client opens an SSE stream; cleaned up on disconnect.
 */
const progressListeners = new Map<string, Set<ProgressListener>>();

function addListener(runId: string, fn: ProgressListener): void {
  if (!progressListeners.has(runId)) {
    progressListeners.set(runId, new Set());
  }
  progressListeners.get(runId)!.add(fn);
}

function removeListener(runId: string, fn: ProgressListener): void {
  progressListeners.get(runId)?.delete(fn);
  if (progressListeners.get(runId)?.size === 0) {
    progressListeners.delete(runId);
  }
}

function notifyListeners(
  runId: string,
  caseResult: CaseResult,
  completed: number,
  total: number,
): void {
  progressListeners.get(runId)?.forEach((fn) => fn(caseResult, completed, total));
}

// ============================================================
// §2  Helpers
// ============================================================

/** Validate that a string is one of the three strategy literals. */
function isValidStrategy(s: unknown): s is PromptStrategy {
  return s === "zero_shot" || s === "few_shot" || s === "cot";
}

/** Shape a raw DB run row into a RunSummary. */
function toRunSummary(row: typeof runs.$inferSelect): RunSummary {
  return {
    id: row.id,
    strategy: row.strategy as PromptStrategy,
    model: row.model,
    promptHash: row.promptHash,
    status: row.status as RunSummary["status"],
    totalCases: row.totalCases,
    completedCases: row.completedCases,
    aggregateF1: row.aggregateF1 ?? 0,
    totalCostUsd: row.totalCostUsd ?? 0,
    totalTokens: row.totalTokens ?? 0,
    cacheHitRate: row.cacheHitRate ?? 0,
    wallTimeMs: row.wallTimeMs ?? 0,
    createdAt: row.createdAt ?? new Date(),
  };
}

// ============================================================
// §3  Router
// ============================================================

export const runsRouter = new Hono();

// ------------------------------------------------------------------
// POST /api/v1/runs — start a new run (202, non-blocking)
// ------------------------------------------------------------------
runsRouter.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Body must be an object" }, 400);
  }

  const { strategy, model, dataset_filter, force } = body as Record<string, unknown>;

  if (!isValidStrategy(strategy)) {
    return c.json(
      { error: 'strategy must be "zero_shot" | "few_shot" | "cot"' },
      400,
    );
  }
  if (typeof model !== "string" || model.trim() === "") {
    return c.json({ error: "model must be a non-empty string" }, 400);
  }
  if (
    dataset_filter !== undefined &&
    (!Array.isArray(dataset_filter) ||
      !dataset_filter.every((x) => typeof x === "string"))
  ) {
    return c.json({ error: "dataset_filter must be string[] if provided" }, 400);
  }

  try {
    const { runId, bgPromise } = await launchRun({
      strategy,
      model: model.trim(),
      datasetFilter: dataset_filter as string[] | undefined,
      force: force === true,
      onProgress: (caseResult, completed, total) =>
        notifyListeners(runId, caseResult, completed, total),
    });

    // bgPromise runs silently; log top-level errors only
    bgPromise.catch((err: unknown) =>
      console.error(`[runs route] Unhandled run error runId=${runId}:`, err),
    );

    return c.json({ runId }, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start run";
    return c.json({ error: message }, 422);
  }
});

// ------------------------------------------------------------------
// GET /api/v1/runs — list all runs newest first
// ------------------------------------------------------------------
runsRouter.get("/", async (c) => {
  const rows = await db.select().from(runs).orderBy(desc(runs.createdAt));
  return c.json(rows.map(toRunSummary));
});

// ------------------------------------------------------------------
// GET /api/v1/runs/compare?a=:runIdA&b=:runIdB
// MUST be registered before GET /:id
// ------------------------------------------------------------------
runsRouter.get("/compare", async (c) => {
  const a = c.req.query("a");
  const b = c.req.query("b");

  if (!a || !b) {
    return c.json({ error: "Query params a and b (run IDs) are required" }, 400);
  }

  const [rowA, rowB] = await Promise.all([
    db.select().from(runs).where(eq(runs.id, a)).limit(1),
    db.select().from(runs).where(eq(runs.id, b)).limit(1),
  ]);

  if (!rowA[0]) return c.json({ error: `Run ${a} not found` }, 404);
  if (!rowB[0]) return c.json({ error: `Run ${b} not found` }, 404);

  const runA = toRunSummary(rowA[0]);
  const runB = toRunSummary(rowB[0]);

  // Fetch per-field averages from case_results for both runs
  const [casesA, casesB] = await Promise.all([
    db.select({ scores: caseResults.scores }).from(caseResults).where(eq(caseResults.runId, a)),
    db.select({ scores: caseResults.scores }).from(caseResults).where(eq(caseResults.runId, b)),
  ]);

  type ScoreRow = {
    chief_complaint?: number;
    vitals?: number;
    medications?: { f1?: number };
    diagnoses?: { f1?: number };
    plan?: { f1?: number };
    follow_up?: number;
    overall?: number;
  };

  const avgField = (
    cases: Array<{ scores: unknown }>,
    get: (s: ScoreRow) => number,
  ): number => {
    if (cases.length === 0) return 0;
    return (
      cases.reduce((sum, c) => sum + get((c.scores ?? {}) as ScoreRow), 0) /
      cases.length
    );
  };

  const fields: Record<string, (s: ScoreRow) => number> = {
    chief_complaint: (s) => s.chief_complaint ?? 0,
    vitals: (s) => s.vitals ?? 0,
    "medications.f1": (s) => s.medications?.f1 ?? 0,
    "diagnoses.f1": (s) => s.diagnoses?.f1 ?? 0,
    "plan.f1": (s) => s.plan?.f1 ?? 0,
    follow_up: (s) => s.follow_up ?? 0,
    overall: (s) => s.overall ?? 0,
  };

  const fieldDeltas: Record<
    string,
    { a: number; b: number; delta: number; winner: "a" | "b" | "tie" }
  > = {};

  for (const [field, getter] of Object.entries(fields)) {
    const va = avgField(casesA, getter);
    const vb = avgField(casesB, getter);
    const delta = vb - va;
    const EPSILON = 0.0005;
    const winner: "a" | "b" | "tie" =
      Math.abs(delta) < EPSILON ? "tie" : delta > 0 ? "b" : "a";
    fieldDeltas[field] = { a: va, b: vb, delta, winner };
  }

  return c.json({ runA, runB, fieldDeltas });
});

// ------------------------------------------------------------------
// GET /api/v1/runs/:id — run detail with all case_results
// ------------------------------------------------------------------
runsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [row] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  if (!row) return c.json({ error: `Run ${id} not found` }, 404);

  const cases = await db
    .select()
    .from(caseResults)
    .where(eq(caseResults.runId, id))
    .orderBy(caseResults.transcriptId);

  return c.json({
    ...toRunSummary(row),
    cases: cases.map((cr) => ({
      transcriptId: cr.transcriptId,
      strategy: cr.strategy as PromptStrategy,
      prediction: cr.prediction,
      scores: cr.scores,
      attempts: cr.attempts ?? 1,
      tokensInput: cr.tokensInput ?? 0,
      tokensOutput: cr.tokensOutput ?? 0,
      tokensCacheRead: cr.tokensCacheRead ?? 0,
      tokensCacheWrite: cr.tokensCacheWrite ?? 0,
      costUsd: cr.costUsd ?? 0,
      hallucinations: cr.hallucinations ?? [],
      schemaValid: cr.schemaValid ?? false,
      wallTimeMs: cr.wallTimeMs ?? 0,
    })),
  });
});

// ------------------------------------------------------------------
// GET /api/v1/runs/:id/stream — SSE progress stream
// ------------------------------------------------------------------
runsRouter.get("/:id/stream", async (c) => {
  const id = c.req.param("id");

  // Verify run exists
  const [row] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  if (!row) return c.json({ error: `Run ${id} not found` }, 404);

  // If already terminal, send one final event and close immediately
  if (row.status === "completed" || row.status === "failed") {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ status: row.status }),
      });
    });
  }

  return streamSSE(c, async (stream) => {
    let closed = false;

    // Progress listener: forward each case completion as an SSE event
    const listener: ProgressListener = (caseResult, completed, total) => {
      if (closed) return;
      stream
        .writeSSE({
          event: "progress",
          data: JSON.stringify({ caseResult, completed, total }),
        })
        .catch(() => {
          closed = true;
        });
    };

    addListener(id, listener);

    // Keep-alive ping every 15 s so proxies don't close idle connections
    const pingInterval = setInterval(() => {
      if (closed) {
        clearInterval(pingInterval);
        return;
      }
      stream.write(": ping\n\n").catch(() => {
        closed = true;
        clearInterval(pingInterval);
      });
    }, 15_000);

    // Poll the run status every 2 s; close when terminal
    const pollInterval = setInterval(async () => {
      if (closed) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const [current] = await db
          .select({ status: runs.status })
          .from(runs)
          .where(eq(runs.id, id))
          .limit(1);

        if (
          current?.status === "completed" ||
          current?.status === "failed" ||
          current?.status === "partial"
        ) {
          closed = true;
          clearInterval(pingInterval);
          clearInterval(pollInterval);
          removeListener(id, listener);
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({ status: current.status }),
          });
          stream.close();
        }
      } catch {
        // DB error during poll — ignore, keep streaming
      }
    }, 2_000);

    // Clean up if the client disconnects
    stream.onAbort(() => {
      closed = true;
      clearInterval(pingInterval);
      clearInterval(pollInterval);
      removeListener(id, listener);
    });

    // Keep the stream open until closed by poll or abort
    await stream.sleep(Infinity);
  });
});

// ------------------------------------------------------------------
// POST /api/v1/runs/:id/resume — resume an interrupted run (202)
// ------------------------------------------------------------------
runsRouter.post("/:id/resume", async (c) => {
  const id = c.req.param("id");

  // Verify run exists
  const [row] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  if (!row) return c.json({ error: `Run ${id} not found` }, 404);

  if (row.status === "completed") {
    return c.json({ message: "Run is already completed" }, 200);
  }

  // Fire resume in background
  resumeRun(id, {
    onProgress: (caseResult, completed, total) =>
      notifyListeners(id, caseResult, completed, total),
  }).catch((err: unknown) =>
    console.error(`[runs route] Resume error runId=${id}:`, err),
  );

  return c.json({ runId: id }, 202);
});
