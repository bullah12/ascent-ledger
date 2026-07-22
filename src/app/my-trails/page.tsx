import Link from "next/link";
import { Plus } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { disciplineLabels } from "@/lib/climbs/labels";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ownedCustomTrailWhere } from "@/lib/routes/custom-trails";

export default async function MyTrailsPage() {
  const user = await requireOnboardedUser();
  const trails = await prisma.customTrail.findMany({
    where: ownedCustomTrailWhere(user.id),
    include: { _count: { select: { climbs: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-10 sm:px-6">
    <SiteNav current="/my-trails" />
    <header className="mb-6 flex items-end justify-between gap-4">
      <div><p className="instrument-label mb-2 text-primary">Private to your account</p><h1 className="page-title">My trails</h1><p className="mt-2 text-sm text-muted-foreground">Personal trail geometry never appears in the shared route catalogue.</p></div>
      <Button render={<Link href="/my-trails/new" />}><Plus /> New trail</Button>
    </header>
    {trails.length ? <div className="grid gap-3 sm:grid-cols-2">{trails.map((trail) => <Link key={trail.id} href={`/my-trails/${trail.id}`} className="rounded-xl border bg-card p-5 hover:border-primary">
      <h2 className="font-bold">{trail.name}</h2>
      <div className="mt-3 flex flex-wrap gap-2"><Badge variant="secondary">{disciplineLabels[trail.discipline]}</Badge>{trail.gradeRaw && <Badge variant="outline">{trail.gradeRaw}</Badge>}<span className="text-xs text-muted-foreground">{trail._count.climbs} linked log{trail._count.climbs === 1 ? "" : "s"}</span></div>
      {trail.areaName && <p className="mt-2 text-sm text-muted-foreground">{trail.areaName}</p>}
    </Link>)}</div> : <div className="rounded-xl border border-dashed p-10 text-center"><p className="font-semibold">No private trails yet</p><p className="mt-1 text-sm text-muted-foreground">Draw a line or upload GPX/KML, then link it to your own log entries.</p></div>}
  </main>;
}
