"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RunSummary } from "@test-evals/shared";
import { api } from "@/lib/api";
import {
  GitCompare,
  ArrowRight,
  Trophy,
  Zap,
  BookOpen,
  BrainCircuit,
  Clock,
  DollarSign,
  Shield,
  AlertTriangle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FieldDelta {
  a: number;
  b: number;
  delta: number;
  winner: "a" | "b" | "tie";
}

interface CompareResult {
  runA: RunSummary;
  runB: RunSummary;
  fieldDeltas: Record<string, FieldDelta>;
}

// ── Config ────────────────────────────────────────────────────────────────────

const FIELDS: Array<{ key: string; label: string }> = [
  { key: "chief_complaint", label: "Chief Complaint" },
  { key: "vitals",          label: "Vitals" },
  { key: "medications.f1",  label: "Medications F1" },
  { key: "diagnoses.f1",    label: "Diagnoses F1" },
  { key: "plan.f1",         label: "Plan F1" },
  { key: "follow_up",       label: "Follow-up" },
  { key: "overall",         label: "Overall F1" },
];

const STRATEGY_ICON: Record<string, typeof Zap> = {
  zero_shot: Zap,
  few_shot: BookOpen,
  cot: BrainCircuit,
};

const STRATEGY_CHIP: Record<string, string> = {
  zero_shot: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  few_shot: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  cot: "bg-amber-500/15 text-amber-400 border-amber-500/25",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(n: number) { return (n * 100).toFixed(1) + "%"; }
function fmtCost(n: number) { return `$${n.toFixed(4)}`; }
function fmtDuration(ms: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
function fmtDate(d: Date | string) {
  return new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function StrategyChip({ strategy }: { strategy: string }) {
  const Icon = STRATEGY_ICON[strategy] ?? Zap;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STRATEGY_CHIP[strategy] ?? STRATEGY_CHIP.zero_shot}`}>
      <Icon className="h-3 w-3" />
      {strategy.replace(/_/g, " ")}
    </span>
  );
}

// ── Mini score bar (inline) ───────────────────────────────────────────────────

function MiniBar({ score, color }: { score: number; color: string }) {
  const w = Math.round(Math.max(0, Math.min(1, score)) * 100);
  return (
    <div className="inline-flex h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.06]">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

// ── Run Selector ──────────────────────────────────────────────────────────────

function RunSelector({ runs, label, value, onChange, accent }: {
  runs: RunSummary[];
  label: string;
  value: string;
  onChange: (id: string) => void;
  accent: string;
}) {
  return (
    <div className="flex-1">
      <label className={`mb-2 block text-xs font-semibold uppercase tracking-wider ${accent}`}>
        {label}
      </label>
      <div className="rounded-xl border border-white/[0.08] bg-[#111111] transition-all focus-within:border-blue-500/40 focus-within:ring-1 focus-within:ring-blue-500/20">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl bg-transparent px-4 py-3 text-sm text-slate-200 focus:outline-none"
        >
          <option value="" className="bg-[#111]">— Select a run —</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id} className="bg-[#111]">
              {r.strategy.replace(/_/g, " ")} · {r.model.split("-").slice(0, 3).join("-")} · F1 {r.aggregateF1 > 0 ? pct(r.aggregateF1) : "n/a"} · {fmtDate(r.createdAt)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Winner Banner ─────────────────────────────────────────────────────────────

function WinnerBanner({ result, winsA, winsB }: { result: CompareResult; winsA: number; winsB: number }) {
  const overall = result.fieldDeltas["overall"];
  if (!overall) return null;

  const isTie = overall.winner === "tie";
  const winnerLabel = overall.winner === "a" ? "Run A" : "Run B";
  const winnerRun = overall.winner === "a" ? result.runA : result.runB;
  const loserRun = overall.winner === "a" ? result.runB : result.runA;
  const deltaPct = Math.abs(overall.delta * 100).toFixed(1);

  return (
    <div className={`animate-fade-in flex items-center gap-4 rounded-xl border p-4 ${
      isTie
        ? "border-white/[0.08] bg-white/[0.03]"
        : "border-emerald-500/20 bg-emerald-500/[0.06]"
    }`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
        isTie ? "bg-white/[0.06]" : "bg-emerald-500/15"
      }`}>
        <Trophy className={`h-5 w-5 ${isTie ? "text-slate-500" : "text-emerald-400"}`} />
      </div>
      <div className="flex-1">
        {isTie ? (
          <p className="text-sm font-medium text-slate-300">It&apos;s a tie — both strategies scored equally overall</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-emerald-300">
              {winnerLabel} wins — {winnerRun.strategy.replace(/_/g, " ")} outperforms{" "}
              {loserRun.strategy.replace(/_/g, " ")} by +{deltaPct}% overall F1
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {winsA} field{winsA !== 1 ? "s" : ""} won by A · {winsB} field{winsB !== 1 ? "s" : ""} won by B
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Delta Table ───────────────────────────────────────────────────────────────

function DeltaTable({ result }: { result: CompareResult }) {
  const { fieldDeltas } = result;
  return (
    <div className="animate-fade-in overflow-x-auto rounded-xl border border-white/[0.06] bg-[#111111]">
      <table className="w-full text-sm">
        <thead className="border-b border-white/[0.06] bg-white/[0.02]">
          <tr className="text-xs font-medium uppercase tracking-wider text-slate-500">
            <th className="px-4 py-3.5 text-left">Field</th>
            <th className="px-4 py-3.5 text-right">Run A</th>
            <th className="px-4 py-3.5 text-right">Run B</th>
            <th className="px-4 py-3.5 text-right">Delta</th>
            <th className="px-4 py-3.5 text-center">Winner</th>
          </tr>
        </thead>
        <tbody>
          {FIELDS.map(({ key, label }) => {
            const d = fieldDeltas[key];
            if (!d) return null;
            const isOverall = key === "overall";
            const sign = d.delta > 0 ? "+" : "";
            return (
              <tr key={key} className={`border-b transition-colors ${
                isOverall
                  ? "border-white/[0.08] bg-white/[0.04] font-semibold"
                  : "border-white/[0.03] hover:bg-white/[0.02]"
              }`}>
                <td className="px-4 py-3 text-slate-200">
                  {isOverall ? <strong>{label}</strong> : label}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <MiniBar score={d.a} color="bg-blue-500" />
                    <span className={`tabular-nums ${d.winner === "a" ? "text-blue-400" : "text-slate-400"}`}>
                      {pct(d.a)}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <MiniBar score={d.b} color="bg-purple-500" />
                    <span className={`tabular-nums ${d.winner === "b" ? "text-purple-400" : "text-slate-400"}`}>
                      {pct(d.b)}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`tabular-nums text-xs font-medium ${
                    d.winner === "tie" ? "text-slate-500" : d.delta > 0 ? "text-emerald-400" : "text-red-400"
                  }`}>
                    {sign}{(d.delta * 100).toFixed(1)}pp
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {d.winner === "tie" ? (
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-slate-500">tie</span>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      d.winner === "a"
                        ? "bg-blue-500/15 text-blue-400"
                        : "bg-purple-500/15 text-purple-400"
                    }`}>
                      {d.winner.toUpperCase()} ✓
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Stats Cards ───────────────────────────────────────────────────────────────

function StatsCards({ result, winsA, winsB }: { result: CompareResult; winsA: number; winsB: number }) {
  const overallWinner = result.fieldDeltas["overall"]?.winner;

  function Card({ run, label, color, isWinner, wins }: {
    run: RunSummary; label: string; color: string; isWinner: boolean; wins: number;
  }) {
    const rows = [
      { icon: Trophy,         l: "F1 Score",      v: run.aggregateF1 > 0 ? pct(run.aggregateF1) : "—" },
      { icon: DollarSign,     l: "Cost",           v: fmtCost(run.totalCostUsd) },
      { icon: Zap,            l: "Cache Hit",      v: run.cacheHitRate > 0 ? pct(run.cacheHitRate) : "—" },
      { icon: AlertTriangle,  l: "Hallucinations", v: String(run.totalHallucinations ?? 0) },
      { icon: Shield,         l: "Schema Valid",    v: `${run.completedCases}/${run.totalCases}` },
      { icon: Clock,          l: "Wall Time",       v: fmtDuration(run.wallTimeMs) },
    ];

    return (
      <div className={`flex-1 rounded-xl border p-5 transition-all ${
        isWinner
          ? "border-emerald-500/30 bg-emerald-500/[0.04] shadow-sm shadow-emerald-500/10"
          : "border-white/[0.06] bg-[#111111]"
      }`}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold ${color}`}>{label}</span>
            <StrategyChip strategy={run.strategy} />
          </div>
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-slate-400">
            {wins} won
          </span>
        </div>
        <p className="mb-3 truncate font-mono text-xs text-slate-500">{run.model}</p>
        <div className="space-y-2.5">
          {rows.map(({ icon: Icon, l, v }) => (
            <div key={l} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-slate-600" />
                <span className="text-xs text-slate-500">{l}</span>
              </div>
              <span className="font-mono text-xs font-medium text-slate-300">{v}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      <Card run={result.runA} label="Run A" color="text-blue-400" isWinner={overallWinner === "a"} wins={winsA} />
      <Card run={result.runB} label="Run B" color="text-purple-400" isWinner={overallWinner === "b"} wins={winsB} />
    </div>
  );
}

// ── Grouped Bar Chart ─────────────────────────────────────────────────────────

function GroupedBarChart({ result }: { result: CompareResult }) {
  const chartFields = FIELDS.filter((f) => f.key !== "overall");

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111111] p-6">
      {/* Legend */}
      <div className="mb-6 flex items-center gap-6">
        <h3 className="text-sm font-semibold text-slate-200">Field Score Comparison</h3>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-blue-500" />
            Run A — {result.runA.strategy.replace(/_/g, " ")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-purple-500" />
            Run B — {result.runB.strategy.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="flex items-end justify-around gap-2" style={{ height: 140 }}>
        {chartFields.map(({ key, label }) => {
          const d = result.fieldDeltas[key];
          if (!d) return null;
          const hA = Math.round(d.a * 120);
          const hB = Math.round(d.b * 120);
          return (
            <div key={key} className="flex flex-col items-center gap-1">
              {/* Bars */}
              <div className="flex items-end gap-1" style={{ height: 120 }}>
                <div className="group relative w-6">
                  <div
                    className="w-full rounded-t bg-blue-500 transition-all duration-700 hover:brightness-125"
                    style={{ height: hA }}
                  />
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] tabular-nums text-blue-300 opacity-0 transition-opacity group-hover:opacity-100">
                    {pct(d.a)}
                  </div>
                </div>
                <div className="group relative w-6">
                  <div
                    className="w-full rounded-t bg-purple-500 transition-all duration-700 hover:brightness-125"
                    style={{ height: hB }}
                  />
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] tabular-nums text-purple-300 opacity-0 transition-opacity group-hover:opacity-100">
                    {pct(d.b)}
                  </div>
                </div>
              </div>
              {/* Label */}
              <span className="max-w-[72px] truncate text-center text-[10px] text-slate-500">
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-[#111111]/50 py-16">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 shadow-lg shadow-blue-500/10">
        <GitCompare className="h-7 w-7 text-blue-400" />
      </div>
      <h3 className="mb-1 text-base font-semibold text-slate-200">
        Select two runs to compare
      </h3>
      <p className="max-w-xs text-center text-sm text-slate-500">
        See exactly which fields each prompt strategy wins on, with per-field deltas and visual charts
      </p>
    </div>
  );
}

// ── Inner Page ────────────────────────────────────────────────────────────────

function ComparePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runIdA, setRunIdA] = useState(searchParams.get("a") ?? "");
  const [runIdB, setRunIdB] = useState(searchParams.get("b") ?? "");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getRuns().then(setRuns).catch(() => null);
  }, []);

  const urlA = searchParams.get("a") ?? "";
  const urlB = searchParams.get("b") ?? "";

  const fetchCompare = useCallback(async (a: string, b: string) => {
    if (!a || !b) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.compareRuns(a, b);
      setResult(data as CompareResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (urlA && urlB) {
      setRunIdA(urlA);
      setRunIdB(urlB);
      void fetchCompare(urlA, urlB);
    }
  }, [urlA, urlB, fetchCompare]);

  function handleCompare() {
    if (!runIdA || !runIdB) return;
    if (runIdA === runIdB) {
      setError("Select two different runs.");
      return;
    }
    const params = new URLSearchParams({ a: runIdA, b: runIdB });
    router.push(`/runs/compare?${params.toString()}`);
  }

  const winsA = result ? Object.values(result.fieldDeltas).filter((d) => d.winner === "a").length : 0;
  const winsB = result ? Object.values(result.fieldDeltas).filter((d) => d.winner === "b").length : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <button onClick={() => router.push("/")} className="mb-3 text-sm text-slate-500 hover:text-slate-300">
          ← All runs
        </button>
        <h1 className="text-gradient-blue-purple text-2xl font-bold tracking-tight">Compare Runs</h1>
        <p className="mt-1 text-sm text-slate-500">
          Per-field score deltas — see which strategy wins on which fields
        </p>
      </div>

      {/* Selector */}
      <div className="mb-8 rounded-xl border border-white/[0.06] bg-[#111111] p-5">
        <div className="flex flex-wrap items-end gap-4">
          <RunSelector runs={runs} label="Run A" value={runIdA} onChange={setRunIdA} accent="text-blue-400" />
          <div className="flex h-11 items-center">
            <span className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-bold tracking-wider text-slate-400">
              VS
            </span>
          </div>
          <RunSelector runs={runs} label="Run B" value={runIdB} onChange={setRunIdB} accent="text-purple-400" />
          <button
            id="compare-submit-btn"
            onClick={handleCompare}
            disabled={!runIdA || !runIdB || loading}
            className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-6 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-all hover:shadow-blue-500/40 hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
          >
            {loading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Loading…
              </>
            ) : (
              <>
                Compare
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Empty / Loading / Results */}
      {!result && !loading && <EmptyState />}
      {loading && (
        <div className="flex h-48 items-center justify-center gap-3 text-slate-500">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
          Loading comparison…
        </div>
      )}

      {result && !loading && (
        <div className="space-y-6">
          <WinnerBanner result={result} winsA={winsA} winsB={winsB} />
          <DeltaTable result={result} />
          <StatsCards result={result} winsA={winsA} winsB={winsB} />
          <GroupedBarChart result={result} />
        </div>
      )}
    </div>
  );
}

// ── Page export ───────────────────────────────────────────────────────────────

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="flex h-64 items-center justify-center gap-3 text-slate-500">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
        Loading…
      </div>
    }>
      <ComparePageInner />
    </Suspense>
  );
}
