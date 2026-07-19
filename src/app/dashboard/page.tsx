import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { CategoryProgress, RuleProgress } from "@/lib/bmg/engine";
import { getUserProgressAndSuggestions } from "@/lib/bmg/user-progress";
import type { RouteSuggestion } from "@/lib/recommender";
import { signOut } from "./actions";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { GradeHint } from "@/components/grade-hint";
import { getStarterPacks, type StarterPack } from "@/lib/starters";
import { disciplineLabels } from "@/lib/climbs/labels";

function StarterPacks({ packs }: { packs: StarterPack[] }) {
  if (packs.length === 0) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Starter routes are not seeded yet</CardTitle>
          <CardDescription>
            Run <code>npm run db:seed:starters</code>, or start with any route in the{" "}
            <Link href="/routes" className="underline">route database</Link>.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <section className="mb-6 rounded-lg border p-4">
      <h2 className="font-semibold">Starter packs</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Open-source routes grouped by your disciplines and region. Logging one creates the real history used by suggestions.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {packs.slice(0, 6).map((pack) => (
          <div key={`${pack.discipline}:${pack.region}`}>
            <p className="text-sm font-medium">
              {disciplineLabels[pack.discipline]} · {pack.region}
              {pack.homeRegionMatch && <Badge variant="secondary" className="ml-2">near home</Badge>}
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {pack.routes.slice(0, 5).map((route) => (
                <li key={route.id}>
                  <Link href={`/routes/${route.id}`} className="underline">{route.name}</Link>
                  <span className="text-muted-foreground">
                    {route.gradeRaw ? ` · ${route.gradeRaw}` : ""}
                    {route.lengthM ? ` · ${(route.lengthM / 1000).toFixed(0)} km` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function SuggestedRoutes({ suggestions }: { suggestions: RouteSuggestion[] }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Suggested routes
      </p>
      <ul className="space-y-1.5">
        {suggestions.map((s) => (
          <li key={s.routeId} className="text-sm">
            {s.externalUrl ? (
              <a href={s.externalUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                {s.name}
              </a>
            ) : (
              <span className="font-medium">{s.name}</span>
            )}
            <span className="text-muted-foreground">
              {s.gradeRaw ? ` · ${s.gradeRaw}` : ""}
              {s.areaName ? ` · ${s.areaName}` : ""}
            </span>
            <span className="block text-xs text-muted-foreground">{s.why}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RuleRow({
  rule,
  suggestions,
}: {
  rule: RuleProgress;
  suggestions: RouteSuggestion[];
}) {
  return (
    <div className="border-t px-6 py-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="text-sm font-medium">
          {rule.description}
          {rule.thresholdLabel ? (
            <span className="text-muted-foreground">
              {" · "}{rule.thresholdLabel}+
              {rule.gradeSystem && <GradeHint system={rule.gradeSystem} />}
            </span>
          ) : null}
        </p>
        {!rule.verified && (
          <Badge variant="outline" className="shrink-0 text-amber-600">
            unverified
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Progress value={rule.percent} className="flex-1" />
        <span className="w-16 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
          {rule.actualCount}/{rule.minCount}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {rule.met
          ? "Done ✓"
          : rule.stillNeeded > 0
            ? `${rule.stillNeeded} more needed`
            : "Count met — see notes"}
        {rule.notes.length > 0 && <> · {rule.notes.join(" · ")}</>}
      </p>
      <SuggestedRoutes suggestions={suggestions} />
    </div>
  );
}

function CategoryCard({
  category,
  suggestionsByRule,
}: {
  category: CategoryProgress;
  suggestionsByRule: Map<string, RouteSuggestion[]>;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <details className="group">
        <summary className="cursor-pointer list-none px-6 py-5 [&::-webkit-details-marker]:hidden">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{category.label}</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {category.metRules}/{category.totalRules} rules met
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Progress value={category.percent} className="h-3 flex-1" />
            <span className="w-12 shrink-0 text-right text-sm font-medium tabular-nums">
              {category.percent}%
            </span>
          </div>
          {category.ungradedCount > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {category.ungradedCount} climb
              {category.ungradedCount === 1 ? "" : "s"} with an unrecognised
              grade — not counted toward graded rules.{" "}
              <Link href="/logbook" className="underline">
                Fix in logbook
              </Link>
            </p>
          )}
        </summary>
        <div className="pb-2">
          {category.rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              suggestions={suggestionsByRule.get(rule.id) ?? []}
            />
          ))}
        </div>
      </details>
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireOnboardedUser();

  const climbCount = await prisma.climb.count({ where: { userId: user.id } });

  const [{ hasRules, progress, hasUnverified, categorySuggestions }, starterPacks] =
    await Promise.all([
      getUserProgressAndSuggestions(prisma, user),
      climbCount === 0 ? getStarterPacks(prisma, user.preference) : Promise.resolve([]),
    ]);
  const suggestionsByRule = new Map(
    (climbCount === 0 ? [] : categorySuggestions).flatMap((c) =>
      c.rules.map((r) => [r.ruleId, r.suggestions] as const)
    )
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
      <SiteNav current="/dashboard" />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">BMG progress</h1>
          <p className="text-sm text-muted-foreground">
            Your logbook scored against the BMG aspirant prerequisites.
          </p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="ghost">
            Sign out
          </Button>
        </form>
      </div>

      {climbCount === 0 && <StarterPacks packs={starterPacks} />}

      {!hasRules ? (
        <Card>
          <CardHeader>
            <CardTitle>No BMG rules loaded</CardTitle>
            <CardDescription>
              The rules table is empty. Run <code>npm run db:seed</code> to
              load the categories and rules from{" "}
              <code>docs/bmg_rules.seed.json</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {progress.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                suggestionsByRule={suggestionsByRule}
              />
            ))}
          </div>
          {hasUnverified && (
            <p className="mt-4 text-xs text-muted-foreground">
              Rules marked <span className="text-amber-600">unverified</span>{" "}
              use draft numbers from an automated fetch of the BMG
              prerequisites page — check them against the live page and edit
              the rules table (see docs/bmg_rules.seed.json). Region and
              terrain constraints are only enforced where your logged areas
              carry that data.
            </p>
          )}
        </>
      )}
    </main>
  );
}
