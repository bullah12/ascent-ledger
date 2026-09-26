import Link from "next/link";
import { ArrowRight, MapPin, Mountain, Search } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SiteNav } from "@/components/site-nav";
import { PeakArtwork } from "@/components/peak-artwork";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { APPROVED_PUBLIC_ROUTE_WHERE } from "@/lib/routes/quality-policy";

export default async function PeaksPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireOnboardedUser();
  const { q: rawQuery } = await searchParams;
  const q = typeof rawQuery === "string" ? rawQuery.trim().slice(0, 100) : "";
  const peaks = await prisma.peak.findMany({
    where: q ? { OR: [
      { name: { contains: q, mode: "insensitive" } },
      { region: { contains: q, mode: "insensitive" } },
      { country: { contains: q, mode: "insensitive" } },
      { routes: { some: { ...APPROVED_PUBLIC_ROUTE_WHERE, name: { contains: q, mode: "insensitive" } } } },
    ] } : undefined,
    include: { routes: { where: APPROVED_PUBLIC_ROUTE_WHERE, select: { id: true, name: true, gradeRaw: true }, orderBy: { name: "asc" } } },
    orderBy: [{ country: "asc" }, { region: "asc" }, { name: "asc" }],
    take: 100,
  });
  peaks.sort((left, right) =>
    Number(right.country === "United Kingdom") - Number(left.country === "United Kingdom") ||
    left.region.localeCompare(right.region) || left.name.localeCompare(right.name)
  );

  return (
    <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-12 sm:px-6 lg:px-8">
      <SiteNav current="/peaks" />
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="instrument-label mb-2 text-primary">Featured mountains</p>
          <h1 className="page-title">Peaks worth exploring</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Find a mountain, then choose a hike or scramble. Each route has its own difficulty and details.</p>
        </div>
        <form action="/peaks" role="search" className="flex w-full gap-2 sm:w-auto">
          <label className="relative flex-1 sm:w-64"><span className="sr-only">Search peaks</span><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input name="q" defaultValue={q} placeholder="Peak, region or route…" className="pl-9" /></label>
          <Button type="submit">Search</Button>
        </form>
      </div>
      <p className="instrument-label mb-4">{peaks.length} {peaks.length === 1 ? "peak" : "peaks"}{q ? ` for “${q}”` : ""}</p>
      {peaks.length ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {peaks.map((peak) => (
            <article key={peak.id} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <PeakArtwork name={peak.name} imagePath={peak.imagePath} className="aspect-[16/9] w-full" sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw" />
              <div className="p-5">
                <p className="instrument-label flex items-center gap-1 text-primary"><MapPin className="size-3" />{peak.region} · {peak.country}</p>
                <h2 className="mt-2 text-2xl font-extrabold tracking-tight">{peak.name}</h2>
                {peak.summary && <p className="mt-2 text-sm leading-6 text-muted-foreground">{peak.summary}</p>}
                <div className="mt-5 border-t pt-4">
                  <p className="instrument-label mb-2 flex items-center gap-1"><Mountain className="size-3.5" />{peak.routes.length} {peak.routes.length === 1 ? "route" : "routes"}</p>
                  {peak.routes.map((route) => <Link key={route.id} href={`/routes/${route.id}`} className="flex items-center justify-between gap-3 rounded-lg py-2 text-sm font-semibold hover:text-primary"><span>{route.name}</span><ArrowRight className="size-4 shrink-0" /></Link>)}
                  {!peak.routes.length && <p className="text-sm text-muted-foreground">Route details are being prepared.</p>}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="rounded-xl border border-dashed p-10 text-center"><p className="font-semibold">No peaks found</p><Button className="mt-4" variant="outline" render={<Link href="/peaks" />}>Clear search</Button></div>}
      <p className="mt-8 text-xs leading-5 text-muted-foreground">Peak illustrations are stylised east to west terrain profiles, drawn from <a className="underline" href="https://www.opentopodata.org/datasets/srtm/">NASA SRTM data via OpenTopoData</a>. They are not route maps.</p>
    </main>
  );
}
