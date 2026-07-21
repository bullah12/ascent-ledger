import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock3, Heart, MapPin, Mountain, Route as RouteIcon, Star, TrendingUp } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { disciplineLabels, ascentStyleLabels } from "@/lib/climbs/labels";
import { sourceAttribution } from "@/lib/importers/source-attribution";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ReviewForm } from "./review-form";
import { ReviewList } from "./review-list";
import { RouteDetailMap } from "./route-detail-map";
import { deleteOwnReview, toggleRouteTag, toggleSavedRoute } from "./community-actions";
import { projectPublicTicks, safeDisplayName } from "@/lib/community/privacy";
import { tagChipsFromCounts } from "@/lib/community/tags";
import { lineStringOrNull } from "@/lib/tracks";

function formatDuration(minutes: number | null) {
  if (!minutes) return "Not recorded";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder} m` : `${hours} h`;
}

export default async function RouteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireOnboardedUser();
  const route = await prisma.route.findUnique({
    where: { id },
    include: {
      area: { select: { name: true, region: true, country: true } },
      sourceRecords: { where: { status: "active" }, orderBy: { source: "asc" } },
    },
  });
  if (!route) notFound();

  const [reviews, ownReview, tags, ownTags, publicTickRows, savedRoute] = await Promise.all([
    prisma.routeReview.findMany({
      where: { routeId: route.id },
      select: { id: true, rating: true, text: true, climbedOn: true, updatedAt: true, variant: true, conditions: true, user: { select: { displayName: true } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.routeReview.findUnique({
      where: { routeId_userId: { routeId: route.id, userId: user.id } },
      select: { rating: true, text: true, climbedOn: true, variant: true, conditions: true },
    }),
    prisma.tag.findMany({
      select: { id: true, slug: true, label: true, kind: true, _count: { select: { routeTags: { where: { routeId: route.id } } } } },
      orderBy: [{ kind: "asc" }, { label: "asc" }],
    }),
    prisma.routeTag.findMany({ where: { routeId: route.id, userId: user.id }, select: { tagId: true } }),
    prisma.climb.findMany({
      where: { routeId: route.id, visibility: "public" },
      select: { user: { select: { displayName: true } }, route: { select: { name: true } }, freeTextRouteName: true, visibility: true, date: true, gradeRaw: true, ascentStyle: true },
      orderBy: { date: "desc" },
      take: 100,
    }),
    prisma.savedRoute.findUnique({ where: { userId_routeId: { userId: user.id, routeId: route.id } }, select: { routeId: true } }),
  ]);

  const legacyAttribution = sourceAttribution(route.externalSource);
  const difficultyDerived = route.sourceRecords.some((record) => {
    const provenance = record.fieldProvenanceJson as { difficulty?: { derived?: boolean } } | null;
    return provenance?.difficulty?.derived;
  });
  const distanceCalculated = route.calculatedLengthM !== null && route.lengthM === route.calculatedLengthM;
  const displayedAscent = route.ascentM ?? route.calculatedAscentM;
  const ascentCalculated = route.ascentM === null && route.calculatedAscentM !== null;
  const displayedDuration = route.estimatedDurationMins ?? route.calculatedDurationMins;
  const durationCalculated = route.calculatedDurationMins !== null && route.estimatedDurationMins === route.calculatedDurationMins;
  const selectedTagIds = new Set(ownTags.map((tag) => tag.tagId));
  const publicTicks = projectPublicTicks(publicTickRows);
  const tagChips = tagChipsFromCounts(tags);
  const characterTags = tags.filter((tag) => tag._count.routeTags > 0 && (tag.kind === "character" || tag.kind === "hazard")).slice(0, 2);
  const geometry = lineStringOrNull(route.pathGeojson);
  const location = route.lat !== null && route.lng !== null ? { lat: route.lat, lng: route.lng } : null;
  const areaLine = [route.area?.name, route.area?.region, route.area?.country].filter(Boolean).join(" · ") || "Area not recorded";

  return (
    <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-10 sm:px-6 lg:px-8">
      <SiteNav current="/routes" />

      <section className="topographic-placeholder relative -mt-8 min-h-[310px] overflow-hidden rounded-b-2xl text-white sm:-mx-6 lg:-mx-8">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(14,38,27,.48),rgba(14,38,27,.93))]" />
        <div className="relative flex min-h-[310px] flex-col justify-between p-6 sm:p-9">
          <Link href="/routes" className="w-fit font-mono text-[11px] uppercase tracking-[0.06em] text-white/75 hover:text-white">‹ Routes / {route.area?.name ?? "route"}</Link>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge className="bg-clay text-clay-foreground">{route.gradeRaw ?? disciplineLabels[route.discipline]}</Badge>
                {characterTags.map((tag) => <Badge key={tag.id} className="bg-white/15 text-white backdrop-blur">{tag.label}</Badge>)}
              </div>
              <h1 className="max-w-4xl text-4xl leading-tight font-extrabold tracking-[-0.025em] sm:text-5xl">{route.name}</h1>
              <p className="mt-2 font-mono text-[11px] text-white/70 sm:text-xs">{areaLine}{location ? ` · ${location.lat.toFixed(4)}°N ${Math.abs(location.lng).toFixed(4)}°${location.lng < 0 ? "W" : "E"}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={toggleSavedRoute}>
                <input type="hidden" name="routeId" value={route.id} />
                <input type="hidden" name="saved" value={String(Boolean(savedRoute))} />
                <Button type="submit" variant="outline" className="border-white/40 bg-black/15 text-white hover:bg-white/15 hover:text-white"><Heart className={savedRoute ? "fill-current" : ""} />{savedRoute ? "Saved" : "Save"}</Button>
              </form>
              <Button render={<Link href={`/logbook/new?routeId=${route.id}`} />}><span aria-hidden>+</span> Log this route</Button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid lg:grid-cols-2">
        <div className="space-y-8 py-8 lg:pr-8">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: `Distance${route.lengthM !== null ? distanceCalculated ? " · calculated" : " · official" : ""}`, value: route.lengthM ? `${(route.lengthM / 1000).toFixed(1)} km` : "—", icon: RouteIcon },
              { label: `Ascent${displayedAscent !== null ? ascentCalculated ? " · calculated" : " · official" : ""}`, value: displayedAscent !== null ? `${displayedAscent.toLocaleString()} m` : "—", icon: TrendingUp },
              { label: `Time${displayedDuration !== null ? durationCalculated ? " · calculated" : " · official" : ""}`, value: formatDuration(displayedDuration), icon: Clock3 },
              { label: `Grade${difficultyDerived ? " · derived" : route.gradeRaw ? " · source" : ""}`, value: route.gradeRaw ?? "—", icon: Mountain },
            ].map((stat) => (
              <Card key={stat.label} className="gap-2 p-4 py-4">
                <dt className="instrument-label flex items-center gap-1.5"><stat.icon className="size-3.5 text-primary" />{stat.label}</dt>
                <dd className="text-lg font-bold">{stat.value}</dd>
              </Card>
            ))}
          </dl>

          <section>
            <h2 className="text-xl font-bold">The route</h2>
            {(route.geometryCompleteness === "incomplete" || route.geometryCompleteness === "clipped") && (
              <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                Route geometry is {route.geometryCompleteness}. Some sections may be disconnected or clipped at an extract boundary.
              </p>
            )}
            {route.description ? <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-foreground/85">{route.description}</p> : <p className="mt-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No route description has been recorded yet.</p>}
          </section>

          <section>
            <h2 className="text-xl font-bold">What to expect</h2>
            {tagChips.length ? (
              <ul className="mt-4 grid gap-2">
                {tagChips.map((tag) => <li key={tag.slug} className="flex items-center gap-3"><span className="size-2 rounded-full bg-primary" /><span><strong>{tag.label}</strong> <span className="font-mono text-[10px] text-muted-foreground">· {tag.count} community tag{tag.count === 1 ? "" : "s"}</span></span></li>)}
              </ul>
            ) : <p className="mt-3 text-sm text-muted-foreground">No community character or hazard tags yet.</p>}

            <details className="mt-5 rounded-xl border bg-secondary/25 p-4">
              <summary className="cursor-pointer font-semibold">Add or remove your route tags</summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const selected = selectedTagIds.has(tag.id);
                  return (
                    <form key={tag.id} action={toggleRouteTag}>
                      <input type="hidden" name="routeId" value={route.id} />
                      <input type="hidden" name="slug" value={tag.slug} />
                      <input type="hidden" name="selected" value={String(selected)} />
                      <Button type="submit" size="sm" variant={selected ? "default" : "outline"}>{tag.label}{tag._count.routeTags ? ` (${tag._count.routeTags})` : ""}</Button>
                    </form>
                  );
                })}
              </div>
            </details>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" render={<Link href={`/routes/${route.id}/edit`} />}>Edit route details</Button>
            {(route.sourceRecords[0] || legacyAttribution) && <Button variant="ghost" render={<a href={route.sourceRecords[0]?.externalUrl ?? route.externalUrl ?? legacyAttribution!.sourceUrl} />}>View source record</Button>}
          </div>

          {(route.sourceRecords.length > 0 || legacyAttribution) && (
            <section className="rounded-xl border p-4">
              <h2 className="font-bold">Sources and licences</h2>
              <ul className="mt-3 grid gap-3 text-sm">
                {route.sourceRecords.map((record) => (
                  <li key={record.id}>
                    <a className="font-medium underline" href={record.externalUrl}>{record.sourceName}</a>
                    <span className="block text-muted-foreground">{record.attribution} · {record.licence}{record.sourceUpdatedAt ? ` · updated ${record.sourceUpdatedAt.toISOString().slice(0, 10)}` : ""}</span>
                    {record.licenceUrl && <a className="text-xs underline" href={record.licenceUrl}>Licence terms</a>}
                  </li>
                ))}
                {!route.sourceRecords.length && legacyAttribution && (
                  <li>{legacyAttribution.attribution} · <a className="underline" href={legacyAttribution.licenceUrl}>{legacyAttribution.licence}</a></li>
                )}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-7 border-t py-8 lg:border-t-0 lg:border-l lg:pl-8">
          <Card className="gap-0 overflow-hidden p-0 py-0">
            <RouteDetailMap geometry={geometry} point={location} />
            <div className="flex items-center gap-2 border-t px-4 py-3 font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground"><MapPin className="size-3.5 text-primary" />{geometry ? "Start · route line · finish" : areaLine}</div>
          </Card>

          <section>
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Reviews <span className="font-normal text-muted-foreground">· {route.reviewCount}</span></h2>
              {route.avgRating !== null && <span className="flex items-center gap-1 font-mono text-sm text-amber-600"><Star className="size-4 fill-current" />{route.avgRating.toFixed(1)}</span>}
            </div>
            <p className="mb-4 text-sm text-muted-foreground">Filter by the variant and conditions each climber completed.</p>
            <ReviewList reviews={reviews.map((review) => ({ id: review.id, displayName: safeDisplayName(review.user.displayName), rating: review.rating, text: review.text, climbedOn: review.climbedOn?.toISOString().slice(0, 10) ?? null, updatedAt: review.updatedAt.toISOString(), variant: review.variant, conditions: review.conditions }))} />
          </section>

          <ReviewForm routeId={route.id} existing={ownReview ? { rating: ownReview.rating, text: ownReview.text, climbedOn: ownReview.climbedOn?.toISOString().slice(0, 10) ?? null, variant: ownReview.variant, conditions: ownReview.conditions } : null} />
          {ownReview && <form action={deleteOwnReview.bind(null, route.id)}><Button type="submit" size="sm" variant="ghost" className="text-destructive">Delete my review</Button></form>}

          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer font-semibold">Public ticks · {publicTicks.length}</summary>
            <p className="mt-2 text-sm text-muted-foreground">Only climbs whose owner explicitly opted in are shown.</p>
            <ul className="mt-3 grid gap-2">
              {publicTicks.map((tick, index) => <li key={`${tick.displayName}:${tick.date}:${index}`} className="rounded-lg bg-secondary/40 p-3 text-sm"><span className="font-medium">{tick.displayName}</span><span className="text-muted-foreground">{` · ${tick.date} · ${tick.grade} · ${ascentStyleLabels[tick.ascentStyle]}`}</span></li>)}
              {!publicTicks.length && <li className="text-sm text-muted-foreground">No public ticks yet.</li>}
            </ul>
          </details>
        </aside>
      </div>
    </main>
  );
}
