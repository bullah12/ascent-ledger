import Link from "next/link";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getForYouSuggestions } from "@/lib/suggestions";
import { disciplineLabels } from "@/lib/climbs/labels";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ForYouPage() {
  const user = await requireOnboardedUser();
  const suggestions = await getForYouSuggestions(prisma, user.id);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
      <SiteNav current="/for-you" />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">For you</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Deterministic suggestions from your completed climbs and saved preferences.
            BMG gap recommendations remain on the dashboard.
          </p>
        </div>
        <Button variant="outline" render={<Link href="/settings" />}>Tune preferences</Button>
      </div>

      {suggestions.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No matching routes yet</CardTitle>
            <CardDescription>
              Your discipline, region, grade-window, or trip-length filters may be
              narrower than the current route database. Adjust them in settings,
              seed starter routes, or run the open-data sync. No fake history is used.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {suggestions.map((suggestion) => (
            <Card key={suggestion.routeId}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <Badge variant="secondary">{disciplineLabels[suggestion.discipline]}</Badge>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {Math.round(suggestion.score * 100)}% fit
                  </span>
                </div>
                <CardTitle>
                  <Link href={`/routes/${suggestion.routeId}`} className="hover:underline">
                    {suggestion.name}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {[suggestion.gradeRaw, suggestion.areaName, suggestion.region]
                    .filter(Boolean)
                    .join(" · ") || "Route details available"}
                </CardDescription>
                <p className="text-sm">{suggestion.why}</p>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
