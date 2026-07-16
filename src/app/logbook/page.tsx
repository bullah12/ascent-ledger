import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ClimbTable, type ClimbRow } from "./climb-table";
import { SiteNav } from "@/components/site-nav";
import { Button } from "@/components/ui/button";

export default async function LogbookPage() {
  const user = await requireUser();

  const climbs = await prisma.climb.findMany({
    where: { userId: user.id },
    include: { area: { select: { name: true } } },
    orderBy: { date: "desc" },
  });

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
