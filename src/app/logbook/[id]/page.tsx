import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ascentStyleLabels,
  disciplineLabels,
} from "@/lib/climbs/labels";
import { gradeSystemLabels } from "@/lib/grades";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GradeHint } from "@/components/grade-hint";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export default async function ClimbDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireOnboardedUser();

  const climb = await prisma.climb.findFirst({
    where: { id, userId: user.id },
    include: {
      area: { select: { name: true } },
      route: { select: { name: true, externalUrl: true } },
    },
  });
  if (!climb) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <SiteNav current="/logbook" />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {climb.freeTextRouteName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {climb.date.toISOString().slice(0, 10)}
            {climb.area ? ` · ${climb.area.name}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href={`/logbook/${climb.id}/edit`} />}>
            Edit
          </Button>
          <Button variant="ghost" render={<Link href="/logbook" />}>
            Back
          </Button>
        </div>
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Fact
          label="Discipline"
          value={<Badge variant="secondary">{disciplineLabels[climb.discipline]}</Badge>}
        />
        <Fact
          label="Grade"
          value={
            <>
              {climb.gradeRaw}
              {climb.gradeSystem ? (
                <span className="text-muted-foreground">
                  {" "}
                  ({gradeSystemLabels[climb.gradeSystem]})
                </span>
              ) : null}
              {climb.gradeSystem && <GradeHint system={climb.gradeSystem} />}
            </>
          }
        />
        <Fact label="Style" value={ascentStyleLabels[climb.ascentStyle]} />
        {climb.pitches !== null && <Fact label="Pitches" value={climb.pitches} />}
        {climb.lengthM !== null && <Fact label="Length" value={`${climb.lengthM} m`} />}
        {climb.partners.length > 0 && (
          <Fact label="Partners" value={climb.partners.join(", ")} />
        )}
        {climb.route && (
          <Fact
            label="Linked route"
            value={
              climb.route.externalUrl ? (
                <a
                  href={climb.route.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {climb.route.name}
                </a>
              ) : (
                climb.route.name
              )
            }
          />
        )}
        {(climb.gpxTrackUrl || climb.pathGeojson) && (
          <Fact
            label="Track"
            value={
              <>
                {climb.gpxTrackUrl && (
                  <>
                    <a
                      href={climb.gpxTrackUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      download original
                    </a>{" "}
                    ·{" "}
                  </>
                )}
                <Link href="/map" className="underline">
                  view on map
                </Link>
              </>
            }
          />
        )}
      </dl>

      {climb.notes && (
        <p className="mb-6 whitespace-pre-wrap text-sm">{climb.notes}</p>
      )}

      {climb.photoUrls.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Photos</h2>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {climb.photoUrls.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded Supabase Storage URL */}
                <img
                  src={url}
                  alt={`Photo of ${climb.freeTextRouteName}`}
                  className="h-32 w-44 rounded-md border object-cover sm:h-40 sm:w-56"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
