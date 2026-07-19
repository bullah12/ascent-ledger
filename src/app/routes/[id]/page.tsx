import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { disciplineLabels } from "@/lib/climbs/labels";
import { gradeSystemLabels } from "@/lib/grades";
import { sourceAttribution } from "@/lib/importers/source-attribution";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GradeHint } from "@/components/grade-hint";
import { ReviewForm } from "./review-form";
import {
  deleteOwnReview,
  toggleRouteTag,
} from "./community-actions";
import { projectPublicTicks, safeDisplayName } from "@/lib/community/privacy";
import { ascentStyleLabels } from "@/lib/climbs/labels";
import { tagChipsFromCounts } from "@/lib/community/tags";

export default async function RouteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireOnboardedUser();
  const route = await prisma.route.findUnique({
    where: { id },
    include: { area: { select: { name: true, region: true, country: true } } },
  });
  if (!route) notFound();
  const attribution = sourceAttribution(route.externalSource);
  const [reviews, ownReview, tags, ownTags, publicTickRows] = await Promise.all([
    prisma.routeReview.findMany({
      where: { routeId: route.id },
      select: {
        id: true,
        rating: true,
        text: true,
        climbedOn: true,
        updatedAt: true,
        user: { select: { displayName: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.routeReview.findUnique({
      where: { routeId_userId: { routeId: route.id, userId: user.id } },
      select: { rating: true, text: true, climbedOn: true },
    }),
    prisma.tag.findMany({
      select: {
        id: true,
        slug: true,
        label: true,
        kind: true,
        _count: { select: { routeTags: { where: { routeId: route.id } } } },
      },
      orderBy: [{ kind: "asc" }, { label: "asc" }],
    }),
    prisma.routeTag.findMany({
      where: { routeId: route.id, userId: user.id },
      select: { tagId: true },
    }),
    prisma.climb.findMany({
      where: { routeId: route.id, visibility: "public" },
      select: {
        user: { select: { displayName: true } },
        route: { select: { name: true } },
        freeTextRouteName: true,
        visibility: true,
        date: true,
        gradeRaw: true,
        ascentStyle: true,
      },
      orderBy: { date: "desc" },
      take: 100,
    }),
  ]);
  const selectedTagIds = new Set(ownTags.map((tag) => tag.tagId));
  const publicTicks = projectPublicTicks(publicTickRows);
  const tagChips = tagChipsFromCounts(tags);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <SiteNav current="/routes" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge>{disciplineLabels[route.discipline]}</Badge>
            {route.pathGeojson && <Badge variant="outline">route geometry</Badge>}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{route.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[route.area?.name, route.area?.region, route.area?.country]
              .filter(Boolean)
              .join(" · ") || "Area not recorded"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href={`/routes/${route.id}/edit`} />}>
            Edit
          </Button>
          <Button render={<Link href={`/logbook/new?routeId=${route.id}`} />}>
            Log this route
          </Button>
        </div>
      </div>

      <dl className="grid gap-4 rounded-lg border p-5 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Grade</dt>
          <dd className="font-medium">
            {route.gradeRaw ?? "Not graded"}
            {route.gradeSystem ? ` · ${gradeSystemLabels[route.gradeSystem]}` : ""}
            {route.gradeSystem && <GradeHint system={route.gradeSystem} />}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Distance</dt>
          <dd className="font-medium">
            {route.lengthM ? `${(route.lengthM / 1_000).toFixed(1)} km` : "Not recorded"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Community rating</dt>
          <dd className="font-medium">
            {route.avgRating === null
              ? "No reviews"
              : `${route.avgRating.toFixed(1)}/5 · ${route.reviewCount} review${route.reviewCount === 1 ? "" : "s"}`}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Source quality</dt>
          <dd className="font-medium">
            {route.qualityRating === null ? "Not rated by source" : `${route.qualityRating}/5`}
          </dd>
        </div>
        {route.description && (
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted-foreground">Description</dt>
            <dd className="whitespace-pre-wrap">{route.description}</dd>
          </div>
        )}
      </dl>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Route tags</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {tagChips.map((tag) => (
            <Badge key={tag.slug} variant="secondary">
              {tag.label} · {tag.count}
            </Badge>
          ))}
          {tagChips.length === 0 && (
            <p className="text-sm text-muted-foreground">No community tags yet.</p>
          )}
        </div>
        <details className="mt-3 rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Add or remove your tags</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.map((tag) => {
              const selected = selectedTagIds.has(tag.id);
              return (
                <form key={tag.id} action={toggleRouteTag}>
                  <input type="hidden" name="routeId" value={route.id} />
                  <input type="hidden" name="slug" value={tag.slug} />
                  <input type="hidden" name="selected" value={String(selected)} />
                  <Button type="submit" size="sm" variant={selected ? "default" : "outline"}>
                    {tag.label}{tag._count.routeTags > 0 ? ` (${tag._count.routeTags})` : ""}
                  </Button>
                </form>
              );
            })}
          </div>
        </details>
      </section>

      <section className="mt-8 grid gap-4">
        <h2 className="text-lg font-semibold">Reviews</h2>
        <ReviewForm
          routeId={route.id}
          existing={ownReview ? {
            rating: ownReview.rating,
            text: ownReview.text,
            climbedOn: ownReview.climbedOn?.toISOString().slice(0, 10) ?? null,
          } : null}
        />
        {ownReview && (
          <form action={deleteOwnReview.bind(null, route.id)}>
            <Button type="submit" size="sm" variant="ghost" className="text-destructive">
              Delete my review
            </Button>
          </form>
        )}
        <div className="grid gap-3">
          {reviews.map((review) => (
            <article key={review.id} className="rounded-lg border p-4 text-sm">
              <div className="flex justify-between gap-3">
                <p className="font-medium">{safeDisplayName(review.user.displayName)}</p>
                <p>{review.rating}/5</p>
              </div>
              {review.climbedOn && (
                <p className="text-xs text-muted-foreground">Climbed {review.climbedOn.toISOString().slice(0, 10)}</p>
              )}
              {review.text && <p className="mt-2 whitespace-pre-wrap">{review.text}</p>}
            </article>
          ))}
          {reviews.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet.</p>}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Public ticks</h2>
        <p className="text-sm text-muted-foreground">
          Only climbs whose owner explicitly opted in are shown.
        </p>
        <ul className="mt-3 grid gap-2">
          {publicTicks.map((tick, index) => (
            <li key={`${tick.displayName}:${tick.date}:${index}`} className="rounded-lg border p-3 text-sm">
              <span className="font-medium">{tick.displayName}</span>
              <span className="text-muted-foreground">
                {` · ${tick.routeName} · ${tick.date} · ${tick.grade} · ${ascentStyleLabels[tick.ascentStyle]}`}
              </span>
            </li>
          ))}
          {publicTicks.length === 0 && <li className="text-sm text-muted-foreground">No public ticks yet.</li>}
        </ul>
      </section>

      {attribution && (
        <aside className="mt-6 rounded-lg bg-muted/50 p-4 text-sm">
          <p className="font-medium">Source and licence</p>
          <p className="mt-1 text-muted-foreground">{attribution.attribution}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <a className="underline" href={route.externalUrl ?? attribution.sourceUrl}>
              View source record
            </a>
            <a className="underline" href={attribution.licenceUrl}>
              {attribution.licence}
            </a>
          </div>
        </aside>
      )}
    </main>
  );
}
