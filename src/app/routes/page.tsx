import Link from "next/link";
import { MapPin, Mountain, Plus, Search, Star } from "lucide-react";
import { Discipline } from "@/generated/prisma/enums";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { disciplineLabels } from "@/lib/climbs/labels";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type Params = Record<string, string | string[] | undefined>;

function values(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function FilterChip({ name, value, label, checked, type = "checkbox" }: { name: string; value: string; label: string; checked: boolean; type?: "checkbox" | "radio" }) {
  return <label className="cursor-pointer"><input className="peer sr-only" type={type} name={name} value={value} defaultChecked={checked} /><span className="inline-flex h-8 items-center rounded-lg border bg-card px-3 font-mono text-[11px] text-muted-foreground transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{label}</span></label>;
}

export default async function RoutesPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireOnboardedUser();
  const query = await searchParams;
  const selectedRegions = values(query.region);
  const selectedDisciplines = values(query.discipline).filter((item): item is Discipline => Object.values(Discipline).includes(item as Discipline));
  const selectedGrades = values(query.grade);
  const season = typeof query.season === "string" ? query.season : "any";
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const maxDistanceKm = typeof query.maxDistanceKm === "string" ? Number(query.maxDistanceKm) : 50;
  const maxAscentM = typeof query.maxAscentM === "string" ? Number(query.maxAscentM) : 2500;
  const sort = typeof query.sort === "string" ? query.sort : "rating";

  const where = {
    ...(selectedRegions.length ? { area: { region: { in: selectedRegions } } } : {}),
    ...(selectedDisciplines.length ? { discipline: { in: selectedDisciplines } } : {}),
    ...(selectedGrades.length ? { gradeRaw: { in: selectedGrades } } : {}),
    ...(season === "winter" ? { discipline: Discipline.winter } : season === "summer" ? { discipline: { not: Discipline.winter } } : {}),
    AND: [
      ...(q ? [{ OR: [{ name: { contains: q, mode: "insensitive" as const } }, { area: { name: { contains: q, mode: "insensitive" as const } } }] }] : []),
      { OR: [{ lengthM: null }, { lengthM: { lte: Math.max(1, maxDistanceKm) * 1000 } }] },
      { OR: [{ ascentM: null }, { ascentM: { lte: Math.max(0, maxAscentM) } }] },
    ],
  };

  const [routes, areaRows, gradeRows] = await Promise.all([
    prisma.route.findMany({
      where,
      include: { area: { select: { name: true, region: true } } },
      orderBy: sort === "distance" ? [{ lengthM: "asc" }, { name: "asc" }] : sort === "name" ? [{ name: "asc" }] : [{ avgRating: { sort: "desc", nulls: "last" } }, { reviewCount: "desc" }, { name: "asc" }],
      take: 500,
    }),
    prisma.area.findMany({ where: { region: { not: null } }, distinct: ["region"], select: { region: true }, orderBy: { region: "asc" } }),
    prisma.route.findMany({ where: { gradeRaw: { not: null } }, distinct: ["gradeRaw"], select: { gradeRaw: true }, orderBy: { gradeRaw: "asc" }, take: 16 }),
  ]);
  const regions = areaRows.flatMap((area) => area.region ? [area.region] : []);
  const grades = gradeRows.flatMap((route) => route.gradeRaw ? [route.gradeRaw] : []);

  return (
    <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-10 sm:px-6 lg:px-8">
      <SiteNav current="/routes" />
      <div className="mb-6 flex items-end justify-between gap-4 lg:hidden"><div><p className="instrument-label mb-2 text-primary">Route database</p><h1 className="page-title">Routes</h1></div><Button render={<Link href="/routes/new" />}><Plus /> Add</Button></div>

      <div className="overflow-hidden rounded-xl border bg-card lg:grid lg:min-h-[calc(100vh-120px)] lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b bg-secondary/35 lg:border-r lg:border-b-0">
          <form action="/routes" className="space-y-6 p-5">
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Filters</h2><Link href="/routes" className="font-mono text-[10px] uppercase tracking-[0.06em] text-primary hover:underline">Reset</Link></div>
            <label className="relative block"><span className="sr-only">Search routes</span><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input name="q" defaultValue={q} placeholder="Search routes…" className="h-10 bg-card pl-9" /></label>

            {regions.length > 0 && <fieldset><legend className="instrument-label mb-3">Region</legend><div className="flex flex-wrap gap-2">{regions.map((region) => <FilterChip key={region} name="region" value={region} label={region} checked={selectedRegions.includes(region)} />)}</div></fieldset>}

            <fieldset><legend className="instrument-label mb-3">Type</legend><div className="flex flex-wrap gap-2">{Object.values(Discipline).map((discipline) => <FilterChip key={discipline} name="discipline" value={discipline} label={disciplineLabels[discipline]} checked={selectedDisciplines.includes(discipline)} />)}</div></fieldset>

            {grades.length > 0 && <fieldset><legend className="instrument-label mb-3">Grade</legend><div className="flex flex-wrap gap-2">{grades.map((grade) => <FilterChip key={grade} name="grade" value={grade} label={grade} checked={selectedGrades.includes(grade)} />)}</div></fieldset>}

            <fieldset><legend className="instrument-label mb-3">Season</legend><div className="flex flex-wrap gap-2"><FilterChip type="radio" name="season" value="summer" label="Summer" checked={season === "summer"} /><FilterChip type="radio" name="season" value="winter" label="Winter" checked={season === "winter"} /><FilterChip type="radio" name="season" value="any" label="Any" checked={season === "any"} /></div></fieldset>

            <label className="block"><span className="instrument-label mb-2 flex justify-between"><span>Distance</span><span>up to {maxDistanceKm} km</span></span><input className="w-full" type="range" name="maxDistanceKm" min="1" max="100" step="1" defaultValue={maxDistanceKm} /></label>
            <label className="block"><span className="instrument-label mb-2 flex justify-between"><span>Ascent</span><span>up to {maxAscentM.toLocaleString()} m</span></span><input className="w-full" type="range" name="maxAscentM" min="0" max="4000" step="100" defaultValue={maxAscentM} /></label>
            <input type="hidden" name="sort" value={sort} />
            <Button type="submit" className="w-full">Apply filters</Button>
          </form>
        </aside>

        <section className="min-w-0">
          <header className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="instrument-label text-primary">{routes.length} routes</p>{q && <p className="mt-1 text-sm text-muted-foreground">Results for “{q}”</p>}</div>
            <div className="flex items-center gap-3">
              <form action="/routes" className="flex items-center gap-2">
                {Object.entries(query).flatMap(([name, raw]) => name === "sort" || raw === undefined ? [] : values(raw).map((value) => <input key={`${name}:${value}`} type="hidden" name={name} value={value} />))}
                <span className="instrument-label">Sort</span>
                <NativeSelect name="sort" defaultValue={sort} className="w-36"><option value="rating">Top rated</option><option value="distance">Distance</option><option value="name">Name</option></NativeSelect>
                <Button type="submit" variant="outline" size="sm">Apply</Button>
              </form>
              <Button className="hidden lg:inline-flex" render={<Link href="/routes/new" />}><Plus /> Add route</Button>
            </div>
          </header>

          {routes.length ? <div className="divide-y">{routes.map((route) => (
            <article key={route.id} className="group flex gap-4 p-5 transition-colors hover:bg-muted/35">
              <Link href={`/routes/${route.id}`} aria-label={`Open ${route.name}`} className="topographic-placeholder size-20 shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h2 className="truncate text-[17px] font-bold"><Link href={`/routes/${route.id}`} className="hover:text-primary hover:underline">{route.name}</Link></h2><p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground"><MapPin className="size-3" />{route.area?.name ?? route.area?.region ?? "Area not recorded"}</p></div><div className="shrink-0 text-right">{route.avgRating !== null ? <span className="flex items-center gap-1 font-mono text-sm text-amber-600"><Star className="size-3.5 fill-current" />{route.avgRating.toFixed(1)}</span> : <span className="font-mono text-[10px] text-muted-foreground">Unrated</span>}</div></div>
                <div className="mt-3 flex flex-wrap items-center gap-2"><Badge variant="secondary" className="bg-accent text-accent-foreground">{route.gradeRaw ?? disciplineLabels[route.discipline]}</Badge>{route.lengthM !== null && <Badge variant="secondary">↔ {(route.lengthM / 1000).toFixed(1)} km</Badge>}{route.ascentM !== null && <Badge variant="secondary"><Mountain className="size-3" /> {route.ascentM.toLocaleString()} m</Badge>}<span className="font-mono text-[10px] text-muted-foreground">{route.reviewCount} review{route.reviewCount === 1 ? "" : "s"}</span>{route.lat !== null && route.lng !== null && <Link href="/map" className="font-mono text-[10px] text-primary hover:underline">View on map</Link>}</div>
              </div>
            </article>
          ))}</div> : <div className="flex min-h-96 flex-col items-center justify-center p-10 text-center"><div className="topographic-placeholder mb-4 size-20 rounded-full" /><h2 className="text-lg font-bold">No routes match</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">Try widening a distance, ascent, region, or grade filter.</p><Button className="mt-4" variant="outline" render={<Link href="/routes" />}>Reset filters</Button></div>}
        </section>
      </div>
    </main>
  );
}
