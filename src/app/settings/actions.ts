"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_WEIGHTS, type RecommenderWeights } from "@/lib/recommender";

export async function saveWeights(formData: FormData): Promise<void> {
  const user = await requireUser();

  const weights: RecommenderWeights = { ...DEFAULT_WEIGHTS };
  for (const key of ["w1", "w2", "w3", "w4"] as const) {
    const value = Number(formData.get(key));
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      weights[key] = value;
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      recommenderWeightsJson: weights,
      displayName: (() => {
        const value = formData.get("displayName");
        return typeof value === "string" ? value.trim().slice(0, 80) || null : null;
      })(),
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/map");
  redirect("/dashboard");
}
