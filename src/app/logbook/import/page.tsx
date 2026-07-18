import { requireUser } from "@/lib/auth";
import { ImportForm } from "./import-form";

const sampleCsv = `date,route_name,discipline,grade,ascent_style,grade_system,area,pitches,length_m,partners,notes
2025-02-14,Point Five Gully,winter,"V,5",led,scottish_winter,Ben Nevis,5,325,Alex;Sam,Classic conditions
2024-07-02,Frendo Spur,alpine,TD,alternate_lead,,Aiguille du Midi,,1100,,
2023-05-20,Cenotaph Corner,rock,E1 5c,led,uk_trad,Dinas Cromlech,1,40,,`;

export default async function ImportPage() {
  await requireUser();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">
        Import climbs from CSV
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Bulk-load your logbook. Rows that fail validation are reported per
        line and skipped; the rest import normally.
      </p>

      <ImportForm />

      <div className="mt-8 space-y-3 text-sm">
        <h2 className="font-semibold">File format</h2>
        <p className="text-muted-foreground">
          A header row is required; column order doesn&apos;t matter and
          unknown columns are ignored.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <strong>Required:</strong> <code>date</code> (YYYY-MM-DD),{" "}
            <code>route_name</code>, <code>discipline</code> (rock, winter,
            alpine, ski_touring), <code>grade</code>,{" "}
            <code>ascent_style</code> (led, alternate_lead, seconded, solo,
            roped_solo)
          </li>
          <li>
            <strong>Optional:</strong> <code>grade_system</code> (uk_trad,
            french_sport, uiaa, scottish_winter, wi_ice, alpine_overall,
            ski_touring_scale — blank means it&apos;s inferred from the
            discipline and grade), <code>area</code>, <code>pitches</code>,{" "}
            <code>length_m</code>, <code>partners</code> (separated by{" "}
            <code>;</code>), <code>notes</code>
          </li>
          <li>
            Quote fields containing commas, e.g. <code>&quot;V,5&quot;</code>{" "}
            for Scottish winter grades.
          </li>
        </ul>
        <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs">
          {sampleCsv}
        </pre>
      </div>
    </main>
  );
}
