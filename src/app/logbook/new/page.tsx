import { requireUser } from "@/lib/auth";
import { createClimb } from "../actions";
import { ClimbForm } from "../climb-form";

export default async function NewClimbPage() {
  await requireUser();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-4 sm:p-6">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Log a climb</h1>
      <ClimbForm action={createClimb} submitLabel="Log climb" />
    </main>
  );
}
