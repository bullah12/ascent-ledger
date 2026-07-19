"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { saveReview, type ReviewFormState } from "./community-actions";

type ExistingReview = {
  rating: number;
  text: string | null;
  climbedOn: string | null;
} | null;

export function ReviewForm({ routeId, existing }: { routeId: string; existing: ExistingReview }) {
  const action = saveReview.bind(null, routeId);
  const [state, formAction, pending] = useActionState<ReviewFormState, FormData>(action, {});
  return (
    <form action={formAction} className="grid gap-3 rounded-lg border p-4">
      <div>
        <h3 className="font-medium">{existing ? "Update your review" : "Review this route"}</h3>
        <p className="text-xs text-muted-foreground">
          Reviews are public. Publishing discloses that you climbed and reviewed this route;
          the climbed-on date is optional.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="rating">Rating</Label>
          <NativeSelect id="rating" name="rating" required defaultValue={existing?.rating ?? 5}>
            {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating}/5</option>)}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="climbedOn">Climbed on (optional)</Label>
          <Input id="climbedOn" name="climbedOn" type="date" defaultValue={existing?.climbedOn ?? ""} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="reviewText">Review (optional)</Label>
        <Textarea id="reviewText" name="text" maxLength={2000} rows={3} defaultValue={existing?.text ?? ""} />
      </div>
      {state.error && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
      {state.saved && <p className="text-sm text-emerald-700">Review saved.</p>}
      <div><Button type="submit" disabled={pending}>{pending ? "Publishing…" : "Publish review"}</Button></div>
    </form>
  );
}
