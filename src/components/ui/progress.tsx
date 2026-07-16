import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
}: {
  /** 0–100 */
  value: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all",
          clamped >= 100 ? "bg-green-600" : "bg-primary"
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
