"use client";

/**
 * RunProgress.tsx
 *
 * SSE live-progress component for an active eval run.
 * Shown on /runs/[id] when status is "running" or "pending".
 *
 * The Hono SSE endpoint sends two named event types:
 *   event: progress   data: { caseResult, completed, total }
 *   event: done       data: { status }
 *
 * We use addEventListener (not onmessage) because EventSource.onmessage
 * only fires for un-named messages; named events require addEventListener.
 */

import { useState, useEffect, useRef } from "react";
import type { CaseResult } from "@test-evals/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProgressEvent {
  caseResult: CaseResult;
  completed: number;
  total: number;
}

interface LogEntry {
  transcriptId: string;
  overall: number;
  cost: number;
  hallucinations: number;
  timestamp: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCost(n: number) {
  return `$${n.toFixed(4)}`;
}

function estimateTimeRemaining(
  startMs: number,
  completed: number,
  total: number,
): string {
  if (completed === 0 || total === 0) return "estimating…";
  const elapsed = Date.now() - startMs;
  const msPerCase = elapsed / completed;
  const remaining = (total - completed) * msPerCase;
  if (remaining < 1000) return "< 1s";
  if (remaining < 60_000) return `~${Math.round(remaining / 1000)}s`;
  return `~${Math.round(remaining / 60_000)}m`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RunProgress({
  runId,
  initialCompleted = 0,
  initialTotal = 0,
  onDone,
}: {
  runId: string;
  initialCompleted?: number;
  initialTotal?: number;
  onDone: () => void;
}) {
  const [completed, setCompleted] = useState(initialCompleted);
  const [total, setTotal] = useState(initialTotal || 50); // default 50 cases
  const [log, setLog] = useState<LogEntry[]>([]);
  const [costSoFar, setCostSoFar] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startMsRef = useRef(Date.now());
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`${SERVER_URL}/api/v1/runs/${runId}/stream`, {
      withCredentials: true,
    });

    es.onopen = () => setConnected(true);

    // Named event: "progress"
    es.addEventListener("progress", (e: MessageEvent) => {
      try {
        const { caseResult, completed: c, total: t } =
          JSON.parse(e.data) as ProgressEvent;

        setCompleted(c);
        setTotal(t);
        setCostSoFar((prev) => prev + (caseResult.costUsd ?? 0));

        const entry: LogEntry = {
          transcriptId: caseResult.transcriptId,
          overall: caseResult.scores?.overall ?? 0,
          cost: caseResult.costUsd ?? 0,
          hallucinations: caseResult.hallucinations?.length ?? 0,
          timestamp: Date.now(),
        };

        setLog((prev) => {
          const next = [...prev, entry];
          // Keep last 200 entries to avoid unbounded growth
          return next.length > 200 ? next.slice(-200) : next;
        });

        // Auto-scroll log to bottom
        requestAnimationFrame(() => {
          if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
          }
        });
      } catch {
        // Ignore malformed SSE data
      }
    });

    // Named event: "done"
    es.addEventListener("done", () => {
      es.close();
      setConnected(false);
      onDone();
    });

    es.onerror = () => {
      setConnected(false);
      setError("SSE connection lost — results will load when run completes.");
      es.close();
    };

    return () => {
      es.close();
    };
  }, [runId, onDone]);

  // ── Progress bar ─────────────────────────────────────────────────────────────

  const pctComplete = total > 0 ? Math.round((completed / total) * 100) : 0;
  const timeLeft = estimateTimeRemaining(startMsRef.current, completed, total);

  return (
    <div className="mb-6 rounded-xl border border-blue-700/30 bg-blue-950/20 p-4">
      {/* Header row */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${connected ? "animate-pulse bg-blue-400" : "bg-zinc-600"}`}
          />
          <span className="text-sm font-medium text-blue-300">
            {connected ? "Run in progress…" : "Connecting…"}
          </span>
        </div>
        <span className="ml-auto text-sm tabular-nums text-blue-400">
          {completed}/{total} cases
        </span>
        <span className="text-xs text-zinc-500">ETA: {timeLeft}</span>
        <span className="text-xs tabular-nums text-zinc-400">
          Cost so far: {fmtCost(costSoFar)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-500"
          style={{ width: `${pctComplete}%` }}
        />
      </div>

      {/* Error banner */}
      {error && (
        <p className="mb-3 rounded-lg border border-amber-700/30 bg-amber-900/10 px-3 py-2 text-xs text-amber-300">
          ⚠ {error}
        </p>
      )}

      {/* Scrolling case log */}
      <div
        ref={logRef}
        className="h-48 overflow-y-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs"
      >
        {log.length === 0 ? (
          <span className="text-zinc-600">Waiting for first case…</span>
        ) : (
          log.map((entry, i) => {
            const overallPct = Math.round(entry.overall * 100);
            const scoreColor =
              overallPct >= 75
                ? "text-emerald-400"
                : overallPct >= 50
                  ? "text-amber-400"
                  : "text-red-400";
            return (
              <div key={i} className="mb-0.5 flex items-center gap-2 leading-5">
                <span className="text-emerald-500">✓</span>
                <span className="text-zinc-300">{entry.transcriptId}</span>
                <span className="text-zinc-600">—</span>
                <span className={`tabular-nums ${scoreColor}`}>
                  overall: {(entry.overall).toFixed(2)}
                </span>
                <span className="text-zinc-600">—</span>
                <span className="tabular-nums text-zinc-400">
                  cost: {fmtCost(entry.cost)}
                </span>
                <span className="text-zinc-600">—</span>
                <span
                  className={
                    entry.hallucinations > 0 ? "text-red-400" : "text-zinc-500"
                  }
                >
                  {entry.hallucinations} hallucination
                  {entry.hallucinations !== 1 ? "s" : ""}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Stats row below log */}
      {log.length > 0 && (
        <div className="mt-3 flex gap-4 text-xs text-zinc-500">
          <span>
            Avg F1:{" "}
            <span className="text-zinc-300">
              {(
                log.reduce((s, e) => s + e.overall, 0) / log.length
              ).toFixed(3)}
            </span>
          </span>
          <span>
            Total hallucinations:{" "}
            <span className="text-zinc-300">
              {log.reduce((s, e) => s + e.hallucinations, 0)}
            </span>
          </span>
          <span>
            Elapsed:{" "}
            <span className="text-zinc-300">
              {Math.round((Date.now() - startMsRef.current) / 1000)}s
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
