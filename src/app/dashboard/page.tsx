import Link from "next/link";
import { Plus, Star } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserProgressAndSuggestions } from "@/lib/bmg/user-progress";
import { getForYouSuggestions } from "@/lib/suggestions";
import { getStarterPacks } from "@/lib/starters";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { signOut } from "./actions";

type RecommendationMode = "familiar" | "balanced" | "explore";

const modeLevel: Record<RecommendationMode, number> = {
  familiar: 0.12,
  balanced: 0.35,
  explore: 0.78,
};

function formatDistance(metres: number) {
  if (!metres) return "0 km";
  return `${Math.round(metres / 1000).toLocaleString()} km`;
}

function recommendationTag(why: string) {
  if (/novel|new/i.test(why)) return { label: "New terrain", className: "bg-secondary text-secondary-foreground" };
  if (/grade|comfort/i.test(why)) return { label: "One grade up", className: "bg-sky-100 text-sky-800" };
  if (/familiar|recent/i.test(why)) return { label: "Like your logs", className: "bg-accent text-accent-foreground" };
  return { label: "Good fit", className: "bg-clay-muted text-clay" };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const user = await requireOnboardedUser();
  const requestedMode = (await searchParams).mode;
  const mode: RecommendationMode = requestedMode === "familiar" || requestedMode === "explore" ? requestedMode : "balanced";

  const [climbs, progressResult, recommendations] = await Promise.all([
    prisma.climb.findMany({
      where: { userId: user.id },
      select: { id: true, date: true, lengthM: true, ascentM: true, rating: true, gradeRaw: true, freeTextRouteName: true, area: { select: { name: true } }, route: { select: { id: true, name: true, area: { select: { name: true } } } } },
      orderBy: { date: "desc" },
    }),
    getUserProgressAndSuggestions(prisma, user),
    getForYouSuggestions(prisma, user.id, new Date(), 5, modeLevel[mode]),
  ]);

  const starterPacks = climbs.length === 0 ? await getStarterPacks(prisma, user.preference) : [];
  const overall = progressResult.progress.length
    ? Math.round(progressResult.progress.reduce((sum, category) => sum + category.percent, 0) / progressResult.progress.length)
    : 0;
  const totalDistance = climbs.reduce((sum, climb) => sum + (climb.lengthM ?? 0), 0);
  const totalAscent = climbs.reduce((sum, climb) => sum + (climb.ascentM ?? 0), 0);
  const daysOut = new Set(climbs.map((climb) => climb.date.toISOString().slice(0, 10))).size;
  const displayName = user.displayName?.trim() || user.email.split("@")[0];
  const firstName = displayName.split(/\s+/)[0];
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "short" }).format(new Date()).toUpperCase();

  return (
    <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-10 sm:px-6 lg:px-8">
      <SiteNav current="/dashboard" />

      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="instrument-label mb-2 text-primary">{today} · Conditions vary</p>
          <h1 className="page-title">Welcome back, {firstName}</h1>
          <p className="mt-2 text-base text-muted-foreground">You&apos;re {overall}% of the way through your tracked BMG prerequisites.</p>
        </div>
        <div className="flex gap-2">
          <form action={signOut}><Button type="submit" variant="ghost">Sign out</Button></form>
          <Button size="lg" render={<Link href="/logbook/new" />}><Plus /> Log a climb</Button>
        </div>
      </header>

      <dl className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Climbs logged", climbs.length.toLocaleString()],
          ["Distance", formatDistance(totalDistance)],
          ["Total ascent", `${totalAscent.toLocaleString()} m`],
          ["Days out", daysOut.toLocaleString()],
        ].map(([label, value]) => (
          <Card key={label} className="gap-2 p-5 py-5 sm:p-6">
            <dt className="instrument-label">{label}</dt>
            <dd className="text-[30px] leading-none font-extrabold tracking-[-0.02em]">{value}</dd>
          </Card>
        ))}
      </dl>

      {starterPacks.length > 0 && (
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-[17px] font-bold">Start with a route pack</CardTitle><p className="text-sm text-muted-foreground">Your recommendations become personal after the first real log.</p></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {starterPacks.slice(0, 6).map((pack) => <div key={`${pack.discipline}:${pack.region}`} className="rounded-lg border p-3"><p className="font-semibold">{pack.region}</p><ul className="mt-2 space-y-1 text-sm">{pack.routes.slice(0, 3).map((route) => <li key={route.id}><Link href={`/routes/${route.id}`} className="hover:text-primary hover:underline">{route.name}</Link></li>)}</ul></div>)}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-5 sm:grid-cols-[1fr_auto]">
            <div>
              <CardTitle className="text-[17px] font-bold">Recommended for you</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Real routes ranked from your history, preferences, and current level.</p>
            </div>
            <div className="mt-3 flex w-fit overflow-hidden rounded-lg border sm:mt-0">
              {(["familiar", "balanced", "explore"] as const).map((value) => <Link key={value} href={`/dashboard?mode=${value}`} aria-current={mode === value ? "page" : undefined} className={cn("px-3 py-2 font-mono text-[10px] uppercase tracking-[0.04em] transition-colors", mode === value ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")}>{value}</Link>)}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 py-4">
            {recommendations.map((suggestion) => {
              const tag = recommendationTag(suggestion.why);
              return (
                <Link key={suggestion.routeId} href={`/routes/${suggestion.routeId}`} className="group flex items-center gap-4 rounded-xl border p-3 transition-all hover:-translate-y-0.5 hover:bg-muted/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span aria-hidden className="topographic-placeholder size-14 shrink-0 rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2"><strong className="truncate text-[15px]">{suggestion.name}</strong><Badge className={tag.className}>{tag.label}</Badge></span>
                    <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">{[suggestion.areaName, suggestion.region, suggestion.gradeRaw].filter(Boolean).join(" · ") || "Route details available"}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{suggestion.why}</span>
                  </span>
                  <span className="shrink-0 text-center font-mono text-primary"><span className="block text-xl font-semibold">{Math.round(suggestion.score * 100)}</span><span className="block text-[9px] text-muted-foreground">MATCH</span></span>
                </Link>
              );
            })}
            {!recommendations.length && <div className="rounded-xl border border-dashed p-8 text-center"><p className="font-semibold">No matching routes yet</p><p className="mt-1 text-sm text-muted-foreground">Tune your preferences or add a real climb to widen the recommendation signal.</p><Button className="mt-4" variant="outline" render={<Link href="/settings" />}>Tune preferences</Button></div>}
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader className="grid-cols-[1fr_auto]"><CardTitle className="text-[17px] font-bold">BMG progression</CardTitle><Link href="/progress" className="font-mono text-[10px] uppercase tracking-[0.05em] text-primary hover:underline">View all →</Link></CardHeader>
            <CardContent className="space-y-4">
              {progressResult.progress.slice(0, 4).map((category) => <div key={category.id}><div className="mb-1.5 flex justify-between gap-3"><span className="font-semibold">{category.label}</span><span className="font-mono text-[11px] text-muted-foreground">{category.percent}%</span></div><Progress value={category.percent} /></div>)}
              {!progressResult.hasRules && <p className="text-sm text-muted-foreground">No BMG rules are loaded yet.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-[17px] font-bold">Recent climbs</CardTitle></CardHeader>
            <CardContent className="divide-y">
              {climbs.slice(0, 5).map((climb) => <Link key={climb.id} href={`/logbook/${climb.id}`} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 hover:text-primary"><span className="min-w-0"><strong className="block truncate">{climb.route?.name ?? climb.freeTextRouteName}</strong><span className="block truncate font-mono text-[10px] text-muted-foreground">{[climb.route?.area?.name ?? climb.area?.name, climb.gradeRaw].filter(Boolean).join(" · ")}</span></span><span className="shrink-0 text-right"><span className="flex justify-end text-amber-600">{climb.rating ? Array.from({ length: climb.rating }, (_, index) => <Star key={index} className="size-3 fill-current" />) : <span className="text-xs text-muted-foreground">Unrated</span>}</span><span className="font-mono text-[10px] text-muted-foreground">{climb.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span></span></Link>)}
              {!climbs.length && <p className="text-sm text-muted-foreground">Your recent climbs will appear here after your first log.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
