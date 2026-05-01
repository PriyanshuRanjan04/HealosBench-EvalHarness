/**
 * ScoreBar — horizontal progress bar for F1 scores 0–1.
 *
 * Color:
 *   score < 0.50  → red
 *   score < 0.75  → yellow/amber
 *   score >= 0.75 → green
 */
export default function ScoreBar({
  score,
  showLabel = true,
}: {
  score: number;
  showLabel?: boolean;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);

  const barColor =
    pct >= 75
      ? "bg-emerald-500"
      : pct >= 50
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="min-w-[2.5rem] text-xs tabular-nums text-zinc-300">
          {pct}%
        </span>
      )}
    </div>
  );
}
