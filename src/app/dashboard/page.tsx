import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evaluateProgress, type CategoryProgress, type RuleProgress } from "@/lib/bmg/engine";
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

function RuleRow({ rule }: { rule: RuleProgress }) {
  return (
    <div className="border-t px-6 py-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="text-sm font-medium">
          {rule.description}
          {rule.thresholdLabel ? (
            <span className="text-muted-foreground"> · {rule.thresholdLabel}+</span>
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
    </div>
  );
}

function CategoryCard({ category }: { category: CategoryProgress }) {
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
            <RuleRow key={rule.id} rule={rule} />
          ))}
        </div>
      </details>
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();

  const [categories, climbs] = await Promise.all([
    prisma.bmgCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: { rules: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.climb.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        discipline: true,
        date: true,
        ascentStyle: true,
        gradeSystem: true,
        gradeRaw: true,
        gradeNormalisedScore: true,
        area: { select: { id: true, name: true, region: true, country: true } },
      },
    }),
  ]);

  const progress = evaluateProgress(categories, climbs);
  const hasUnverified = categories.some((c) => c.rules.some((r) => !r.verified));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-6">
      <SiteNav current="/dashboard" />
      <div className="mb-6 flex items-center justify-between gap-4">
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

      {categories.length === 0 ? (
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
              <CategoryCard key={category.id} category={category} />
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
