"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Camera, ChevronDown, LockKeyhole, Star } from "lucide-react";
import {
  AscentStyle,
  ClimbVisibility,
  Discipline,
  GradeSystem,
} from "@/generated/prisma/enums";
import { ascentStyleLabels, disciplineLabels } from "@/lib/climbs/labels";
import { gradeSystemLabels, gradeSystemsByDiscipline } from "@/lib/grades";
import {
  CLIMB_CONDITIONS,
  CLIMB_VARIANTS,
} from "@/lib/climbs/validation";
import type { ClimbFormState } from "./actions";
import { RoutePicker, type LinkedRoute } from "./route-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { TrackEditor } from "@/components/track-editor";
import type { LineString } from "geojson";
import type { TrackPathSource } from "@/lib/tracks";
import { GradeHint } from "@/components/grade-hint";
import { cn } from "@/lib/utils";

export type ClimbFormValues = {
  routeName: string;
  discipline: Discipline;
  date: string;
  gradeSystem: GradeSystem;
  gradeRaw: string;
  ascentStyle: AscentStyle;
  area: string;
  notes: string;
  visibility: ClimbVisibility;
  ascentM?: number | null;
  durationMinutes?: number | null;
  variant?: string | null;
  conditions?: string[];
  partners?: string;
  rating?: number | null;
};

export type ProgressDelta = {
  label: string;
  current: number;
  next: number;
  target: number;
};

const variantLabels: Record<(typeof CLIMB_VARIANTS)[number], string> = {
  "full-traverse": "Full traverse",
  "ridge-only": "Ridge only",
  retreated: "Retreated",
};

const conditionLabels: Record<(typeof CLIMB_CONDITIONS)[number], string> = {
  "dry-rock": "Dry rock",
  wet: "Wet",
  "winter-snow": "Winter / snow",
  "light-wind": "Light wind",
  "poor-visibility": "Poor visibility",
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive" role="alert">{message}</p>;
}

