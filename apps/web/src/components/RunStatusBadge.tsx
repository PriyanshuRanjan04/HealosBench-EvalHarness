import type { RunSummary } from "@test-evals/shared";

const STATUS_CONFIG: Record<RunSummary["status"], {
  dotClass: string;
  bgClass: string;
  label: string;
}> = {
  pending: {
    dotClass: "bg-slate-400",
    bgClass: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    label: "Pending",
  },
  running: {
    dotClass: "bg-blue-400 animate-pulse-dot",
    bgClass: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    label: "Running",
  },
  completed: {
    dotClass: "bg-emerald-400",
    bgClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    label: "Completed",
  },
  failed: {
    dotClass: "bg-red-400",
    bgClass: "bg-red-500/10 text-red-400 border-red-500/20",
    label: "Failed",
  },
  partial: {
    dotClass: "bg-amber-400",
    bgClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    label: "Partial",
  },
};

export default function RunStatusBadge({
  status,
}: {
  status: RunSummary["status"];
}) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${config.bgClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
      {config.label}
    </span>
  );
}
