/** Thin blue progress bar (deploy, receive and scans) with a mono caption under it. */
export function ProgressBar({ value, max, label, caption }: { value: number; max: number; label: string; caption: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="space-y-1"
    >
      <div className="h-2 w-full overflow-hidden rounded-full bg-hms-muted">
        <div className="h-full bg-hms-pop transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="font-mono text-[11px] text-fg-muted">
        {caption} ({percent}%)
      </p>
    </div>
  );
}
