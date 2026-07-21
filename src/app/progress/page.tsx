import Link from "next/link";
import { requireOnboardedUser } from "@/lib/auth";
import { getUserProgressAndSuggestions } from "@/lib/bmg/user-progress";
import { prisma } from "@/lib/prisma";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export default async function ProgressPage() {
  const user = await requireOnboardedUser();
  const { hasRules, progress, categorySuggestions } = await getUserProgressAndSuggestions(prisma, user);
  const overall = progress.length ? Math.round(progress.reduce((sum, category) => sum + category.percent, 0) / progress.length) : 0;
  const suggestionsByCategory = new Map(categorySuggestions.map((category) => [category.categoryKey, category.rules.flatMap((rule) => rule.suggestions)]));

  return (
    <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-10 sm:px-6 lg:px-8">
      <SiteNav current="/progress" />
      <header className="mb-8 flex items-end justify-between gap-5">
        <div>
          <p className="instrument-label mb-2 text-primary">British Mountain Guide · prerequisites</p>
          <h1 className="page-title">Your progression</h1>
        </div>
        <div className="text-right"><p className="text-4xl font-extrabold text-primary sm:text-5xl">{overall}%</p><p className="instrument-label">Overall readiness</p></div>
      </header>

      {!hasRules ? (
        <Card className="border-dashed p-8 text-center"><CardTitle>No BMG rules loaded</CardTitle><p className="mt-2 text-sm text-muted-foreground">Load the prerequisite rules to calculate progress from your real logbook.</p></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {progress.map((category) => {
            const actual = category.rules.reduce((sum, rule) => sum + Math.min(rule.actualCount, rule.minCount), 0);
            const required = category.rules.reduce((sum, rule) => sum + rule.minCount, 0);
            const status = category.percent >= 100 ? "complete" : category.percent < 45 ? "priority" : "on track";
            const suggestions = [...new Map((suggestionsByCategory.get(category.key) ?? []).map((suggestion) => [suggestion.routeId, suggestion])).values()].slice(0, 3);
            return (
              <Card key={category.id} className="gap-0 py-0">
                <CardHeader className="border-b py-5">
                  <CardTitle className="text-[17px] font-bold">{category.label}</CardTitle>
                  <p className="font-mono text-[11px] text-muted-foreground">{category.description ?? `${category.totalRules} tracked prerequisite rules`}</p>
                  <Badge className={status === "complete" ? "bg-accent text-accent-foreground" : status === "priority" ? "bg-clay-muted text-clay" : "bg-secondary text-secondary-foreground"}>{status.toUpperCase()}</Badge>
                </CardHeader>
                <CardContent className="space-y-4 py-5">
                  <div className="flex items-end justify-between gap-4"><p><span className="text-3xl font-extrabold">{actual}</span><span className="font-mono text-sm text-muted-foreground"> / {required} counts</span></p><p className="font-mono text-xs text-muted-foreground">{category.percent >= 100 ? "requirement met" : `${Math.max(0, required - actual)} to go`}</p></div>
                  <Progress value={category.percent} className="h-2.5" indicatorClassName={status === "priority" ? "bg-clay" : undefined} />
                  <div className="border-t pt-4">
                    <p className="instrument-label mb-2">Routes that close the gap</p>
                    {suggestions.length ? <ul className="space-y-2">{suggestions.map((suggestion) => <li key={suggestion.routeId} className="flex items-center justify-between gap-3"><Link href={`/routes/${suggestion.routeId}`} className="truncate font-semibold hover:text-primary hover:underline">{suggestion.name}</Link><span className="shrink-0 font-mono text-[10px] text-muted-foreground">{[suggestion.gradeRaw, suggestion.areaName].filter(Boolean).join(" · ") || `${Math.round(suggestion.score * 100)}% match`}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">{category.percent >= 100 ? "Keep current — consolidate with quality mileage." : "No matching route is currently available in the database."}</p>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
