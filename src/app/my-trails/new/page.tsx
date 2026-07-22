import { requireOnboardedUser } from "@/lib/auth";
import { SiteNav } from "@/components/site-nav";
import { createCustomTrail } from "@/app/routes/actions";
import { RouteForm } from "@/app/routes/route-form";

export default async function NewCustomTrailPage() {
  await requireOnboardedUser();
  return <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 sm:px-6">
    <SiteNav current="/my-trails" />
    <p className="instrument-label mb-2 text-primary">Private to your account</p>
    <h1 className="page-title">Create a custom trail</h1>
    <p className="mb-6 text-sm text-muted-foreground">This trail can be linked to your climbs, but is never published, reviewed, recommended, or shown to another user.</p>
    <RouteForm action={createCustomTrail} submitLabel="Save private trail" />
  </main>;
}
