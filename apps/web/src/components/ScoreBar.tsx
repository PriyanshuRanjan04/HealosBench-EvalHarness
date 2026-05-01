/**
 * ScoreBar — horizontal progress bar for F1 scores 0–1.
 *
 * Uses a smooth gradient: red → amber → green based on score value.
 * Includes a glow effect on high scores.
 */
export default function ScoreBar({
  score,
  showLabel = true,
}: {
  score: number;
  showLabel?: boolean;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);

  // Dynamic color based on score
  const barColor =
    pct >= 80
      ? "from-emerald-500 to-emerald-400"
      : pct >= 60
        ? "from-amber-500 to-yellow-400"
        : pct >= 40
          ? "from-orange-500 to-amber-400"
          : "from-red-500 to-red-400";

  const glowColor =
    pct >= 80 ? "shadow-emerald-500/20" : pct >= 60 ? "shadow-amber-500/20" : "";

  const labelColor =
    pct >= 80
      ? "text-emerald-400"
      : pct >= 60
        ? "text-amber-400"
        : pct >= 40
          ? "text-orange-400"
          : "text-red-400";

  return (
    <div className="flex items-center gap-2">
      <div className={`h-2 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.04] ${glowColor ? `shadow-sm ${glowColor}` : ""}`}>
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className={`min-w-[2.5rem] text-xs font-medium tabular-nums ${labelColor}`}>
          {pct}%
        </span>
      )}
    </div>
  );
}
