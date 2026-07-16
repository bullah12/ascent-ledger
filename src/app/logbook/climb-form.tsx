"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AscentStyle, Discipline, GradeSystem } from "@/generated/prisma/enums";
import { ascentStyleLabels, disciplineLabels } from "@/lib/climbs/labels";
import { gradeSystemLabels, gradeSystemsByDiscipline } from "@/lib/grades";
import type { ClimbFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

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
  submitLabel,
}: {
  action: (prev: ClimbFormState, formData: FormData) => Promise<ClimbFormState>;
  defaultValues?: ClimbFormValues;
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

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="routeName">Route name</Label>
        <Input
          id="routeName"
          name="routeName"
          required
          maxLength={200}
          defaultValue={defaultValues?.routeName}
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
