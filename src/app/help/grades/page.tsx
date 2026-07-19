import Link from "next/link";
import { Discipline } from "@/generated/prisma/enums";
import { disciplineLabels } from "@/lib/climbs/labels";
import {
  gradeLadder,
  gradeSystemLabels,
  gradeSystemsByDiscipline,
} from "@/lib/grades";

export default function GradeHelpPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
      <Link href="/dashboard" className="text-sm text-muted-foreground underline">
        Back to Ascent Ledger
      </Link>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">Grade systems</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Ascent Ledger preserves the grade you enter and assigns an ordinal
        score only within that grade system. Scores are never conversions
        between systems. Technical, conditions, exposure, and commitment
        details still belong in the original grade and route information.
      </p>

      <div className="mt-8 grid gap-8">
        {Object.values(Discipline).map((discipline) => (
          <section key={discipline}>
            <h2 className="text-lg font-semibold">{disciplineLabels[discipline]}</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              {discipline === Discipline.hiking
                ? "SAC hiking grades describe terrain, exposure, route-finding, and required alpine skills."
                : "Use the system shown by the route source or guidebook; the ladder below powers filtering and progress calculations."}
            </p>
            <div className="grid gap-3">
              {gradeSystemsByDiscipline[discipline].map((system) => {
                const ladder = gradeLadder(system);
                return (
                  <div key={system} className="rounded-lg border p-4">
                    <h3 className="font-medium">{gradeSystemLabels[system]}</h3>
                    {ladder._note && (
                      <p className="mt-1 text-xs text-muted-foreground">{ladder._note}</p>
                    )}
                    {ladder.entries.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {ladder.entries.map((entry) => (
                          <span key={entry.score} className="rounded-md bg-muted px-2 py-1 text-sm">
                            {entry.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">
                        Stored as entered; no normalisation ladder is configured yet.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
