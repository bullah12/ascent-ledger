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
}: {
  action: (prev: RouteFormState, formData: FormData) => Promise<RouteFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.fieldErrors ?? {};

  const [discipline, setDiscipline] = useState<Discipline>(Discipline.rock);
  const [gradeSystem, setGradeSystem] = useState<GradeSystem>(
    gradeSystemsByDiscipline[Discipline.rock][0]
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
            placeholder="e.g. Ben Nevis"
          />
          <FieldError message={errors.area} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="gradeSystem">Grade system</Label>
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
          placeholder="Approach, character, season…"
        />
        <FieldError message={errors.description} />
      </div>

      <FieldError message={state.error} />

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add route"}
        </Button>
        <Button variant="ghost" render={<Link href="/routes" />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
