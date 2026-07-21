"use client";

import { useActionState, useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CLIMB_CONDITIONS, CLIMB_VARIANTS } from "@/lib/climbs/validation";
import { cn } from "@/lib/utils";
import { saveReview, type ReviewFormState } from "./community-actions";

type ExistingReview = {
  rating: number;
  text: string | null;
  climbedOn: string | null;
  variant: string | null;
  conditions: string[];
} | null;

const labels: Record<string, string> = {
  "full-traverse": "Full traverse",
  "ridge-only": "Ridge only",
  retreated: "Retreated",
  "dry-rock": "Dry rock",
  wet: "Wet",
  "winter-snow": "Winter / snow",
  "light-wind": "Light wind",
  "poor-visibility": "Poor visibility",
};

export function ReviewForm({ routeId, existing }: { routeId: string; existing: ExistingReview }) {
  const action = saveReview.bind(null, routeId);
  const [state, formAction, pending] = useActionState<ReviewFormState, FormData>(action, {});
  const [rating, setRating] = useState(existing?.rating ?? 5);

  return (
    <form action={formAction} className="grid gap-5 rounded-xl border bg-secondary/25 p-5">
      <div>
        <h3 className="text-[17px] font-bold">{existing ? "Update your review" : "Review this route"}</h3>
        <p className="mt-1 text-sm text-muted-foreground">Reviews are public. Your log notes, partners, photos, and tracks remain private.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label className="instrument-label">Rating</Label>
          <input type="hidden" name="rating" value={rating} />
          <div className="flex h-10 items-center gap-1 rounded-lg border bg-background px-3" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((value) => (
              <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} star${value === 1 ? "" : "s"}`} onClick={() => setRating(value)} className="rounded text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Star className={cn("size-5", value <= rating && "fill-current")} />
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="climbedOn" className="instrument-label">Climbed on</Label>
          <Input id="climbedOn" name="climbedOn" type="date" defaultValue={existing?.climbedOn ?? ""} className="h-10 bg-background" />
        </div>
      </div>
      <div className="space-y-2">
        <p className="instrument-label">Variant</p>
        <div className="flex flex-wrap gap-2">
          {CLIMB_VARIANTS.map((value) => (
            <label key={value} className="cursor-pointer">
              <input className="peer sr-only" type="radio" name="variant" value={value} defaultChecked={existing?.variant === value} />
              <span className="inline-flex h-8 items-center rounded-lg border bg-background px-3 text-xs peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{labels[value]}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="instrument-label">Conditions</p>
        <div className="flex flex-wrap gap-2">
          {CLIMB_CONDITIONS.map((value) => (
            <label key={value} className="cursor-pointer">
              <input className="peer sr-only" type="checkbox" name="conditions" value={value} defaultChecked={existing?.conditions.includes(value)} />
              <span className="inline-flex h-8 items-center rounded-lg border bg-background px-3 text-xs peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{labels[value]}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="reviewText" className="instrument-label">Review</Label>
        <Textarea id="reviewText" name="text" maxLength={2000} rows={4} defaultValue={existing?.text ?? ""} className="bg-background" />
      </div>
      {state.error && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
      {state.saved && <p className="text-sm text-primary" role="status">Review saved.</p>}
      <div><Button type="submit" disabled={pending}>{pending ? "Publishing…" : "Save review"}</Button></div>
    </form>
  );
}
