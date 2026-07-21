import { requireOnboardedUser } from "@/lib/auth";
import { createRoute } from "../actions";
import { RouteForm } from "../route-form";
import { SiteNav } from "@/components/site-nav";

export default async function NewRoutePage() {
  await requireOnboardedUser();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 sm:px-6">
      <SiteNav current="/routes" />
      <h1 className="page-title">Add a route</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Grows the personal route database — routes added here can be linked
        from logbook entries and appear on the map when they have coordinates.
      </p>
      <RouteForm action={createRoute} />
    </main>
  );
}
