"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AscentStyle, Discipline, GradeSystem } from "@/generated/prisma/enums";
import { ascentStyleLabels, disciplineLabels } from "@/lib/climbs/labels";
import { gradeSystemLabels, gradeSystemsByDiscipline } from "@/lib/grades";
import type { ClimbFormState } from "./actions";
import { RoutePicker, type LinkedRoute } from "./route-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { TrackEditor } from "@/components/track-editor";
import type { LineString } from "geojson";
import type { TrackPathSource } from "@/lib/tracks";
import { GradeHint } from "@/components/grade-hint";

export type ClimbFormValues = {
  routeName: string;
  discipline: Discipline;
  date: string; // YYYY-MM-DD
  gradeSystem: GradeSystem;
  gradeRaw: string;
  ascentStyle: AscentStyle;
  area: string;
  notes: string;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}

export function ClimbForm({
  action,
  defaultValues,
  linkedRoute,
  existingPhotos = [],
  existingTrackUrl = null,
  initialPath = null,
  initialPathSource = null,
  submitLabel,
}: {
  action: (prev: ClimbFormState, formData: FormData) => Promise<ClimbFormState>;
  defaultValues?: ClimbFormValues;
  linkedRoute?: LinkedRoute | null;
  existingPhotos?: string[];
  existingTrackUrl?: string | null;
  initialPath?: LineString | null;
  initialPathSource?: TrackPathSource | null;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.fieldErrors ?? {};

  // The grade-system choices follow the discipline (rock grades make no
  // sense on a ski tour). Changing discipline resets the system to that
  // discipline's default.
  const [discipline, setDiscipline] = useState<Discipline>(
    defaultValues?.discipline ?? Discipline.rock
  );
  const [gradeSystem, setGradeSystem] = useState<GradeSystem>(
    defaultValues?.gradeSystem ?? gradeSystemsByDiscipline[discipline][0]
  );

  function handleDisciplineChange(next: Discipline) {
    setDiscipline(next);
    if (!gradeSystemsByDiscipline[next].includes(gradeSystem)) {
      setGradeSystem(gradeSystemsByDiscipline[next][0]);
    }
  }

  // Controlled so picking a route can prefill it; user edits still win.
  const [routeName, setRouteName] = useState(defaultValues?.routeName ?? "");

  function handleRouteSelect(route: LinkedRoute) {
    if (!routeName.trim()) setRouteName(route.name);
  }

  return (
    <form action={formAction} className="grid gap-4">
      <RoutePicker initialRoute={linkedRoute} onSelect={handleRouteSelect} />
      <FieldError message={errors.routeId} />

      <div className="grid gap-2">
        <Label htmlFor="routeName">Route name</Label>
        <Input
          id="routeName"
          name="routeName"
          required
          maxLength={200}
          value={routeName}
          onChange={(e) => setRouteName(e.target.value)}
          placeholder="e.g. Tower Ridge"
        />
        <FieldError message={errors.routeName} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="discipline">Discipline</Label>
          <NativeSelect
            id="discipline"
            name="discipline"
            required
            value={discipline}
            onChange={(e) => handleDisciplineChange(e.target.value as Discipline)}
          >
            {Object.values(Discipline).map((value) => (
              <option key={value} value={value}>
                {disciplineLabels[value]}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors.discipline} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            name="date"
            type="date"
            required
            defaultValue={defaultValues?.date}
          />
          <FieldError message={errors.date} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="gradeSystem">Grade system <GradeHint system={gradeSystem} /></Label>
          <NativeSelect
            id="gradeSystem"
            name="gradeSystem"
            required
            value={gradeSystem}
            onChange={(e) => setGradeSystem(e.target.value as GradeSystem)}
          >
            {gradeSystemsByDiscipline[discipline].map((value) => (
              <option key={value} value={value}>
                {gradeSystemLabels[value]}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors.gradeSystem} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="gradeRaw">Grade</Label>
          <Input
            id="gradeRaw"
            name="gradeRaw"
            required
            maxLength={50}
            defaultValue={defaultValues?.gradeRaw}
            placeholder='e.g. "E1 5b", "V,6", "TD+"'
          />
          <FieldError message={errors.gradeRaw} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="ascentStyle">Ascent style</Label>
          <NativeSelect
            id="ascentStyle"
            name="ascentStyle"
            required
            defaultValue={defaultValues?.ascentStyle ?? AscentStyle.led}
          >
            {Object.values(AscentStyle).map((value) => (
              <option key={value} value={value}>
                {ascentStyleLabels[value]}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors.ascentStyle} />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="area">
          Area{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="area"
          name="area"
          maxLength={120}
          defaultValue={defaultValues?.area}
          placeholder="e.g. Ben Nevis"
        />
        <FieldError message={errors.area} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="notes">
          Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="notes"
          name="notes"
          maxLength={2000}
          rows={4}
          defaultValue={defaultValues?.notes}
          placeholder="Conditions, partners, how it went…"
        />
        <FieldError message={errors.notes} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="photos">
          Photos{" "}
          <span className="font-normal text-muted-foreground">
            (optional, up to 8, 5 MB each)
          </span>
        </Label>
        {existingPhotos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {existingPhotos.map((url) => (
              <label
                key={url}
                className="group relative block cursor-pointer"
                title="Tick to remove on save"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded Supabase Storage URL, not an optimisable static asset */}
                <img
                  src={url}
                  alt="Climb photo"
                  className="size-20 rounded-md border object-cover"
                />
                <span className="absolute right-1 top-1 rounded bg-background/80 px-1 text-xs">
                  <input type="checkbox" name="removePhotos" value={url} />{" "}
                  remove
                </span>
              </label>
            ))}
          </div>
        )}
        <Input id="photos" name="photos" type="file" accept="image/*" multiple />
      </div>

      <TrackEditor
        initialGeometry={initialPath}
        initialSource={initialPathSource}
        existingRawUrl={existingTrackUrl}
      />

      <FieldError message={state.error} />

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" render={<Link href="/logbook" />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
