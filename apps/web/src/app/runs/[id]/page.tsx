"use client";

import { use, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { RunDetail, CaseResult, FieldScores, HallucinationFlag, ExtractionSchema } from "@test-evals/shared";
import { api } from "@/lib/api";
import RunStatusBadge from "@/components/RunStatusBadge";
import ScoreBar from "@/components/ScoreBar";
import RunProgress from "@/components/RunProgress";

// ── Small helpers ─────────────────────────────────────────────────────────────

function pct(n: number) { return `${Math.round(n * 100)}%`; }
function fmtCost(n: number) { return `$${n.toFixed(4)}`; }
function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
function f1(s: { f1: number } | number): number {
  return typeof s === "number" ? s : s.f1;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? "text-gray-900 dark:text-zinc-100"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400 dark:text-zinc-500">{sub}</p>}
    </div>
  );
}

// ── Comparison tab ────────────────────────────────────────────────────────────

function fieldClass(score: number): string {
  if (score >= 0.75) return "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700/40 dark:text-emerald-200";
  if (score >  0)   return "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700/40 dark:text-amber-200";
  return "bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-700/30 dark:text-red-300";
}

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700 dark:bg-zinc-950 dark:text-zinc-300">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function ComparisonTab({
  cr,
  scores,
}: {
  cr: CaseResult;
  scores: FieldScores;
}) {
  const fields: Array<{ key: keyof FieldScores; label: string }> = [
    { key: "chief_complaint", label: "Chief Complaint" },
    { key: "vitals",          label: "Vitals" },
    { key: "medications",     label: "Medications" },
    { key: "diagnoses",       label: "Diagnoses" },
    { key: "plan",            label: "Plan" },
    { key: "follow_up",       label: "Follow-up" },
  ];

  return (
    <div className="space-y-3">
      {fields.map(({ key, label }) => {
        const score = f1(scores[key]);
        const cls = fieldClass(score);
        return (
          <div key={key} className={`rounded-lg border p-3 ${cls}`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</span>
              <span className="text-xs tabular-nums opacity-80">{pct(score)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-xs opacity-50">Prediction</p>
                <JsonBlock data={cr.prediction?.[key as keyof ExtractionSchema] ?? null} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Hallucination list ────────────────────────────────────────────────────────

function HallucinationList({ flags }: { flags: HallucinationFlag[] }) {
  if (flags.length === 0) {
    return <p className="text-sm text-zinc-500">No hallucinations detected ✓</p>;
  }
  return (
    <ul className="space-y-2">
      {flags.map((f, i) => (
        <li key={i} className="rounded-lg border border-red-700/40 bg-red-900/20 p-3 text-sm">
          <span className="font-mono text-xs text-red-400">{f.field}</span>
          <span className="mx-2 text-zinc-600">·</span>
          <span className="text-red-200">{f.value}</span>
          <p className="mt-1 text-xs text-red-400/70">{f.reason}</p>
        </li>
      ))}
    </ul>
  );
}

// ── LLM Trace tab ─────────────────────────────────────────────────────────────

function TraceTab({ cr }: { cr: CaseResult }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Token Usage</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Input",       value: cr.tokensInput },
            { label: "Output",      value: cr.tokensOutput },
            { label: "Cache Read",  value: cr.tokensCacheRead },
            { label: "Cache Write", value: cr.tokensCacheWrite },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-lg font-bold text-zinc-200">{value.toLocaleString()}</p>
              <p className="text-xs text-zinc-500">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-center">
          <p className="text-xl font-bold text-zinc-200">{cr.attempts}</p>
          <p className="text-xs text-zinc-500">Attempt{cr.attempts !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-center">
          <p className="text-xl font-bold text-zinc-200">{fmtMs(cr.wallTimeMs)}</p>
          <p className="text-xs text-zinc-500">Wall time</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-center">
          <p className={`text-xl font-bold ${cr.schemaValid ? "text-emerald-400" : "text-red-400"}`}>
            {cr.schemaValid ? "Valid" : "Invalid"}
          </p>
          <p className="text-xs text-zinc-500">Schema</p>
        </div>
      </div>

      {cr.attempts > 1 && (
        <div className="rounded-lg border border-amber-700/30 bg-amber-900/10 p-3 text-sm text-amber-300">
          ⚠ This case required {cr.attempts} attempt{cr.attempts !== 1 ? "s" : ""} — the model self-corrected via retry feedback.
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Hallucinations</p>
        <HallucinationList flags={cr.hallucinations} />
      </div>

      {cr.prediction && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Final Prediction (raw)</p>
          <JsonBlock data={cr.prediction} />
        </div>
      )}
    </div>
  );
}

// ── Expanded case row ─────────────────────────────────────────────────────────

type TabId = "comparison" | "trace" | "hallucinations";

function ExpandedCase({ cr }: { cr: CaseResult }) {
  const [tab, setTab] = useState<TabId>("comparison");

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: "comparison",    label: "Comparison" },
    { id: "trace",         label: "LLM Trace" },
    { id: "hallucinations",label: "Hallucinations", count: cr.hallucinations.length },
  ];

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950">
      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-gray-200 pb-0 dark:border-zinc-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-t px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-300"
                : "text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="rounded-full bg-red-500/20 px-1.5 text-red-400">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "comparison" && <ComparisonTab cr={cr} scores={cr.scores} />}
      {tab === "trace"       && <TraceTab cr={cr} />}
      {tab === "hallucinations" && (
        <div className="space-y-3">
          <HallucinationList flags={cr.hallucinations} />
          {cr.prediction && (
            <>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Prediction</p>
              <JsonBlock data={cr.prediction} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Cases table ───────────────────────────────────────────────────────────────

function CasesTable({ cases }: { cases: CaseResult[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-transparent">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 dark:border-zinc-800 dark:bg-zinc-900/70">
          <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">
            <th className="w-6 px-3 py-3" />
            <th className="px-3 py-3">Case ID</th>
            <th className="px-3 py-3">Chief Complaint</th>
            <th className="px-3 py-3">Vitals</th>
            <th className="px-3 py-3">Meds F1</th>
            <th className="px-3 py-3">Diagnoses F1</th>
            <th className="px-3 py-3">Plan F1</th>
            <th className="px-3 py-3">Overall</th>
            <th className="px-3 py-3">Halluc.</th>
            <th className="px-3 py-3">Valid</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((cr) => {
            const isOpen = expanded.has(cr.transcriptId);
            const { scores } = cr;
            return (
              <>
                <tr
                  key={cr.transcriptId}
                  onClick={() => toggle(cr.transcriptId)}
                  className={`cursor-pointer border-b border-gray-100 transition-colors dark:border-zinc-800/60 ${
                    isOpen ? "bg-blue-50 dark:bg-zinc-800/40" : "hover:bg-gray-50 dark:hover:bg-zinc-800/25"
                  }`}
                >
                  {/* Chevron */}
                  <td className="px-3 py-2.5 text-gray-400 dark:text-zinc-500">
                    <span className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                  </td>
                  {/* Case ID */}
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-600 dark:text-zinc-300">{cr.transcriptId}</td>
                  {/* Chief complaint score */}
                  <td className="px-3 py-2.5">
                    <ScoreBar score={scores.chief_complaint} showLabel={false} />
                  </td>
                  {/* Vitals */}
                  <td className="px-3 py-2.5">
                    <ScoreBar score={scores.vitals} showLabel={false} />
                  </td>
                  {/* Meds F1 */}
                  <td className="px-3 py-2.5 text-xs tabular-nums text-zinc-400">
                    {pct(scores.medications.f1)}
                  </td>
                  {/* Diagnoses F1 */}
                  <td className="px-3 py-2.5 text-xs tabular-nums text-zinc-400">
                    {pct(scores.diagnoses.f1)}
                  </td>
                  {/* Plan F1 */}
                  <td className="px-3 py-2.5 text-xs tabular-nums text-zinc-400">
                    {pct(scores.plan.f1)}
                  </td>
                  {/* Overall */}
                  <td className="px-3 py-2.5">
                    <ScoreBar score={scores.overall} />
                  </td>
                  {/* Hallucinations */}
                  <td className="px-3 py-2.5">
                    {cr.hallucinations.length > 0 ? (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
                        {cr.hallucinations.length}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                  {/* Schema valid */}
                  <td className="px-3 py-2.5">
                    {cr.schemaValid ? (
                      <span className="text-xs text-emerald-500">✓</span>
                    ) : (
                      <span className="text-xs text-red-500">✗</span>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${cr.transcriptId}-expanded`}>
                    <td colSpan={10} className="p-0">
                      <ExpandedCase cr={cr} />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── SSE placeholder (now handled by RunProgress component) ───────────────────
// (removed — RunProgress.tsx owns the EventSource lifecycle)

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);

  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRun = useCallback(async () => {
    try {
      const data = await api.getRun(id);
      setRun(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run");
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Initial fetch only — SSE is handled inside RunProgress
  useEffect(() => {
    void fetchRun();
  }, [fetchRun]);

  // ── Loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-zinc-500">Loading…</div>
    );
  }

  if (error || !run) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-red-400">{error ?? "Run not found"}</p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 text-sm text-blue-400 hover:underline"
        >
          ← Back to runs
        </button>
      </div>
    );
  }

  // ── Derived stats ──────────────────────────────────────────────────────────

  const totalHallucinations = run.cases.reduce(
    (s, c) => s + (c.hallucinations?.length ?? 0), 0
  );
  const schemaFailures = run.cases.filter((c) => !c.schemaValid).length;
  const isLive = run.status === "running" || run.status === "pending";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page-gradient">
    <div className="mx-auto max-w-7xl px-4 py-8">

      {/* Back + header */}
      <div className="mb-6">
        <button
          onClick={() => router.push("/")}
          className="mb-3 text-sm text-gray-500 hover:text-gray-700 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          ← All runs
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-100">Run Detail</h1>
          <RunStatusBadge status={run.status} />
          <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
            {run.strategy.replace(/_/g, " ")}
          </span>
          <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 font-mono text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
            {run.model}
          </span>
        </div>
        <p className="mt-1 font-mono text-xs text-zinc-600">ID: {run.id}</p>
        <p className="font-mono text-xs text-zinc-600">Prompt hash: {run.promptHash}</p>
      </div>

      {/* Live SSE progress (shown only while run is active) */}
      {isLive && (
        <RunProgress
          runId={run.id}
          initialCompleted={run.completedCases}
          initialTotal={run.totalCases}
          onDone={() => void fetchRun()}
        />
      )}

      {/* Stat cards — always visible */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <div className="col-span-2">
          <StatCard
            label="Overall F1"
            value={run.aggregateF1 > 0 ? pct(run.aggregateF1) : "—"}
            accent={
              run.aggregateF1 >= 0.75
                ? "text-emerald-400"
                : run.aggregateF1 >= 0.5
                  ? "text-amber-400"
                  : "text-red-400"
            }
          />
        </div>
        <div className="col-span-2">
          <StatCard
            label="Total Cost"
            value={fmtCost(run.totalCostUsd)}
            sub={`${run.totalTokens.toLocaleString()} tokens`}
          />
        </div>
        <StatCard label="Cache Hit" value={run.cacheHitRate > 0 ? pct(run.cacheHitRate) : "—"} />
        <StatCard
          label="Cases"
          value={`${run.completedCases}/${run.totalCases}`}
          sub={isLive ? "in progress" : undefined}
        />
        <StatCard label="Wall Time" value={run.wallTimeMs > 0 ? fmtMs(run.wallTimeMs) : "—"} />
        <StatCard
          label="Hallucinations"
          value={totalHallucinations}
          accent={totalHallucinations > 0 ? "text-red-400" : "text-emerald-400"}
        />
        <StatCard
          label="Schema Fails"
          value={schemaFailures}
          accent={schemaFailures > 0 ? "text-red-400" : "text-emerald-400"}
        />
        <StatCard label="Attempts" value={run.cases.length > 0 ? (run.cases.reduce((s,c)=>s+c.attempts,0)/run.cases.length).toFixed(1) : "—"} sub="avg per case" />
      </div>

      {/* Cases table */}
      <div className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-zinc-200">
          Cases ({run.cases.length})
        </h2>
        {run.cases.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-zinc-700 text-zinc-500">
            {isLive ? "Waiting for first case to complete…" : "No cases found"}
          </div>
        ) : (
          <CasesTable cases={run.cases} />
        )}
      </div>

      {/* Compare button */}
      <div className="flex justify-end">
        <button
          id="compare-btn"
          onClick={() => router.push(`/runs/compare?a=${run.id}`)}
          className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-700"
        >
          Compare with another run →
        </button>
      </div>
    </div>
    </div>
  );
}
