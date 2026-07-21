import Link from "next/link";
import { ChevronDown, CircleCheck, CircleHelp, MapPin } from "lucide-react";
import type { GradeSystem } from "@/generated/prisma/enums";
import type { CategoryProgress, RuleProgress } from "@/lib/bmg/engine";
import { gradeSystemLabels } from "@/lib/grades";
import type {
  CategorySuggestions,
  RouteSuggestion,
} from "@/lib/recommender";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

type CategoryStatus = {
  label: "Complete" | "On Track" | "Priority";
  badgeClassName: string;
  progressClassName?: string;
};

function categoryStatus(percent: number): CategoryStatus {
  if (percent >= 100) {
    return {
      label: "Complete",
      badgeClassName: "bg-accent text-accent-foreground",
    };
  }
  if (percent < 45) {
    return {
      label: "Priority",
      badgeClassName: "bg-clay-muted text-clay",
      progressClassName: "bg-clay",
    };
  }
  return {
    label: "On Track",
    badgeClassName: "bg-secondary text-secondary-foreground",
  };
}

function CategoryProgressBar({
  value,
  indicatorClassName,
  label,
}: {
  value: number;
  indicatorClassName?: string;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className="block h-2.5 w-full overflow-hidden rounded-full bg-secondary"
    >
      <span
        aria-hidden="true"
        className={`block h-full rounded-full ${indicatorClassName ?? "bg-primary"}`}
        style={{ width: `${clamped}%` }}
      />
    </span>
  );
}

