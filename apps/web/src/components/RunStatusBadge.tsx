import type { RunSummary } from "@test-evals/shared";

const STATUS_STYLES: Record<RunSummary["status"], string> = {
  pending:   "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  running:   "bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse",
  completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed:    "bg-red-500/15 text-red-400 border-red-500/30",
  partial:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

export default function RunStatusBadge({
  status,
}: {
  status: RunSummary["status"];
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