export function ClimbForm({
  action,
  defaultValues,
  linkedRoute,
  existingPhotos = [],
  existingTrackUrl = null,
  initialPath = null,
  initialPathSource = null,
  progressDeltas = [],
  submitLabel,
}: {
  action: (prev: ClimbFormState, formData: FormData) => Promise<ClimbFormState>;
  defaultValues?: ClimbFormValues;
  linkedRoute?: LinkedRoute | null;
  existingPhotos?: string[];
  existingTrackUrl?: string | null;
  initialPath?: LineString | null;
  initialPathSource?: TrackPathSource | null;
  progressDeltas?: ProgressDelta[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.fieldErrors ?? {};
  const [discipline, setDiscipline] = useState<Discipline>(defaultValues?.discipline ?? Discipline.rock);
  const [gradeSystem, setGradeSystem] = useState<GradeSystem>(
    defaultValues?.gradeSystem ?? gradeSystemsByDiscipline[discipline][0],
  );
  const [routeName, setRouteName] = useState(defaultValues?.routeName ?? "");
  const [rating, setRating] = useState<number | null>(defaultValues?.rating ?? null);

  function handleDisciplineChange(next: Discipline) {
    setDiscipline(next);
    if (!gradeSystemsByDiscipline[next].includes(gradeSystem)) {
      setGradeSystem(gradeSystemsByDiscipline[next][0]);
    }
  }

  function handleRouteSelect(route: LinkedRoute) {
    if (!routeName.trim()) setRouteName(route.name);
  }

  return (
    <form action={formAction} className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_0_color-mix(in_oklch,var(--foreground)_4%,transparent)] lg:grid lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-7 p-5 sm:p-7 lg:p-9">
        <section className="space-y-3">
          <p className="instrument-label">Route</p>
          <RoutePicker initialRoute={linkedRoute} onSelect={handleRouteSelect} />
          <FieldError message={errors.routeId} />
        </section>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="date" className="instrument-label">Date</Label>
            <Input id="date" name="date" type="date" required defaultValue={defaultValues?.date} className="h-11" />
            <FieldError message={errors.date} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="durationMinutes" className="instrument-label">Time on route · minutes</Label>
            <Input id="durationMinutes" name="durationMinutes" type="number" min={1} defaultValue={defaultValues?.durationMinutes ?? ""} placeholder="e.g. 400" className="h-11" />
            <FieldError message={errors.durationMinutes} />
          </div>
        </div>

        <section className="space-y-3">
          <p className="instrument-label">Variant completed</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Variant completed">
            {CLIMB_VARIANTS.map((value) => (
              <label key={value} className="cursor-pointer">
                <input className="peer sr-only" type="radio" name="variant" value={value} defaultChecked={defaultValues?.variant === value} />
                <span className="inline-flex h-10 items-center rounded-lg border bg-background px-4 text-sm transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                  {variantLabels[value]}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <p className="instrument-label">Conditions</p>
          <div className="flex flex-wrap gap-2">
            {CLIMB_CONDITIONS.map((value) => (
              <label key={value} className="cursor-pointer">
                <input className="peer sr-only" type="checkbox" name="conditions" value={value} defaultChecked={defaultValues?.conditions?.includes(value)} />
                <span className="inline-flex h-9 items-center rounded-lg border bg-background px-3 text-sm transition-colors peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                  {conditionLabels[value]}
                </span>
              </label>
            ))}
          </div>
        </section>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="partners" className="instrument-label">Partners</Label>
            <Input id="partners" name="partners" maxLength={500} defaultValue={defaultValues?.partners ?? ""} placeholder="Names, separated by commas" className="h-11" />
            <FieldError message={errors.partners} />
          </div>
          <div className="grid gap-2">
            <Label className="instrument-label">Your rating</Label>
            <input type="hidden" name="rating" value={rating ?? ""} />
            <div className="flex h-11 items-center gap-1 rounded-lg border px-3" role="radiogroup" aria-label="Your rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} star${value === 1 ? "" : "s"}`} onClick={() => setRating(value)} className="rounded p-0.5 text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Star className={cn("size-5", rating !== null && value <= rating && "fill-current")} />
                </button>
              ))}
            </div>
            <FieldError message={errors.rating} />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="notes" className="instrument-label">Notes & your review</Label>
          <Textarea id="notes" name="notes" maxLength={2000} rows={5} defaultValue={defaultValues?.notes} placeholder="Conditions, route choices, partners, how it went…" className="min-h-28" />
          <FieldError message={errors.notes} />
        </div>

        <details className="group rounded-xl border bg-secondary/30">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
            Technical log details
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid gap-5 border-t p-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="routeName">Route name</Label>
              <Input id="routeName" name="routeName" required maxLength={200} value={routeName} onChange={(event) => setRouteName(event.target.value)} placeholder="e.g. Tower Ridge" />
              <FieldError message={errors.routeName} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="discipline">Discipline</Label>
              <NativeSelect id="discipline" name="discipline" required value={discipline} onChange={(event) => handleDisciplineChange(event.target.value as Discipline)}>
                {Object.values(Discipline).map((value) => <option key={value} value={value}>{disciplineLabels[value]}</option>)}
              </NativeSelect>
              <FieldError message={errors.discipline} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ascentStyle">Ascent style</Label>
              <NativeSelect id="ascentStyle" name="ascentStyle" required defaultValue={defaultValues?.ascentStyle ?? AscentStyle.led}>
                {Object.values(AscentStyle).map((value) => <option key={value} value={value}>{ascentStyleLabels[value]}</option>)}
              </NativeSelect>
              <FieldError message={errors.ascentStyle} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gradeSystem">Grade system <GradeHint system={gradeSystem} /></Label>
              <NativeSelect id="gradeSystem" name="gradeSystem" required value={gradeSystem} onChange={(event) => setGradeSystem(event.target.value as GradeSystem)}>
                {gradeSystemsByDiscipline[discipline].map((value) => <option key={value} value={value}>{gradeSystemLabels[value]}</option>)}
              </NativeSelect>
              <FieldError message={errors.gradeSystem} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gradeRaw">Grade</Label>
              <Input id="gradeRaw" name="gradeRaw" required maxLength={50} defaultValue={defaultValues?.gradeRaw} placeholder="e.g. Grade 3, V,6, TD+" />
              <FieldError message={errors.gradeRaw} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="area">Area <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="area" name="area" maxLength={120} defaultValue={defaultValues?.area} placeholder="e.g. Ben Nevis" />
              <FieldError message={errors.area} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ascentM">Ascent · metres</Label>
              <Input id="ascentM" name="ascentM" type="number" min={0} defaultValue={defaultValues?.ascentM ?? ""} placeholder="e.g. 1000" />
              <FieldError message={errors.ascentM} />
            </div>
            <label className="flex items-start gap-3 rounded-lg border bg-background p-3 text-sm sm:col-span-2">
              <input type="checkbox" name="visibility" value={ClimbVisibility.public} defaultChecked={defaultValues?.visibility === ClimbVisibility.public} className="mt-1 accent-primary" />
              <span>
                <span className="flex items-center gap-2 font-medium"><LockKeyhole className="size-4 text-primary" /> Show as a public tick</span>
                <span className="mt-1 block text-muted-foreground">Only your display name, route, date, grade, and style are shared. Notes, partners, photos, and tracks stay private.</span>
              </span>
            </label>
            <div className="sm:col-span-2">
              <TrackEditor initialGeometry={initialPath} initialSource={initialPathSource} existingRawUrl={existingTrackUrl} />
            </div>
          </div>
        </details>
      </div>

      <aside className="flex flex-col border-t bg-secondary/35 p-5 sm:p-7 lg:min-h-[850px] lg:border-t-0 lg:border-l">
        <div className="space-y-5 lg:sticky lg:top-6">
          <section>
            <p className="instrument-label mb-4">This log counts toward</p>
            <div className="space-y-3">
              {(progressDeltas.length ? progressDeltas : [{ label: "Total climbs logged", current: 0, next: 1, target: 1 }]).map((delta) => (
                <Card key={delta.label} className="gap-3 p-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{delta.label}</span>
                    <span className="font-mono text-sm font-semibold text-primary">+1 → {delta.next}</span>
                  </div>
                  <Progress value={Math.min(100, (delta.next / Math.max(1, delta.target)) * 100)} />
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <p className="instrument-label">Photos</p>
            {existingPhotos.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {existingPhotos.map((url) => (
                  <label key={url} className="group relative aspect-square cursor-pointer overflow-hidden rounded-xl border" title="Tick to remove on save">
                    {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded Supabase Storage URL */}
                    <img src={url} alt="Climb photo" className="size-full object-cover" />
                    <span className="absolute inset-x-2 bottom-2 rounded bg-background/85 px-2 py-1 text-xs"><input type="checkbox" name="removePhotos" value={url} /> remove</span>
                  </label>
                ))}
              </div>
            )}
            <label htmlFor="photos" className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed bg-background text-center text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
              <Camera className="mb-2 size-5" />
              Add up to 8 photos
            </label>
            <Input id="photos" name="photos" type="file" accept="image/*" multiple className="sr-only" />
          </section>

          <FieldError message={state.error} />

          <div className="grid gap-2 pt-3">
            <Button type="submit" name="intent" value="save" size="lg" disabled={pending} className="h-11">
              {pending ? "Saving…" : submitLabel}
            </Button>
            <Button type="submit" name="intent" value="publish-review" size="lg" variant="outline" disabled={pending} className="h-11">
              Save & publish review
            </Button>
            <Button variant="ghost" render={<Link href="/logbook" />}>Cancel</Button>
          </div>
        </div>
      </aside>
    </form>
  );
}
