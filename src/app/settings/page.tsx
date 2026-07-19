import { requireOnboardedUser } from "@/lib/auth";
import { parseWeights } from "@/lib/recommender";
import { saveWeights } from "./actions";
import { SiteNav } from "@/components/site-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Discipline } from "@/generated/prisma/enums";
import { disciplineLabels } from "@/lib/climbs/labels";
import {
  gradeLadder,
  gradeSystemLabels,
  gradeSystemsByDiscipline,
} from "@/lib/grades";
import {
  DEFAULT_SUGGESTION_WEIGHTS,
  parseGradeWindows,
  parseSuggestionWeights,
} from "@/lib/suggestions";
import { NativeSelect } from "@/components/ui/native-select";
import { prisma } from "@/lib/prisma";

const FIELDS = [
  {
    key: "w1",
    label: "Grade fit (w1)",
    help: "Routes one step above your current max score highest.",
  },
  {
    key: "w2",
    label: "Route quality (w2)",
    help: "Prefer well-regarded routes where the source rates them.",
  },
  {
    key: "w3",
    label: "Area diversity (w3)",
    help: "Bonus for areas you haven't climbed in yet.",
  },
  {
    key: "w4",
    label: "Distance penalty (w4)",
    help: "Penalises routes far from areas you've already visited.",
  },
] as const;

export default async function SettingsPage() {
  const user = await requireOnboardedUser();
  const weights = parseWeights(user.recommenderWeightsJson);
  const suggestionWeights = parseSuggestionWeights(user.preference.suggestionWeightsJson);
  const gradeWindows = parseGradeWindows(user.preference.gradeWindowsJson);
  const tags = await prisma.tag.findMany({ orderBy: [{ kind: "asc" }, { label: "asc" }] });
  const gradeSystems = [...new Set(Object.values(gradeSystemsByDiscipline).flat())]
    .filter((system) => gradeLadder(system).entries.length > 0);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <SiteNav current="/settings" />
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Recommender scoring weights (PLAN §6). Each component is normalised
        to 0–1 before weighting, so the numbers are directly comparable.
        score = w1·grade_fit + w2·quality + w3·area_diversity −
        w4·distance_penalty.
      </p>

      <form action={saveWeights} className="grid gap-4">
        <div className="grid gap-1 border-b pb-5">
          <Label htmlFor="displayName">Public display name</Label>
          <p className="text-xs text-muted-foreground">
            Shown on reviews and public ticks. If blank, others see “Ascent Ledger member”.
            Your email is never shown.
          </p>
          <Input
            id="displayName"
            name="displayName"
            maxLength={80}
            defaultValue={user.displayName ?? ""}
            className="max-w-sm"
          />
        </div>
        <section className="grid gap-4 border-b pb-5">
          <div>
            <h2 className="font-semibold">For you preferences</h2>
            <p className="text-xs text-muted-foreground">
              These tune the general suggestion engine and do not change BMG progress.
            </p>
          </div>
          <div className="grid gap-2">
            <Label>Preferred disciplines</Label>
            <div className="grid grid-cols-2 gap-2">
              {Object.values(Discipline).map((discipline) => (
                <label key={discipline} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="preferredDisciplines"
                    value={discipline}
                    defaultChecked={user.preference.preferredDisciplines.includes(discipline)}
                  />
                  {disciplineLabels[discipline]}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="preferredRegions">Preferred regions</Label>
            <Input
              id="preferredRegions"
              name="preferredRegions"
              defaultValue={user.preference.preferredRegions.join(", ")}
              placeholder="Scotland, Alps"
            />
            <p className="text-xs text-muted-foreground">Comma-separated; saved regions gate candidates.</p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="maxTripLengthDays">Maximum trip length (days)</Label>
            <Input
              id="maxTripLengthDays"
              name="maxTripLengthDays"
              type="number"
              min={1}
              max={90}
              defaultValue={user.preference.maxTripLengthDays ?? ""}
              className="max-w-32"
            />
            <p className="text-xs text-muted-foreground">
              A proxy derived from route distance or pitches; leave blank for no cap.
            </p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="exploreLevel">Explore ↔ familiar</Label>
            <Input
              id="exploreLevel"
              name="exploreLevel"
              type="range"
              min={0}
              max={1}
              step={0.05}
              defaultValue={user.preference.exploreLevel}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Prefer familiar</span><span>Explore more</span>
            </div>
          </div>
        </section>

        <section className="grid gap-4 border-b pb-5">
          <div>
            <h2 className="font-semibold">Preferred grade windows</h2>
            <p className="text-xs text-muted-foreground">Optional hard windows within each system.</p>
          </div>
          {gradeSystems.map((system) => {
            const entries = gradeLadder(system).entries;
            const current = gradeWindows[system];
            return (
              <div key={system} className="grid gap-2 sm:grid-cols-3 sm:items-end">
                <p className="text-sm font-medium">{gradeSystemLabels[system]}</p>
                <div className="grid gap-1">
                  <Label htmlFor={`gradeMin_${system}`}>Minimum</Label>
                  <NativeSelect id={`gradeMin_${system}`} name={`gradeMin_${system}`} defaultValue={current?.min ?? ""}>
                    <option value="">Any</option>
                    {entries.map((entry) => <option key={entry.score} value={entry.score}>{entry.label}</option>)}
                  </NativeSelect>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`gradeMax_${system}`}>Maximum</Label>
                  <NativeSelect id={`gradeMax_${system}`} name={`gradeMax_${system}`} defaultValue={current?.max ?? ""}>
                    <option value="">Any</option>
                    {entries.map((entry) => <option key={entry.score} value={entry.score}>{entry.label}</option>)}
                  </NativeSelect>
                </div>
              </div>
            );
          })}
        </section>

        <section className="grid gap-3 border-b pb-5">
          <div>
            <h2 className="font-semibold">Preferred route tags</h2>
            <p className="text-xs text-muted-foreground">Tags are boosts, not hard filters.</p>
          </div>
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">Run <code>npm run db:seed:tags</code> to configure tag preferences.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {tags.map((tag) => (
                <label key={tag.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="preferredTagSlugs"
                    value={tag.slug}
                    defaultChecked={user.preference.preferredTagSlugs.includes(tag.slug)}
                  />
                  {tag.label}
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-4 border-b pb-5">
          <div>
            <h2 className="font-semibold">For you scoring weights</h2>
            <p className="text-xs text-muted-foreground">Separate from the BMG weights below.</p>
          </div>
          {Object.keys(DEFAULT_SUGGESTION_WEIGHTS).map((key) => (
            <div key={key} className="grid gap-1">
              <Label htmlFor={`suggestion_${key}`}>{key.replaceAll(/([A-Z])/g, " $1")}</Label>
              <Input
                id={`suggestion_${key}`}
                name={`suggestion_${key}`}
                type="number"
                step="0.1"
                min={0}
                max={100}
                required
                defaultValue={suggestionWeights[key as keyof typeof suggestionWeights]}
                className="max-w-32"
              />
            </div>
          ))}
        </section>

        <h2 className="font-semibold">BMG gap scoring weights</h2>
        {FIELDS.map((field) => (
          <div key={field.key} className="grid gap-1">
            <Label htmlFor={field.key}>{field.label}</Label>
            <p className="text-xs text-muted-foreground">{field.help}</p>
            <Input
              id={field.key}
              name={field.key}
              type="number"
              step="0.1"
              min={0}
              max={100}
              required
              defaultValue={weights[field.key]}
              className="max-w-32"
            />
          </div>
        ))}
        <div>
          <Button type="submit">Save weights</Button>
        </div>
      </form>
    </main>
  );
}
