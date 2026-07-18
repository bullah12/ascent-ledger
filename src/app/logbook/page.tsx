import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ClimbTable, type ClimbRow } from "./climb-table";
import { LinkSuggestions, type SuggestionRow } from "./link-suggestions";
import { SiteNav } from "@/components/site-nav";
import { Button } from "@/components/ui/button";

export default async function LogbookPage() {
  const user = await requireUser();

  const [climbs, pendingSuggestions] = await Promise.all([
    prisma.climb.findMany({
      where: { userId: user.id },
      include: { area: { select: { name: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.climbRouteSuggestion.findMany({
      where: { status: "pending", climb: { userId: user.id } },
      include: {
        climb: { select: { freeTextRouteName: true, date: true } },
        route: {
          select: {
            name: true,
            gradeRaw: true,
            externalUrl: true,
            area: { select: { name: true } },
          },
        },
      },
      orderBy: { score: "desc" },
      take: 20,
    }),
  ]);

  const suggestionRows: SuggestionRow[] = pendingSuggestions.map((s) => ({
    id: s.id,
    climbName: s.climb.freeTextRouteName,
    climbDate: s.climb.date.toISOString().slice(0, 10),
    routeName: s.route.name,
    routeGrade: s.route.gradeRaw,
    routeArea: s.route.area?.name ?? null,
    routeUrl: s.route.externalUrl,
  }));

  const rows: ClimbRow[] = climbs.map((climb) => ({
    id: climb.id,
    routeName: climb.freeTextRouteName,
    discipline: climb.discipline,
    date: climb.date.toISOString().slice(0, 10),
    gradeRaw: climb.gradeRaw,
    ascentStyle: climb.ascentStyle,
    areaName: climb.area?.name ?? null,
    notes: climb.notes,
  }));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <SiteNav current="/logbook" />
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Logbook</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "No climbs logged yet."
              : `${rows.length} climb${rows.length === 1 ? "" : "s"} logged.`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href="/logbook/import" />}>
            Import CSV
          </Button>
          <Button render={<Link href="/logbook/new" />}>Log a climb</Button>
        </div>
      </div>

      <LinkSuggestions suggestions={suggestionRows} />

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <p className="font-medium">Your logbook is empty</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Log your first climb to start building your record toward the BMG
            prerequisites.
          </p>
          <Button render={<Link href="/logbook/new" />}>
            Log your first climb
          </Button>
        </div>
      ) : (
        <ClimbTable climbs={rows} />
      )}
    </main>
  );
}
