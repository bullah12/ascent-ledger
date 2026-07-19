import { requireOnboardedUser } from "@/lib/auth";
import { parseWeights } from "@/lib/recommender";
import { saveWeights } from "./actions";
import { SiteNav } from "@/components/site-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
