"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import { disciplineLabels } from "@/lib/climbs/labels";
import { gradeSystemLabels, gradeSystemsByDiscipline } from "@/lib/grades";
import type { RouteFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { TrackEditor } from "@/components/track-editor";
import type { LineString } from "geojson";
import type { TrackPathSource } from "@/lib/tracks";
import { GradeHint } from "@/components/grade-hint";

export type RouteFormValues = {
  name: string;
  discipline: Discipline;
  gradeSystem: GradeSystem;
  gradeRaw: string;
  area: string;
  lat: number | null;
  lng: number | null;
  lengthM: number | null;
  ascentM: number | null;
  estimatedDurationMins: number | null;
  description: string;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}

export function RouteForm({
  action,
  defaultValues,
  initialPath = null,
  initialPathSource = null,
  submitLabel = "Add route",
  cancelHref = "/my-trails",
}: {
  action: (prev: RouteFormState, formData: FormData) => Promise<RouteFormState>;
  defaultValues?: RouteFormValues;
  initialPath?: LineString | null;
  initialPathSource?: TrackPathSource | null;
  submitLabel?: string;
  cancelHref?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.fieldErrors ?? {};

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

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Route name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={200}
          defaultValue={defaultValues?.name}
          placeholder="e.g. Point Five Gully"
        />
        <FieldError message={errors.name} />
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
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="lengthM">Distance · metres</Label>
          <Input id="lengthM" name="lengthM" type="number" min={0} defaultValue={defaultValues?.lengthM ?? undefined} placeholder="12000" />
          <FieldError message={errors.lengthM} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ascentM">Ascent · metres</Label>
          <Input id="ascentM" name="ascentM" type="number" min={0} defaultValue={defaultValues?.ascentM ?? undefined} placeholder="1000" />
          <FieldError message={errors.ascentM} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="estimatedDurationMins">Duration · minutes</Label>
          <Input id="estimatedDurationMins" name="estimatedDurationMins" type="number" min={1} defaultValue={defaultValues?.estimatedDurationMins ?? undefined} placeholder="420" />
          <FieldError message={errors.estimatedDurationMins} />
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
          <Label htmlFor="gradeRaw">
            Grade{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="gradeRaw"
            name="gradeRaw"
            maxLength={50}
            defaultValue={defaultValues?.gradeRaw}
            placeholder='e.g. "V,5", "TD+"'
          />
          <FieldError message={errors.gradeRaw} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="lat">
            Latitude{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="lat"
            name="lat"
            type="number"
            step="any"
            min={-90}
            max={90}
            defaultValue={defaultValues?.lat ?? undefined}
            placeholder="e.g. 56.7969"
          />
          <FieldError message={errors.lat} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="lng">
            Longitude{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="lng"
            name="lng"
            type="number"
            step="any"
            min={-180}
            max={180}
            defaultValue={defaultValues?.lng ?? undefined}
            placeholder="e.g. -5.0036"
          />
          <FieldError message={errors.lng} />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">
          Description{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="description"
          name="description"
          maxLength={4000}
          rows={4}
          defaultValue={defaultValues?.description}
          placeholder="Approach, character, season…"
        />
        <FieldError message={errors.description} />
      </div>

      <TrackEditor initialGeometry={initialPath} initialSource={initialPathSource} />

      <FieldError message={state.error} />

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" render={<Link href={cancelHref} />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
