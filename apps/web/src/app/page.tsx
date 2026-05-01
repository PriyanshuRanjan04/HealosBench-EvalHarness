"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { RunSummary, PromptStrategy } from "@test-evals/shared";
import { api } from "@/lib/api";
import RunStatusBadge from "@/components/RunStatusBadge";
import ScoreBar from "@/components/ScoreBar";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STRATEGIES: PromptStrategy[] = ["zero_shot", "few_shot", "cot"];

const MODELS = [
  { value: "llama-3.1-8b-instant",     label: "llama-3.1-8b-instant (Groq — Fast)" },
  { value: "llama-3.3-70b-versatile",  label: "llama-3.3-70b-versatile (Groq — Best)" },
  { value: "claude-haiku-4-5-20251001", label: "claude-haiku-4-5-20251001 (Anthropic)" },
];

function fmtCost(n: number) {
  return n === 0 ? "—" : `$${n.toFixed(4)}`;
}

function fmtCacheHit(rate: number) {
  return rate === 0 ? "—" : `${Math.round(rate * 100)}%`;
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── New Run Modal ─────────────────────────────────────────────────────────────

function NewRunModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [strategy, setStrategy] = useState<PromptStrategy>("zero_shot");
  const [model, setModel] = useState(MODELS[0]!.value);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const dataset_filter = filter.trim()
        ? filter.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      const { runId } = await api.createRun({ strategy, model, dataset_filter });
      onClose();
      router.push(`/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Eval Run</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Strategy */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-400">
              Strategy
            </label>
            <div className="flex gap-2">
              {STRATEGIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStrategy(s)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    strategy === s
                      ? "border-blue-500 bg-blue-500/20 text-blue-300"
                      : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500"
                  }`}
                >
                  {s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-400">
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
            >
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Dataset filter */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-400">
              Dataset filter{" "}
              <span className="font-normal text-zinc-600">(optional, comma-separated case IDs)</span>
            </label>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="case_001, case_002, …"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 py-2 text-sm text-zinc-400 hover:bg-zinc-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              id="submit-new-run"
              className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "Starting…" : "Start Run"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const data = await api.getRuns();
      setRuns(data);
    } catch {
      // ignore — will retry on next interval
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRuns();
    intervalRef.current = setInterval(() => void fetchRuns(), 10_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchRuns]);

  return (
    <>
      <NewRunModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Page header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Eval Runs</h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              {runs.length} run{runs.length !== 1 ? "s" : ""} · auto-refreshes every 10s
            </p>
          </div>
          <button
            id="new-run-btn"
            onClick={() => setModalOpen(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            + New Run
          </button>
        </div>

        {/* Hint */}
        {runs.length >= 2 && (
          <p className="mb-3 text-xs text-zinc-600">
            Tip: go to <span className="font-mono">/runs/compare?a=ID&amp;b=ID</span> to compare two runs side-by-side
          </p>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex h-48 items-center justify-center text-zinc-500">
            Loading…
          </div>
        ) : runs.length === 0 ? (
          /* Empty state */
          <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-zinc-700 text-zinc-500">
            <p className="text-base">No runs yet</p>
            <button
              onClick={() => setModalOpen(true)}
              className="text-sm text-blue-400 hover:underline"
            >
              Start your first eval run →
            </button>
          </div>
        ) : (
          /* Runs table */
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/60">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-3">Strategy</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Overall F1</th>
                  <th className="px-4 py-3">Cost</th>
                  <th className="px-4 py-3">Cache Hit %</th>
                  <th className="px-4 py-3">Cases</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => router.push(`/runs/${run.id}`)}
                    className="cursor-pointer transition-colors hover:bg-zinc-800/40"
                  >
                    <td className="px-4 py-3 font-mono text-xs">
                      {run.strategy.replace(/_/g, " ")}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3 text-xs text-zinc-400">
                      {run.model}
                    </td>
                    <td className="px-4 py-3">
                      <RunStatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3">
                      {run.aggregateF1 > 0 ? (
                        <ScoreBar score={run.aggregateF1} />
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-zinc-400">
                      {fmtCost(run.totalCostUsd)}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-zinc-400">
                      {fmtCacheHit(run.cacheHitRate)}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-zinc-400">
                      {run.completedCases}/{run.totalCases}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {fmtDate(run.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
