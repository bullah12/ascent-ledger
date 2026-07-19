"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Discipline, type GradeSystem } from "@/generated/prisma/enums";
import { disciplineLabels } from "@/lib/climbs/labels";
import { gradeSystemsByDiscipline } from "@/lib/grades";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { completeOnboarding, type OnboardingState } from "./actions";
import { GradeHint } from "@/components/grade-hint";

type GradeOptions = Record<string, { label: string; entries: string[] }>;

export function OnboardingForm({ gradeOptions }: { gradeOptions: GradeOptions }) {
  const [step, setStep] = useState(1);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [state, action, pending] = useActionState<OnboardingState, FormData>(
    completeOnboarding,
    {}
  );
  const systems = [...new Set(disciplines.flatMap((d) => gradeSystemsByDiscipline[d]))];

  function toggle(discipline: Discipline) {
    setDisciplines((current) =>
      current.includes(discipline)
        ? current.filter((value) => value !== discipline)
        : [...current, discipline]
    );
  }

  return (
    <form action={action} className="w-full rounded-xl border bg-card p-6 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Step {step} of 3
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">Set up your suggestions</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Three quick choices. Nothing here creates a logbook entry.
      </p>

      <section className={step === 1 ? "mt-6 grid gap-2" : "hidden"}>
        <Label htmlFor="homeRegion">Home region</Label>
        <Input id="homeRegion" name="homeRegion" required minLength={2} maxLength={120} placeholder="e.g. Scotland" />
        <p className="text-xs text-muted-foreground">Used to put nearby starter packs first.</p>
      </section>

      <section className={step === 2 ? "mt-6 grid gap-3" : "hidden"}>
        <p className="font-medium">Preferred disciplines</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(Discipline).map((discipline) => (
            <label key={discipline} className="flex items-center gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                name="preferredDisciplines"
                value={discipline}
                checked={disciplines.includes(discipline)}
                onChange={() => toggle(discipline)}
              />
              {disciplineLabels[discipline]}
            </label>
          ))}
        </div>
      </section>

      <section className={step === 3 ? "mt-6 grid gap-4" : "hidden"}>
        <div>
          <p className="font-medium">Optional current level</p>
          <p className="text-xs text-muted-foreground">
            These are provisional anchors only. Your first real logged grade supersedes each one.{" "}
            <Link href="/help/grades" className="underline">Grade help</Link>
          </p>
        </div>
        {systems.length === 0 ? (
          <p className="text-sm text-muted-foreground">Choose a discipline in step 2 first.</p>
        ) : systems.map((system: GradeSystem) => (
          <div key={system} className="grid gap-1">
            <Label htmlFor={`grade_${system}`}>
              {gradeOptions[system].label} <GradeHint system={system} />
            </Label>
            <NativeSelect id={`grade_${system}`} name={`grade_${system}`} defaultValue="">
              <option value="">No provisional grade</option>
              {gradeOptions[system].entries.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </NativeSelect>
          </div>
        ))}
      </section>

      {state.error && <p className="mt-4 text-sm text-destructive" role="alert">{state.error}</p>}
      <div className="mt-6 flex justify-between gap-3">
        <Button type="button" variant="ghost" disabled={step === 1} onClick={() => setStep((value) => value - 1)}>
          Back
        </Button>
        {step < 3 ? (
          <Button type="button" disabled={step === 2 && disciplines.length === 0} onClick={() => setStep((value) => value + 1)}>
            Continue
          </Button>
        ) : (
          <Button type="submit" disabled={pending || disciplines.length === 0}>
            {pending ? "Saving…" : "Finish"}
          </Button>
        )}
      </div>
    </form>
  );
}
