import { requireOnboardedUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function NewRoutePage() {
  await requireOnboardedUser();
  redirect("/my-trails/new");
}
