"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { RunSummary, PromptStrategy } from "@test-evals/shared";
import { api } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STRATEGIES: PromptStrategy[] = ["zero_shot", "few_shot", "cot"];
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const GROQ_MODEL = "llama-3.3-70b-versatile";

function statusColor(s: RunSummary["status"]) {
  switch (s) {
    case "completed": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "running":   return "bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse";
    case "partial":   return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "failed":    return "bg-red-500/15 text-red-400 border-red-500/30";
    default:          return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  }
}

function f1Bar(value: number) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-zinc-300">{pct}%</span>
    </div>
  );
}

function fmt(n: number, dec = 4) { return n.toFixed(dec); }
function fmtCost(n: number) { return `$${n.toFixed(4)}`; }
function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
function fmtDate(d: Date | string) {
  return new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── New Run Modal ─────────────────────────────────────────────────────────────

function NewRunModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [strategy, setStrategy] = useState<PromptStrategy>("zero_shot");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { runId } = await api.startRun({ strategy, model });
      toast.success(`Run started — ${runId.slice(0, 8)}…`);
      onCreated(runId);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <h2 className="mb-5 text-lg font-semibold text-zinc-100">New Eval Run</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Strategy */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-400">Strategy</label>
            <div className="flex gap-2">
              {STRATEGIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStrategy(s)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    strategy === s
                      ? "border-indigo-500 bg-indigo-500/20 text-indigo-300"
                      : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500"
                  }`}
                >
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-400">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
            >
              <option value={DEFAULT_MODEL}>claude-haiku-4-5 (Anthropic)</option>
              <option value={GROQ_MODEL}>llama-3.3-70b (Groq)</option>
              <option value="mixtral-8x7b-32768">mixtral-8x7b (Groq)</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
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
              className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {loading ? "Starting…" : "Start Run"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function RunsDashboard() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchRuns = useCallback(async () => {
    try {
      const data = await api.listRuns();
      setRuns(data);
    } catch {
      toast.error("Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRuns();
    const interval = setInterval(fetchRuns, 5000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      else {
        toast.info("Select at most 2 runs to compare");
      }
      return next;
    });
  }

  const selectedArr = [...selected];
  const compareHref =
    selectedArr.length === 2
      ? `/runs/compare?a=${selectedArr[0]}&b=${selectedArr[1]}`
      : null;

  return (
    <>
      <NewRunModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => void fetchRuns()}
      />

      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header row */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Eval Runs</h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              {runs.length} run{runs.length !== 1 ? "s" : ""} · auto-refreshes every 5s
            </p>
          </div>
          <div className="flex gap-3">
            {compareHref && (
              <Link
                href={compareHref}
                className="rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-4 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/20"
              >
                Compare ({selectedArr.length}/2)
              </Link>
            )}
            <button
              id="new-run-btn"
              onClick={() => setModalOpen(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              + New Run
            </button>
          </div>
        </div>

        {/* Hint */}
        {runs.length > 0 && selected.size < 2 && (
          <p className="mb-3 text-xs text-zinc-600">
            ✓ Click a row to select it for comparison (pick 2)
          </p>
        )}

        {/* Table */}
        {loading ? (
          <div className="flex h-48 items-center justify-center text-zinc-500">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-700 text-zinc-500">
            <p>No runs yet</p>
            <button
              onClick={() => setModalOpen(true)}
              className="text-sm text-indigo-400 hover:underline"
            >
              Start your first run →
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/80">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                  <th className="w-8 px-4 py-3" />
                  <th className="px-4 py-3">Strategy</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3">F1</th>
                  <th className="px-4 py-3">Cost</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {runs.map((run) => {
                  const isSel = selected.has(run.id);
                  return (
                    <tr
                      key={run.id}
                      onClick={() => toggleSelect(run.id)}
                      className={`cursor-pointer transition-colors ${
                        isSel
                          ? "bg-indigo-500/10 hover:bg-indigo-500/15"
                          : "hover:bg-zinc-800/40"
                      }`}
                    >
                      {/* Select checkbox */}
                      <td className="px-4 py-3">
                        <div
                          className={`h-4 w-4 rounded border ${
                            isSel
                              ? "border-indigo-500 bg-indigo-500"
                              : "border-zinc-600"
                          }`}
                        />
                      </td>

                      {/* Strategy */}
                      <td className="px-4 py-3 font-mono text-xs text-zinc-200">
                        {run.strategy.replace("_", " ")}
                      </td>

                      {/* Model */}
                      <td className="max-w-[160px] truncate px-4 py-3 text-xs text-zinc-400">
                        {run.model}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColor(run.status)}`}>
                          {run.status}
                        </span>
                      </td>

                      {/* Progress */}
                      <td className="px-4 py-3 text-xs tabular-nums text-zinc-400">
                        {run.completedCases}/{run.totalCases}
                      </td>

                      {/* F1 */}
                      <td className="px-4 py-3">
                        {run.aggregateF1 > 0 ? f1Bar(run.aggregateF1) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>

                      {/* Cost */}
                      <td className="px-4 py-3 text-xs tabular-nums text-zinc-400">
                        {run.totalCostUsd > 0 ? fmtCost(run.totalCostUsd) : "—"}
                      </td>

                      {/* Duration */}
                      <td className="px-4 py-3 text-xs tabular-nums text-zinc-400">
                        {run.wallTimeMs > 0 ? fmtDuration(run.wallTimeMs) : "—"}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {fmtDate(run.createdAt)}
                      </td>

                      {/* Detail link */}
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/runs/${run.id}`}
                          className="text-xs text-indigo-400 hover:underline"
                        >
                          Detail →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
