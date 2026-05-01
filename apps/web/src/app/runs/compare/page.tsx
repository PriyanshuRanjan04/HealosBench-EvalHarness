"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RunSummary } from "@test-evals/shared";
import { api } from "@/lib/api";

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

// ── Field display config ──────────────────────────────────────────────────────

const FIELDS: Array<{ key: string; label: string; separator?: boolean }> = [
  { key: "chief_complaint",  label: "Chief Complaint" },
  { key: "vitals",           label: "Vitals" },
  { key: "medications.f1",   label: "Medications F1" },
  { key: "diagnoses.f1",     label: "Diagnoses F1" },
  { key: "plan.f1",          label: "Plan F1" },
  { key: "follow_up",        label: "Follow-up" },
  { key: "overall",          label: "Overall F1", separator: true },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(n: number) {
  return (n * 100).toFixed(1) + "%";
}
function fmtScore(n: number) {
  return n.toFixed(3);
}
function fmtCost(n: number) {
  return `$${n.toFixed(4)}`;
}
function fmtDuration(ms: number) {
  if (!ms || ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
function fmtDate(d: Date | string) {
  return new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Run selector ──────────────────────────────────────────────────────────────

function RunSelector({
  runs,
  label,
  value,
  onChange,
  highlightId,
}: {
  runs: RunSummary[];
  label: string;
  value: string;
  onChange: (id: string) => void;
  highlightId?: string;
}) {
  return (
    <div className="flex-1">
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none ${
          value && value === highlightId
            ? "border-blue-500 bg-blue-500/10 text-blue-200 focus:border-blue-400"
            : "border-zinc-700 bg-zinc-800 text-zinc-100 focus:border-zinc-500"
        }`}
      >
        <option value="">— select a run —</option>
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {r.strategy.replace(/_/g, " ")} · {r.model.split("-").slice(0, 3).join("-")} ·{" "}
            F1 {r.aggregateF1 > 0 ? pct(r.aggregateF1) : "n/a"} · {fmtDate(r.createdAt)}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Winner badge ──────────────────────────────────────────────────────────────

function WinnerBadge({ winner, side }: { winner: "a" | "b" | "tie"; side: "a" | "b" }) {
  if (winner === "tie") {
    return <span className="text-xs text-zinc-500">tie</span>;
  }
  if (winner === side) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
        {side.toUpperCase()} ✓
      </span>
    );
  }
  return <span className="text-xs text-zinc-600">—</span>;
}

// ── Delta chip ────────────────────────────────────────────────────────────────

function DeltaChip({ delta, winner }: { delta: number; winner: "a" | "b" | "tie" }) {
  const sign = delta > 0 ? "+" : "";
  const colorClass =
    winner === "tie"
      ? "text-zinc-500"
      : delta > 0
        ? "text-emerald-400"
        : "text-red-400";
  return (
    <span className={`tabular-nums text-xs font-medium ${colorClass}`}>
      {sign}{(delta * 100).toFixed(1)}pp
    </span>
  );
}

// ── Field delta table ─────────────────────────────────────────────────────────

function DeltaTable({
  result,
}: {
  result: CompareResult;
}) {
  const { runA, runB, fieldDeltas } = result;
  const overallWinner = fieldDeltas["overall"]?.winner;

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-800 bg-zinc-900/70">
          <tr className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            <th className="px-4 py-3 text-left">Field</th>
            <th
              className={`px-4 py-3 text-right ${
                overallWinner === "a" ? "text-blue-300" : ""
              }`}
            >
              Run A — {runA.strategy.replace(/_/g, " ")}
              {overallWinner === "a" && " 🏆"}
            </th>
            <th
              className={`px-4 py-3 text-right ${
                overallWinner === "b" ? "text-orange-300" : ""
              }`}
            >
              Run B — {runB.strategy.replace(/_/g, " ")}
              {overallWinner === "b" && " 🏆"}
            </th>
            <th className="px-4 py-3 text-right">Delta (B−A)</th>
            <th className="px-4 py-3 text-center">Winner</th>
          </tr>
        </thead>
        <tbody>
          {FIELDS.map(({ key, label, separator }) => {
            const d = fieldDeltas[key];
            if (!d) return null;
            const isOverall = key === "overall";
            return (
              <tr
                key={key}
                className={`border-b transition-colors ${
                  isOverall
                    ? "border-zinc-600 bg-zinc-800/30 font-semibold"
                    : "border-zinc-800/50 hover:bg-zinc-800/20"
                }`}
              >
                {separator && (
                  <td colSpan={5} className="h-px bg-zinc-700 p-0" />
                )}
                <td className="px-4 py-3 text-zinc-200">
                  {label}
                  {isOverall && (
                    <span className="ml-2 text-xs font-normal text-zinc-500">avg</span>
                  )}
                </td>
                {/* Run A score */}
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    d.winner === "a" ? "text-blue-300" : "text-zinc-300"
                  }`}
                >
                  {fmtScore(d.a)}
                </td>
                {/* Run B score */}
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    d.winner === "b" ? "text-orange-300" : "text-zinc-300"
                  }`}
                >
                  {fmtScore(d.b)}
                </td>
                {/* Delta */}
                <td className="px-4 py-3 text-right">
                  <DeltaChip delta={d.delta} winner={d.winner} />
                </td>
                {/* Winner */}
                <td className="px-4 py-3 text-center">
                  <WinnerBadge winner={d.winner} side="a" />
                  {d.winner !== "tie" && (
                    <WinnerBadge winner={d.winner} side="b" />
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

// ── Stats cards ───────────────────────────────────────────────────────────────

function StatsCard({
  run,
  label,
  accentClass,
  winnerFields,
}: {
  run: RunSummary;
  label: string;
  accentClass: string;
  winnerFields: number;
}) {
  return (
    <div className={`flex-1 rounded-xl border p-5 ${accentClass}`}>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-200">{label}</span>
        <span className="rounded-full bg-zinc-700/50 px-2.5 py-0.5 text-xs text-zinc-400">
          {winnerFields} field{winnerFields !== 1 ? "s" : ""} won
        </span>
      </div>
      <div className="space-y-2 text-sm">
        {[
          { label: "Strategy",    value: run.strategy.replace(/_/g, " ") },
          { label: "Model",       value: run.model },
          { label: "Cost",        value: fmtCost(run.totalCostUsd) },
          { label: "Cache hit",   value: run.cacheHitRate > 0 ? pct(run.cacheHitRate) : "—" },
          { label: "Wall time",   value: fmtDuration(run.wallTimeMs) },
          { label: "Cases done",  value: `${run.completedCases}/${run.totalCases}` },
          { label: "Prompt hash", value: run.promptHash.slice(0, 12) + "…" },
        ].map(({ label: l, value: v }) => (
          <div key={l} className="flex justify-between gap-4">
            <span className="text-zinc-500">{l}</span>
            <span className="truncate text-right font-mono text-xs text-zinc-300">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

function BarChart({ result }: { result: CompareResult }) {
  const { runA, runB, fieldDeltas } = result;

  const chartFields = FIELDS.filter((f) => f.key !== "overall");

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-4 flex items-center gap-6">
        <h3 className="text-sm font-semibold text-zinc-200">Field F1 Comparison</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm bg-blue-500" />
            <span className="text-xs text-zinc-400">Run A — {runA.strategy.replace(/_/g, " ")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm bg-orange-500" />
            <span className="text-xs text-zinc-400">Run B — {runB.strategy.replace(/_/g, " ")}</span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {chartFields.map(({ key, label }) => {
          const d = fieldDeltas[key];
          if (!d) return null;
          const aWidth = Math.round(d.a * 100);
          const bWidth = Math.round(d.b * 100);
          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-zinc-400">{label}</span>
                <span className="tabular-nums text-zinc-500">
                  A: {pct(d.a)} · B: {pct(d.b)}
                </span>
              </div>
              {/* Run A bar */}
              <div className="mb-0.5 flex items-center gap-2">
                <span className="w-4 text-right text-xs text-zinc-600">A</span>
                <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-zinc-800">
                  <div
                    className={`h-full rounded-sm transition-all duration-700 ${
                      d.winner === "a" ? "bg-blue-500" : "bg-blue-500/50"
                    }`}
                    style={{ width: `${aWidth}%` }}
                  />
                  <span className="absolute right-2 top-0 flex h-full items-center text-xs tabular-nums text-zinc-300">
                    {pct(d.a)}
                  </span>
                </div>
              </div>
              {/* Run B bar */}
              <div className="flex items-center gap-2">
                <span className="w-4 text-right text-xs text-zinc-600">B</span>
                <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-zinc-800">
                  <div
                    className={`h-full rounded-sm transition-all duration-700 ${
                      d.winner === "b" ? "bg-orange-500" : "bg-orange-500/50"
                    }`}
                    style={{ width: `${bWidth}%` }}
                  />
                  <span className="absolute right-2 top-0 flex h-full items-center text-xs tabular-nums text-zinc-300">
                    {pct(d.b)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Overall — full-width highlighted */}
        {fieldDeltas["overall"] && (() => {
          const d = fieldDeltas["overall"];
          return (
            <div className="mt-2 border-t border-zinc-700 pt-4">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-200">Overall F1</span>
                <span className="tabular-nums text-zinc-400">
                  A: {pct(d.a)} · B: {pct(d.b)}
                </span>
              </div>
              <div className="mb-0.5 flex items-center gap-2">
                <span className="w-4 text-right text-xs text-zinc-600">A</span>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-zinc-800">
                  <div
                    className={`h-full rounded transition-all duration-700 ${
                      d.winner === "a" ? "bg-blue-500" : "bg-blue-500/50"
                    }`}
                    style={{ width: `${Math.round(d.a * 100)}%` }}
                  />
                  <span className="absolute right-2 top-0 flex h-full items-center text-xs font-semibold tabular-nums text-zinc-200">
                    {pct(d.a)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 text-right text-xs text-zinc-600">B</span>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-zinc-800">
                  <div
                    className={`h-full rounded transition-all duration-700 ${
                      d.winner === "b" ? "bg-orange-500" : "bg-orange-500/50"
                    }`}
                    style={{ width: `${Math.round(d.b * 100)}%` }}
                  />
                  <span className="absolute right-2 top-0 flex h-full items-center text-xs font-semibold tabular-nums text-zinc-200">
                    {pct(d.b)}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Inner page (uses useSearchParams — must be inside Suspense) ───────────────

function ComparePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runIdA, setRunIdA] = useState(searchParams.get("a") ?? "");
  const [runIdB, setRunIdB] = useState(searchParams.get("b") ?? "");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load runs list for dropdowns
  useEffect(() => {
    api.getRuns().then(setRuns).catch(() => null);
  }, []);

  // Auto-compare when both IDs are in URL
  const urlA = searchParams.get("a") ?? "";
  const urlB = searchParams.get("b") ?? "";

  const fetchCompare = useCallback(
    async (a: string, b: string) => {
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
    },
    [],
  );

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

  // ── Win counts ──────────────────────────────────────────────────────────────

  const winsA = result
    ? Object.values(result.fieldDeltas).filter((d) => d.winner === "a").length
    : 0;
  const winsB = result
    ? Object.values(result.fieldDeltas).filter((d) => d.winner === "b").length
    : 0;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Page header */}
      <div className="mb-6">
        <button
          onClick={() => router.push("/")}
          className="mb-3 text-sm text-zinc-500 hover:text-zinc-300"
        >
          ← All runs
        </button>
        <h1 className="text-2xl font-bold text-zinc-100">Compare Runs</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Per-field score deltas — see which strategy wins on which fields
        </p>
      </div>

      {/* Run selectors */}
      <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <RunSelector
            runs={runs}
            label="Run A"
            value={runIdA}
            onChange={setRunIdA}
            highlightId={runIdA}
          />
          <div className="flex h-9 items-center text-zinc-600">vs</div>
          <RunSelector
            runs={runs}
            label="Run B"
            value={runIdB}
            onChange={setRunIdB}
            highlightId={runIdB}
          />
          <button
            id="compare-submit-btn"
            onClick={handleCompare}
            disabled={!runIdA || !runIdB || loading}
            className="h-9 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {loading ? "Loading…" : "Compare"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-700/30 bg-red-900/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 text-zinc-500">
          <p>Select two runs above to compare them</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex h-48 items-center justify-center text-zinc-500">
          Loading comparison…
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-6">
          {/* Win summary banner */}
          <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4">
            <div className="flex-1 text-center">
              <p className="text-3xl font-bold text-blue-400">{winsA}</p>
              <p className="text-xs text-zinc-500">
                fields won by Run A ({result.runA.strategy.replace(/_/g, " ")})
              </p>
            </div>
            <div className="h-10 w-px bg-zinc-700" />
            <div className="flex-1 text-center">
              <p className="text-3xl font-bold text-zinc-500">
                {Object.values(result.fieldDeltas).filter((d) => d.winner === "tie").length}
              </p>
              <p className="text-xs text-zinc-500">ties</p>
            </div>
            <div className="h-10 w-px bg-zinc-700" />
            <div className="flex-1 text-center">
              <p className="text-3xl font-bold text-orange-400">{winsB}</p>
              <p className="text-xs text-zinc-500">
                fields won by Run B ({result.runB.strategy.replace(/_/g, " ")})
              </p>
            </div>
          </div>

          {/* Delta table */}
          <DeltaTable result={result} />

          {/* Stats cards */}
          <div className="flex gap-4">
            <StatsCard
              run={result.runA}
              label="Run A"
              accentClass="border-blue-800/40 bg-blue-950/20"
              winnerFields={winsA}
            />
            <StatsCard
              run={result.runB}
              label="Run B"
              accentClass="border-orange-800/40 bg-orange-950/20"
              winnerFields={winsB}
            />
          </div>

          {/* Bar chart */}
          <BarChart result={result} />
        </div>
      )}
    </div>
  );
}

// ── Page export (Suspense boundary required for useSearchParams) ──────────────

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-zinc-500">
          Loading…
        </div>
      }
    >
      <ComparePageInner />
    </Suspense>
  );
}
