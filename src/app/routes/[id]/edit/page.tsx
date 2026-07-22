import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth";

export default async function EditRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;
  await requireOnboardedUser();
  notFound();
}