function SuggestedRoutes({ suggestions }: { suggestions: RouteSuggestion[] }) {
  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No matching route is currently available for this exact requirement.
      </p>
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {suggestions.map((suggestion) => (
        <li key={suggestion.routeId}>
          <Link
            href={`/routes/${suggestion.routeId}`}
            className="group block h-full rounded-lg border bg-background p-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-start justify-between gap-3">
              <strong className="min-w-0 text-sm group-hover:text-primary group-hover:underline">
                {suggestion.name}
              </strong>
              <MapPin aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary" />
            </span>
            <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
              {[suggestion.gradeRaw, suggestion.areaName].filter(Boolean).join(" · ") ||
                "Grade and area not recorded"}
            </span>
            <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
              {suggestion.why}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RuleRow({
  rule,
  suggestions,
}: {
  rule: RuleProgress;
  suggestions: RouteSuggestion[];
}) {
  const result = rule.met
    ? "Complete"
    : rule.stillNeeded > 0
      ? `${rule.stillNeeded} more needed`
      : "Count met — see notes";

  return (
    <section data-rule-id={rule.id} className="px-4 py-5 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="instrument-label mb-1">Requirement</p>
          <h3 className="text-[15px] font-bold leading-snug">{rule.description}</h3>
          {rule.thresholdLabel && rule.gradeSystem ? (
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              Grade threshold: {rule.thresholdLabel}+ · {gradeSystemLabels[rule.gradeSystem]}
            </p>
          ) : (
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              Count-based requirement · no grade threshold
            </p>
          )}
        </div>
        <Badge
          variant={rule.verified ? "secondary" : "outline"}
          className={rule.verified ? undefined : "border-clay/30 text-clay"}
        >
          {rule.verified ? "Verified rule" : "Unverified rule"}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <Progress
          value={rule.percent}
          className="h-2.5"
          indicatorClassName={rule.met ? "bg-primary" : "bg-clay"}
        />
        <p className="font-mono text-xs tabular-nums text-muted-foreground sm:min-w-28 sm:text-right">
          {rule.actualCount} / {rule.minCount} counted
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {rule.met ? (
          <CircleCheck aria-hidden="true" className="size-4 text-primary" />
        ) : (
          <CircleHelp aria-hidden="true" className="size-4 text-clay" />
        )}
        <strong>{result}</strong>
      </div>

      {rule.notes.length > 0 && (
        <div className="mt-3 rounded-lg bg-clay-muted/60 px-3 py-2.5">
          <p className="instrument-label mb-1 text-clay">Constraint and data-quality notes</p>
          <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            {rule.notes.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 border-t pt-4">
        <p className="instrument-label mb-2">Routes for this requirement</p>
        {rule.met ? (
          <p className="text-sm text-muted-foreground">
            This requirement is complete, so no gap-specific routes are needed.
          </p>
        ) : (
          <SuggestedRoutes suggestions={suggestions} />
        )}
      </div>
    </section>
  );
}

function CategoryCard({
  category,
  suggestionsByRule,
}: {
  category: CategoryProgress;
  suggestionsByRule: Map<string, RouteSuggestion[]>;
}) {
  const actual = category.rules.reduce(
    (sum, rule) => sum + Math.min(rule.actualCount, rule.minCount),
    0,
  );
  const required = category.rules.reduce((sum, rule) => sum + rule.minCount, 0);
  const status = categoryStatus(category.percent);

  return (
    <Card className="gap-0 py-0">
      <details className="group">
        <summary className="cursor-pointer list-none rounded-xl px-4 py-5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-6 [&::-webkit-details-marker]:hidden">
          <span className="block">
            <span className="flex items-start justify-between gap-4">
              <span className="min-w-0">
                <strong className="block text-[17px] leading-snug">{category.label}</strong>
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                  {category.description ?? `${category.totalRules} tracked prerequisite requirements`}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge className={status.badgeClassName}>{status.label.toUpperCase()}</Badge>
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </span>
            </span>

            <span className="mt-5 grid grid-cols-3 gap-3">
              <span>
                <span className="block text-2xl font-extrabold tabular-nums">{category.percent}%</span>
                <span className="instrument-label block">Complete</span>
              </span>
              <span>
                <span className="block text-2xl font-extrabold tabular-nums">
                  {category.metRules} / {category.totalRules}
                </span>
                <span className="instrument-label block">Requirements met</span>
              </span>
              <span>
                <span className="block text-2xl font-extrabold tabular-nums">
                  {actual} / {required}
                </span>
                <span className="instrument-label block">Aggregate count</span>
              </span>
            </span>

            <span className="mt-4 block">
              <CategoryProgressBar
                value={category.percent}
                indicatorClassName={status.progressClassName}
                label={`${category.label}: ${category.percent}% complete`}
              />
            </span>

            <span className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                {category.metRules} of {category.totalRules} requirements met
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.05em]">
                Expand for every requirement
              </span>
            </span>

            {category.ungradedCount > 0 && (
              <span className="mt-3 block rounded-lg bg-clay-muted/60 px-3 py-2 text-xs leading-relaxed text-clay">
                {category.ungradedCount} climb{category.ungradedCount === 1 ? "" : "s"} with an
                unrecognised grade; {category.ungradedCount === 1 ? "it is" : "they are"} not counted
                toward graded requirements.
              </span>
            )}
          </span>
        </summary>

        <div className="border-t bg-muted/20">
          <div className="flex flex-col gap-2 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <p className="font-semibold">Detailed requirements</p>
              <p className="text-xs text-muted-foreground">
                Counts, thresholds, caveats, and routes are shown per configured rule.
              </p>
            </div>
            {category.ungradedCount > 0 && (
              <Link href="/logbook" className="text-xs font-semibold text-primary hover:underline">
                Review grades in logbook →
              </Link>
            )}
          </div>
          <div className="divide-y">
            {category.rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                suggestions={suggestionsByRule.get(rule.id) ?? []}
              />
            ))}
          </div>
        </div>
      </details>
    </Card>
  );
}

function InfoDisclosure({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border bg-background">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-4 py-4 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t px-4 py-4 text-sm leading-relaxed text-muted-foreground sm:px-5">
        {children}
      </div>
    </details>
  );
}

function ProgressInformation({
  progress,
  hasUnverified,
}: {
  progress: CategoryProgress[];
  hasUnverified: boolean;
}) {
  const gradeSystems = Array.from(
    new Set(
      progress
        .flatMap((category) => category.rules.map((rule) => rule.gradeSystem))
        .filter((system): system is GradeSystem => system !== null),
    ),
  );

  return (
    <Card className="mt-8">
      <CardHeader className="border-b">
        <p className="instrument-label text-primary">Reading your progression</p>
        <CardTitle className="text-[20px] font-bold">What these numbers mean</CardTitle>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          This is a transparent comparison between your logbook and the configured BMG
          prerequisites. It is a planning aid, not a substitute for current BMG guidance,
          instruction, judgement, or an assessment of overall readiness.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 py-5 lg:grid-cols-2">
        <InfoDisclosure title="How BMG progress is calculated">
          <p>
            Each rule counts logbook entries in the same discipline that meet its grade,
            style, and checkable location constraints. Progress for a rule is its qualifying
            count divided by its required count, capped at 100%. A category percentage adds
            those capped counts and divides them by all counts required in that category; the
            overall figure is the average of the category percentages.
          </p>
          <p className="mt-3 font-medium text-foreground">
            Percentages represent completion of configured prerequisites, not a general
            assessment of readiness to apply or work independently.
          </p>
        </InfoDisclosure>

        <InfoDisclosure title="Grade systems used here">
          {gradeSystems.length > 0 ? (
            <>
              <p>The loaded graded rules use:</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {gradeSystems.map((system) => (
                  <li key={system}>
                    <Badge variant="secondary">{gradeSystemLabels[system]}</Badge>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No graded rules are currently loaded.</p>
          )}
          <p className="mt-3">
            Grades are compared only within their own ordinal system; Ascent Ledger does not
            convert one grading system into another. See the{" "}
            <Link href="/help/grades" className="font-medium text-primary underline">
              complete grade-system guide
            </Link>
            .
          </p>
        </InfoDisclosure>

        <InfoDisclosure title="Unrecognised grades and data quality">
          <p>
            A grade that cannot be recognised remains in your logbook but cannot count toward
            a graded rule. It can still count toward a rule with no grade threshold. Review the
            original grade and selected grade system in your{" "}
            <Link href="/logbook" className="font-medium text-primary underline">
              logbook
            </Link>
            , and use the <Link href="/help/grades" className="font-medium text-primary underline">grade guide</Link>{" "}
            for supported formats.
          </p>
          <p className="mt-3">
            A verified rule has been confirmed in the loaded prerequisite configuration. An
            unverified rule uses draft source numbers that should be checked against current
            BMG material. {hasUnverified ? "At least one loaded rule is unverified." : "All currently loaded rules are marked verified."}
          </p>
        </InfoDisclosure>

        <InfoDisclosure title="Constraints the logbook cannot fully verify">
          <p>
            Terrain type, access method, and consecutive overnight stays are not represented
            reliably in the current data, so they are shown as notes rather than enforced.
            Region filters are applied when area region or country metadata exists, but an
            entry with only a free-text or name-only area is not rejected; regional progress
            is therefore not a definitive audit. Each logged entry also counts as one day when
            a rule is expressed in days.
          </p>
        </InfoDisclosure>

        <InfoDisclosure title="How route suggestions close a gap">
          <p>
            Suggestions are calculated separately for each incomplete rule and displayed only
            beneath that exact requirement. They use the rule&apos;s discipline, grade system, grade
            window, and available region constraints, then rank unlogged routes using grade fit,
            quality, area diversity, and distance. The explanation beneath each route shows why
            it was selected for that progression gap.
          </p>
          <p className="mt-3">
            These gap-specific routes are separate from the broader preference-based ideas on
            the <Link href="/for-you" className="font-medium text-primary underline">For you</Link> page.
          </p>
        </InfoDisclosure>
      </CardContent>
    </Card>
  );
}

export function ProgressContent({
  progress,
  categorySuggestions,
  hasUnverified,
}: {
  progress: CategoryProgress[];
  categorySuggestions: CategorySuggestions[];
  hasUnverified: boolean;
}) {
  const suggestionsByRule = new Map(
    categorySuggestions.flatMap((category) =>
      category.rules.map((rule) => [rule.ruleId, rule.suggestions] as const),
    ),
  );

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        {progress.map((category) => (
          <CategoryCard
            key={category.id}
            category={category}
            suggestionsByRule={suggestionsByRule}
          />
        ))}
      </div>
      <ProgressInformation progress={progress} hasUnverified={hasUnverified} />
    </>
  );
}
