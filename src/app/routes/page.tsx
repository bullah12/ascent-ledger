import Link from "next/link";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { disciplineLabels } from "@/lib/climbs/labels";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function RoutesPage() {
  await requireOnboardedUser();

  const routes = await prisma.route.findMany({
    include: { area: { select: { name: true } } },
    orderBy: [{ name: "asc" }],
    take: 500,
  });

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <SiteNav current="/routes" />
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Routes</h1>
          <p className="text-sm text-muted-foreground">
            {routes.length === 0
              ? "The route database is empty."
              : `${routes.length} route${routes.length === 1 ? "" : "s"} in the database.`}
          </p>
        </div>
        <Button render={<Link href="/routes/new" />}>Add a route</Button>
      </div>

      {routes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <p className="font-medium">No routes yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Seed the auditable starter packs, run the open-data importers, or
            add a route manually to link from your logbook and map.
          </p>
          <Button render={<Link href="/routes/new" />}>
            Add your first route
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Discipline</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Community</TableHead>
              <TableHead>Map</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((route) => (
              <TableRow key={route.id}>
                <TableCell className="font-medium">
                  <Link href={`/routes/${route.id}`} className="hover:underline">
                    {route.name}
                  </Link>
                </TableCell>
                <TableCell>{disciplineLabels[route.discipline]}</TableCell>
                <TableCell>{route.gradeRaw ?? "—"}</TableCell>
                <TableCell>{route.area?.name ?? "—"}</TableCell>
                <TableCell>
                  {route.avgRating === null
                    ? "—"
                    : `${route.avgRating.toFixed(1)}/5 (${route.reviewCount})`}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {route.lat !== null && route.lng !== null && (
                      <Badge variant="secondary">located</Badge>
                    )}
                    {route.pathGeojson !== null && (
                      <Badge variant="outline">track</Badge>
                    )}
                    {route.lat === null && route.lng === null && route.pathGeojson === null && (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    render={<Link href={`/routes/${route.id}/edit`} />}
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
