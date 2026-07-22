import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeSystemsByDiscipline } from "@/lib/grades";
import { AscentStyle, ClimbVisibility } from "@/generated/prisma/enums";
import { createClimb } from "../actions";
import { ClimbForm } from "../climb-form";
import { SiteNav } from "@/components/site-nav";
import { getUserProgressAndSuggestions } from "@/lib/bmg/user-progress";
import { APPROVED_PUBLIC_ROUTE_WHERE } from "@/lib/routes/quality-policy";

export default async function NewClimbPage({
  searchParams,
}: {
  searchParams: Promise<{ routeId?: string; customTrailId?: string }>;
}) {
  const user = await requireOnboardedUser();
  const { routeId, customTrailId } = await searchParams;
  const route = routeId
    ? await prisma.route.findFirst({
        where: { id: routeId, ...APPROVED_PUBLIC_ROUTE_WHERE },
        select: {
          id: true,
          name: true,
          discipline: true,
          gradeSystem: true,
          gradeRaw: true,
          ascentM: true,
          estimatedDurationMins: true,
          area: { select: { name: true } },
        },
      })
    : null;
  const customTrail = customTrailId
    ? await prisma.customTrail.findFirst({
        where: { id: customTrailId, ownerId: user.id },
        select: { id: true, name: true, discipline: true, gradeSystem: true, gradeRaw: true, ascentM: true, estimatedDurationMins: true, areaName: true },
      })
    : null;
  const linked = route ?? customTrail;
  const [{ progress }, climbCount] = await Promise.all([
    getUserProgressAndSuggestions(prisma, user),
    prisma.climb.count({ where: { userId: user.id } }),
  ]);
  const relevantCategory = progress.find((category) => category.key === linked?.discipline);
  const progressDeltas = relevantCategory
    ? relevantCategory.rules.filter((rule) => !rule.met).slice(0, 2).map((rule) => ({
        label: rule.description,
        current: rule.actualCount,
        next: rule.actualCount + 1,
        target: rule.minCount,
      }))
    : [{ label: "Total climbs logged", current: climbCount, next: climbCount + 1, target: Math.max(10, climbCount + 1) }];

  return (
    <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-8 sm:px-6 lg:px-8">
      <SiteNav current="/logbook" />
      <div className="mb-7">
        <p className="instrument-label mb-2 text-primary">Logbook · new entry</p>
        <h1 className="page-title">Log a climb</h1>
        <p className="mt-2 text-base text-muted-foreground">Record what you did — it feeds your BMG progress and sharpens your recommendations.</p>
      </div>
      <ClimbForm
        action={createClimb}
        submitLabel="Log climb"
        linkedRoute={linked ? {
          id: linked.id,
          kind: customTrail ? "custom" : "canonical",
          name: linked.name,
          discipline: linked.discipline,
          gradeRaw: linked.gradeRaw,
          areaName: customTrail ? customTrail.areaName : route?.area?.name ?? null,
        } : null}
        progressDeltas={progressDeltas}
        defaultValues={linked ? {
          routeName: linked.name,
          discipline: linked.discipline,
          date: new Date().toISOString().slice(0, 10),
          gradeSystem: linked.gradeSystem ?? gradeSystemsByDiscipline[linked.discipline][0],
          gradeRaw: linked.gradeRaw ?? "",
          ascentStyle: AscentStyle.led,
          area: customTrail ? customTrail.areaName ?? "" : route?.area?.name ?? "",
          notes: "",
          visibility: ClimbVisibility.private,
          ascentM: linked.ascentM,
          durationMinutes: linked.estimatedDurationMins,
          variant: null,
          conditions: [],
          partners: "",
          rating: null,
        } : undefined}
      />
    </main>
  );
}
