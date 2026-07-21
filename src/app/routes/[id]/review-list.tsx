"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export type ReviewListItem = {
  id: string;
  displayName: string;
  rating: number;
  text: string | null;
  climbedOn: string | null;
  updatedAt: string;
  variant: string | null;
  conditions: string[];
};

type ReviewFilter = "all" | "summer" | "winter" | "retreats";

const variantLabels: Record<string, string> = {
  "full-traverse": "Full traverse",
  "ridge-only": "Ridge only",
  retreated: "Retreated",
};

const conditionLabels: Record<string, string> = {
  "dry-rock": "dry rock",
  wet: "wet",
  "winter-snow": "winter / snow",
  "light-wind": "light wind",
  "poor-visibility": "poor visibility",
};

export function ReviewList({ reviews }: { reviews: ReviewListItem[] }) {
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const filtered = reviews.filter((review) => {
    if (filter === "winter") return review.conditions.includes("winter-snow");
    if (filter === "retreats") return review.variant === "retreated";
    if (filter === "summer") return !review.conditions.includes("winter-snow") && review.variant !== "retreated";
    return true;
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter reviews">
        {(["all", "summer", "winter", "retreats"] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={cn("h-8 rounded-full border px-4 font-mono text-xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", filter === value ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")}>{value}</button>
        ))}
      </div>
      <div className="grid gap-3">
        {filtered.map((review) => {
          const initials = review.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
          return (
            <article key={review.id} className="rounded-xl border bg-card p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{initials || "AL"}</span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{review.displayName}</p>
                    {review.variant && <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-primary">{variantLabels[review.variant] ?? review.variant}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 text-amber-600" aria-label={`${review.rating} out of 5 stars`}>
                  {[1, 2, 3, 4, 5].map((value) => <Star key={value} className={cn("size-4", value <= review.rating && "fill-current")} />)}
                </div>
              </div>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
                {review.conditions.length ? `Conditions: ${review.conditions.map((item) => conditionLabels[item] ?? item).join(", ")} · ` : ""}
                {review.climbedOn ?? new Date(review.updatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
              {review.text && <p className="mt-2 whitespace-pre-wrap leading-relaxed">{review.text}</p>}
            </article>
          );
        })}
        {filtered.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No reviews match this filter yet.</div>}
      </div>
    </div>
  );
}
