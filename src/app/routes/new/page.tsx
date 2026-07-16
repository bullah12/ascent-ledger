import { requireUser } from "@/lib/auth";
import { createRoute } from "../actions";
import { RouteForm } from "../route-form";

export default async function NewRoutePage() {
  await requireUser();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Add a route</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Grows the personal route database — routes added here can be linked
        from logbook entries and appear on the map when they have coordinates.
      </p>
      <RouteForm action={createRoute} />
    </main>
  );
}
