"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { RunSummary, PromptStrategy } from "@test-evals/shared";
import { api } from "@/lib/api";
import RunStatusBadge from "@/components/RunStatusBadge";
import ScoreBar from "@/components/ScoreBar";
import {
  Plus,
  Zap,
  BookOpen,
  BrainCircuit,
  FlaskConical,
  TrendingUp,
  DollarSign,
  Database,
  Rocket,
  X,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STRATEGY_META: Record<
  PromptStrategy,
  { label: string; desc: string; icon: typeof Zap; chipClass: string }
> = {
  zero_shot: {
    label: "Zero Shot",
    desc: "Direct extraction, no examples",
    icon: Zap,
    chipClass: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  },
  few_shot: {
    label: "Few Shot",
    desc: "Guided by 2–3 examples",
    icon: BookOpen,
    chipClass: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  },
  cot: {
    label: "Chain of Thought",
    desc: "Thinks step by step first",
    icon: BrainCircuit,
    chipClass: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  },
};

const MODELS = [
  {
    value: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant",
    provider: "Groq",
    badge: "Fast",
    badgeClass: "bg-emerald-500/15 text-emerald-400",
  },
  {
    value: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B Versatile",
    provider: "Groq",
    badge: "Best",
    badgeClass: "bg-blue-500/15 text-blue-400",
  },
  {
    value: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    provider: "Anthropic",
    badge: "Premium",
    badgeClass: "bg-purple-500/15 text-purple-400",
  },
];

function fmtCost(n: number) {
  return n === 0 ? "—" : `$${n.toFixed(4)}`;
}

function fmtCacheHit(rate: number) {
  return rate === 0 ? "—" : `${Math.round(rate * 100)}%`;
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Loading Skeleton ──────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/[0.06] dark:bg-[#111]">
      {/* Skeleton header */}
      <div className="border-b border-slate-200 px-4 py-3 dark:border-white/[0.06]">
        <div className="flex gap-8">
          {[80, 120, 60, 100, 50, 60, 40, 70].map((w, i) => (
            <div
              key={i}
              className="animate-shimmer h-3 rounded"
              style={{ width: w }}
            />
          ))}
        </div>
      </div>
      {/* Skeleton rows */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-8 border-b border-slate-100 px-4 py-4 dark:border-white/[0.03]"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="animate-shimmer h-5 w-20 rounded-full" />
          <div className="animate-shimmer h-4 w-32 rounded" />
          <div className="animate-shimmer h-5 w-20 rounded-full" />
          <div className="animate-shimmer h-2 w-24 rounded-full" />
          <div className="animate-shimmer h-4 w-14 rounded" />
          <div className="animate-shimmer h-4 w-10 rounded" />
          <div className="animate-shimmer h-4 w-12 rounded" />
          <div className="animate-shimmer h-4 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ onNewRun }: { onNewRun: () => void }) {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/50 py-20 dark:border-white/[0.08] dark:bg-[#111]/50">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 shadow-lg shadow-blue-500/10">
        <FlaskConical className="h-8 w-8 text-blue-400" />
      </div>
      <h3 className="mb-1 text-lg font-semibold text-slate-800 dark:text-slate-200">
        No eval runs yet
      </h3>
      <p className="mb-6 text-sm text-slate-500">
        Start your first evaluation to benchmark LLM strategies
      </p>
      <button
        onClick={onNewRun}
        className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/25 transition-all hover:shadow-blue-500/40 hover:brightness-110"
      >
        <Rocket className="h-4 w-4" />
        Start your first run
      </button>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-white/[0.06] dark:bg-[#111] dark:shadow-none">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-white/[0.04]">
        <Icon className={`h-4 w-4 ${accent ?? "text-slate-400"}`} />
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className={`text-lg font-bold tabular-nums ${accent ?? "text-slate-200"}`}>
          {value}
        </p>
      </div>
    </div>
  );
}

// ── Strategy Chip ─────────────────────────────────────────────────────────────

function StrategyChip({ strategy }: { strategy: PromptStrategy }) {
  const meta = STRATEGY_META[strategy];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.chipClass}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="animate-scale-in w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/[0.08] dark:bg-[#111]">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20">
              <FlaskConical className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                New Eval Run
              </h2>
              <p className="text-xs text-slate-500">
                Configure and start an evaluation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-white/[0.06] dark:hover:text-slate-300"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Strategy — card buttons */}
          <div>
            <label className="mb-2.5 block text-sm font-medium text-slate-400">
              Prompt Strategy
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(STRATEGY_META) as PromptStrategy[]).map((s) => {
                const meta = STRATEGY_META[s];
                const Icon = meta.icon;
                const isActive = strategy === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStrategy(s)}
                    className={`group relative flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all ${
                      isActive
                        ? "border-blue-500/50 bg-blue-500/10 shadow-sm shadow-blue-500/10"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100 dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.12] dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 transition-colors ${
                        isActive ? "text-blue-400" : "text-slate-500 group-hover:text-slate-400"
                      }`}
                    />
                    <span
                      className={`text-xs font-semibold ${
                        isActive ? "text-blue-600 dark:text-blue-300" : "text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-[10px] leading-tight text-slate-500">
                      {meta.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model — radio cards */}
          <div>
            <label className="mb-2.5 block text-sm font-medium text-slate-400">
              Model
            </label>
            <div className="space-y-2">
              {MODELS.map((m) => {
                const isActive = model === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setModel(m.value)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                      isActive
                        ? "border-blue-500/50 bg-blue-500/10"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100 dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.12] dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    {/* Radio circle */}
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        isActive
                          ? "border-blue-500 bg-blue-500"
                          : "border-slate-600"
                      }`}
                    >
                      {isActive && (
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </div>
                    {/* Info */}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        {m.label}
                      </p>
                      <p className="text-xs text-slate-500">{m.provider}</p>
                    </div>
                    {/* Badge */}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.badgeClass}`}
                    >
                      {m.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dataset filter */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-400">
              Dataset filter{" "}
              <span className="font-normal text-slate-600">
                (optional, comma-separated)
              </span>
            </label>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="case_001, case_002, …"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/20 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-100 dark:placeholder-slate-600"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-sm font-medium text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              id="submit-new-run"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-all hover:shadow-blue-500/40 hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Starting…
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4" />
                  Start Run
                </>
              )}
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

  // ── Derived stats ──────────────────────────────────────────────────────────
  const bestF1 = runs.length > 0
    ? Math.max(...runs.map((r) => r.aggregateF1))
    : 0;
  const totalCost = runs.reduce((s, r) => s + r.totalCostUsd, 0);
  const avgCacheHit = runs.length > 0
    ? runs.reduce((s, r) => s + r.cacheHitRate, 0) / runs.length
    : 0;

  return (
    <>
      <NewRunModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <div className="page-gradient">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* ── Hero header ─────────────────────────────────────────── */}
        <div className="animate-fade-in mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-gradient-blue-purple text-3xl font-bold tracking-tight">
                Eval Runs
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Track and compare LLM prompt strategies across clinical
                extraction benchmarks
              </p>
            </div>
            <button
              id="new-run-btn"
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-all hover:shadow-blue-500/40 hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              New Run
            </button>
          </div>

          {/* ── Stats row ──────────────────────────────────────────── */}
          {!loading && runs.length > 0 && (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                icon={Database}
                label="Total Runs"
                value={runs.length}
                accent="text-blue-400"
              />
              <StatCard
                icon={TrendingUp}
                label="Best F1"
                value={bestF1 > 0 ? `${Math.round(bestF1 * 100)}%` : "—"}
                accent="text-emerald-400"
              />
              <StatCard
                icon={DollarSign}
                label="Total Cost"
                value={totalCost > 0 ? `$${totalCost.toFixed(4)}` : "—"}
                accent="text-green-400"
              />
              <StatCard
                icon={Zap}
                label="Avg Cache Hit"
                value={avgCacheHit > 0 ? `${Math.round(avgCacheHit * 100)}%` : "—"}
                accent="text-purple-400"
              />
            </div>
          )}
        </div>

        {/* ── Hint ────────────────────────────────────────────────── */}
        {runs.length >= 2 && (
          <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500 dark:border-white/[0.04] dark:bg-white/[0.02]">
            💡 <strong className="text-slate-400">Tip:</strong> Select two runs
            and go to{" "}
            <span className="font-mono text-slate-400">
              /runs/compare?a=ID&amp;b=ID
            </span>{" "}
            to compare them side-by-side
          </p>
        )}

        {/* ── Content ─────────────────────────────────────────────── */}
        {loading ? (
          <TableSkeleton />
        ) : runs.length === 0 ? (
          <EmptyState onNewRun={() => setModalOpen(true)} />
        ) : (
          <div className="animate-fade-in overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.06] dark:bg-[#111] dark:shadow-none">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 dark:border-white/[0.06] dark:bg-[#111]">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3.5">Strategy</th>
                  <th className="px-4 py-3.5">Model</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Overall F1</th>
                  <th className="px-4 py-3.5">Cost</th>
                  <th className="px-4 py-3.5">Cache Hit</th>
                  <th className="px-4 py-3.5">Cases</th>
                  <th className="px-4 py-3.5">Created</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run, i) => (
                  <tr
                    key={run.id}
                    onClick={() => router.push(`/runs/${run.id}`)}
                    className={`cursor-pointer border-b border-slate-100 transition-all hover:bg-slate-50 dark:border-white/[0.03] dark:hover:bg-white/[0.04] ${
                      i % 2 === 1 ? "bg-slate-50/50 dark:bg-white/[0.01]" : ""
                    }`}
                  >
                    {/* Strategy chip */}
                    <td className="px-4 py-3.5">
                      <StrategyChip strategy={run.strategy} />
                    </td>
                    {/* Model */}
                    <td className="max-w-[180px] truncate px-4 py-3.5 font-mono text-xs text-slate-400">
                      {run.model}
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <RunStatusBadge status={run.status} />
                    </td>
                    {/* Overall F1 */}
                    <td className="px-4 py-3.5">
                      {run.aggregateF1 > 0 ? (
                        <ScoreBar score={run.aggregateF1} />
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    {/* Cost */}
                    <td className="px-4 py-3.5 font-mono text-xs tabular-nums text-green-400">
                      {fmtCost(run.totalCostUsd)}
                    </td>
                    {/* Cache hit */}
                    <td className="px-4 py-3.5 text-xs tabular-nums text-slate-400">
                      {fmtCacheHit(run.cacheHitRate)}
                    </td>
                    {/* Cases */}
                    <td className="px-4 py-3.5 text-xs tabular-nums text-slate-400">
                      <span className="text-slate-800 dark:text-slate-200">{run.completedCases}</span>
                      <span className="text-slate-400 dark:text-slate-600">/{run.totalCases}</span>
                    </td>
                    {/* Created */}
                    <td className="px-4 py-3.5 text-xs text-slate-500">
                      {fmtDate(run.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Auto-refresh indicator ──────────────────────────────── */}
        {runs.length > 0 && (
          <p className="mt-3 text-right text-[11px] text-slate-600">
            Auto-refreshes every 10s
          </p>
        )}
      </div>
      </div>
    </>
  );
}
